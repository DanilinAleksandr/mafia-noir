/**
 * «Прослушка»: проверяет ВСЕ сообщения, которые получил каждый клиент, на утечки чужих секретов.
 *
 * Проверки независимы друг от друга:
 *   1. соответствие движку — снимок и события в сообщении в точности равны `viewFor` и проекции
 *      событий для этого получателя;
 *   2. оракул — роль игрока видна, только если получатель вправе её знать (оракул написан
 *      отдельно от движка, в тестах движка);
 *   3. поиск по тексту — названия скрытых ролей не встречаются в сыром сообщении нигде;
 *   4. чат мафии приходит только живым чёрным;
 *   5. служебные секреты (чужие токены, хеши, состояние генератора) не уходят никому.
 */
import { ROLE_IDS, currentDecision, projectEvent, projectEvents, viewFor } from '@mafia/engine';
import type { PlayerId, ViewEvent } from '@mafia/engine';
import type { GameSnapshot, Scene, ServerMessage } from '@mafia/protocol';
import { allowedToKnow } from '../../engine/test/helpers';
import { compositionOf } from '../src/game-view';
import type { RoomState } from '../src/state';
import type { Client, Table } from './harness';

/** Строки, которых не должно быть ни в одном сообщении клиенту. */
const FORBIDDEN_FRAGMENTS = ['"tokenHash"', '"salt"', '"rng"', '"visibility"', '"attempts"', '"password"'];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class Wiretap {
  /** Найденные утечки. Пусто — всё хорошо. */
  readonly problems: string[] = [];
  /** Сколько сообщений проверено. */
  checked = 0;
  private readonly table: Table;
  private readonly cursor = new Map<Client, number>();
  private verifiedRev = -1;
  private logLength = 0;

  constructor(table: Table) {
    this.table = table;
  }

  /** Проверить всё, что клиенты получили с прошлой проверки. Вызывать после каждого шага. */
  async verify(): Promise<void> {
    const state = await this.table.settle();
    for (const client of this.table.clients) {
      const from = this.cursor.get(client) ?? 0;
      for (let i = from; i < client.inbox.length; i++) {
        this.inspect(state, client, client.inbox[i] as ServerMessage, client.raw[i] as string);
        this.checked++;
      }
      this.cursor.set(client, client.inbox.length);
    }
    this.verifiedRev = state.rev;
    this.logLength = state.game ? state.game.log.length : 0;
  }

  /** Проверить одно сообщение (открыто для самопроверки детектора). */
  inspect(state: RoomState, client: Client, message: ServerMessage, raw: string): void {
    const who = `${client.memberId} (${message.t})`;
    const report = (problem: string): void => {
      this.problems.push(`${who}: ${problem}`);
    };

    // 5. служебные секреты
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      if (raw.includes(fragment)) report(`в сообщении есть служебное поле ${fragment}`);
    }
    for (const other of this.table.clients) {
      if (other !== client && other.token && raw.includes(other.token)) report(`в сообщении чужой токен (${other.memberId})`);
    }
    if (client.token && message.t !== 'welcome' && raw.includes(client.token)) report('токен повторно отправлен');

    const game = state.game;
    const viewer: PlayerId | null = state.players.includes(client.memberId) ? client.memberId : null;

    // 4. чат мафии
    const chatSeen = message.t === 'chat' || (message.t === 'welcome' && message.chat.length > 0);
    if (chatSeen) {
      const player = game?.players.find((p) => p.id === client.memberId);
      if (!player || !player.alive || player.team !== 'black') report('чат мафии получил не живой чёрный');
    }

    const snapshot: GameSnapshot | null =
      message.t === 'game' ? message.game : message.t === 'welcome' ? message.game : null;
    const events: ViewEvent[] = message.t === 'game' ? message.events : message.t === 'welcome' ? message.history : [];
    const scenes: Scene[] = message.t === 'game' || message.t === 'welcome' ? message.scenes : [];

    if (!game) {
      if (snapshot) report('снимок партии, хотя партии нет');
      return;
    }
    const display = state.settings.display;

    if (snapshot) {
      if (snapshot.view.viewer !== viewer) report(`снимок предназначен другому зрителю: ${snapshot.view.viewer}`);

      // 2. оракул: чьи роли получатель вправе знать
      const allowed = allowedToKnow(game, viewer);
      for (const p of snapshot.view.players) {
        if ((p.role !== null || p.team !== null) && !allowed.has(p.id)) report(`видна роль игрока ${p.id}`);
      }
      const head = currentDecision(game);
      if (snapshot.view.decision && head?.playerId !== viewer) report('решение показано не тому игроку');

      const expectedComposition = display === 'stealth' ? null : compositionOf(game);
      if (!same(snapshot.composition, expectedComposition)) report('состав партии показан не по режиму');

      // 1. соответствие движку (для свежего снимка: состояние комнаты с тех пор не менялось)
      if (snapshot.rev === state.rev) {
        const { events: _events, ...expected } = viewFor(game, viewer);
        if (!same(snapshot.view, expected)) report('снимок отличается от viewFor движка');
      }
    }

    if (events.length > 0) {
      const fresh = snapshot !== null && snapshot.rev === state.rev;
      if (fresh) {
        for (const event of events) {
          const source = game.log[event.id - 1];
          const expected = source ? projectEvent(game, source, viewer) : null;
          if (!same(event, expected)) report(`событие №${event.id} (${event.type}) отличается от проекции движка`);
        }
        // полнота: ровно те события, что положены получателю на этом шаге
        if (message.t === 'welcome') {
          if (!same(events, projectEvents(game, game.log, viewer))) report('журнал при входе отличается от проекции движка');
        } else if (state.rev === this.verifiedRev + 1) {
          const expected = projectEvents(game, game.log.slice(this.logLength), viewer);
          if (!same(events, expected)) report('события шага отличаются от проекции движка');
        }
      }
    }

    if (display !== 'cinema' && scenes.length > 0) report('сцены вне режима «Кино»');
    for (const scene of scenes) {
      const keys = Object.keys(scene).sort().join(',');
      if (keys !== 'id,role,round,type') report(`в сцене лишние поля: ${keys}`);
    }

    // 3. поиск по тексту: названия ролей, которых получатель знать не должен
    const text = scrub(message, display !== 'stealth' || client.memberId === state.hostId);
    const allowed = allowedToKnow(game, viewer);
    const knownRoles = new Set(game.players.filter((p) => allowed.has(p.id)).map((p) => p.role));
    for (const role of ROLE_IDS) {
      const hidden = game.players.some((p) => p.role === role && !allowed.has(p.id));
      if (hidden && !knownRoles.has(role) && text.includes(`"${role}"`)) report(`в сообщении встречается скрытая роль «${role}»`);
    }
  }
}

/**
 * Текст сообщения для поиска названий ролей — без частей, где роли названы законно:
 * какие роли включены и их квоты (настройки комнаты), а в открытых режимах — состав партии и сцены.
 * Ручной состав хоста (`preset`) остаётся под проверкой: в скрытном режиме его видит только хост.
 */
function scrub(message: ServerMessage, presetIsPublic: boolean): string {
  const copy = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
  const room = copy.room as { settings?: { composition?: Record<string, unknown> } } | undefined;
  const composition = room?.settings?.composition;
  if (composition) {
    delete composition.roles;
    delete composition.quotas;
    if (presetIsPublic) delete composition.preset;
  }
  const game = copy.game as Record<string, unknown> | null | undefined;
  if (game) delete game.composition;
  delete copy.scenes;
  return JSON.stringify(copy);
}
