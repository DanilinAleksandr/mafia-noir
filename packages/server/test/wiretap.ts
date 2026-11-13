/**
 * «Прослушка»: проверяет ВСЕ сообщения, которые получил каждый клиент, на утечки чужих секретов.
 *
 * Игрокам положено только своё. Проверки независимы друг от друга:
 *   1. соответствие движку — снимок и события в сообщении в точности равны `viewFor` и проекции
 *      событий для этого получателя;
 *   2. оракул — роль игрока видна, только если получатель вправе её знать (оракул написан
 *      отдельно от движка, в тестах движка);
 *   3. поиск по тексту — названия скрытых ролей не встречаются в сыром сообщении нигде;
 *   4. чат мафии приходит только живым чёрным;
 *   5. служебные секреты (чужие токены, хеши, состояние генератора) не уходят никому;
 *   6. личные сцены «Кино» приходят только тому, на кого подействовали, называют роль, но не игрока,
 *      и никогда не описывают нападение;
 *   7. «закулисье» (чужие ходы и голоса) игроку не приходит никогда.
 *
 * Ведущему-наблюдателю разрешено всё, кроме служебных секретов: его снимок должен в точности
 * равняться представлению движка с `seeAll`. Ведущий — тот, кто не играет в партии, начатой
 * в режиме «ведущий-наблюдатель»; больше никому это не положено.
 */
import { ROLE_IDS, currentDecision, projectEvent, projectEvents, viewFor } from '@mafia/engine';
import type { GameEvent, GameState, PlayerId, ViewEvent } from '@mafia/engine';
import type { DisplayMode, GameSnapshot, Scene, ServerMessage } from '@mafia/protocol';
import { allowedToKnow } from '../../engine/test/helpers';
import { compositionOf } from '../src/game-view';
import type { RoomState } from '../src/state';
import type { Client, Table } from './harness';

/** Строки, которых не должно быть ни в одном сообщении клиенту. */
const FORBIDDEN_FRAGMENTS = ['"tokenHash"', '"salt"', '"rng"', '"visibility"', '"attempts"', '"password"'];

/** Способности-нападения: их автор не раскрывается никому и никогда. */
const ATTACKS = ['kill', 'potionKill'];
/** Способности, которые не считаются приходом к игроку. */
const NOT_VISITS = ['watch'];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Какие личные сцены положены игроку по этим событиям. Написано независимо от сервера:
 * сцена — это применённая к игроку способность (не нападение), роль её автора и признак спасения.
 */
/** В «Скрытном» режиме эти действия сценами не становятся (выдали бы информационные роли). */
const STEALTH_HIDDEN = ['check', 'investigate', 'scout', 'compare', 'stay'];

export function expectedScenes(
  game: GameState,
  events: readonly GameEvent[],
  playerId: PlayerId,
  display: DisplayMode = 'cinema',
): Scene[] {
  const scenes: Scene[] = [];
  for (const event of events) {
    if (event.type !== 'abilityUsed') continue;
    const ability = event.data.ability;
    const actor = game.players.find((p) => p.id === event.actors[0]);
    if (!actor || actor.id === playerId || !event.targets.includes(playerId)) continue;
    if (ATTACKS.includes(ability) || NOT_VISITS.includes(ability)) continue;
    if (display === 'stealth' && STEALTH_HIDDEN.includes(ability)) continue;
    const saved = game.log.some(
      (e) => e.type === 'saved' && e.round === event.round && e.actors[0] === actor.id && e.targets[0] === playerId,
    );
    scenes.push({ id: event.id, round: event.round, ability, role: display === 'stealth' ? null : actor.role, saved });
  }
  return scenes;
}

export class Wiretap {
  /** Найденные утечки. Пусто — всё хорошо. */
  readonly problems: string[] = [];
  /** Сколько сообщений проверено. */
  checked = 0;
  /** Сколько из них — снимки для ведущего-наблюдателя (ему разрешено видеть всё). */
  narratorMessages = 0;
  /** Сколько личных сцен проверено. */
  scenesChecked = 0;
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

    // 5. служебные секреты — не положены никому, включая ведущего
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      if (raw.includes(fragment)) report(`в сообщении есть служебное поле ${fragment}`);
    }
    for (const other of this.table.clients) {
      if (other !== client && other.token && raw.includes(other.token)) report(`в сообщении чужой токен (${other.memberId})`);
    }
    if (client.token && message.t !== 'welcome' && raw.includes(client.token)) report('токен повторно отправлен');

    const game = state.game;
    const playing = state.players.includes(client.memberId);
    const viewer: PlayerId | null = playing ? client.memberId : null;
    // ведущий-наблюдатель: не играет в партии, начатой в режиме «ведущий»
    const narrator = game !== null && !playing && state.settings.hostMode === 'narrator';
    const options = narrator ? { seeAll: true } : undefined;

    // 4. чат мафии
    const chatSeen = message.t === 'chat' || (message.t === 'welcome' && message.chat.length > 0);
    if (chatSeen && !narrator) {
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
    const fresh = snapshot !== null && snapshot.rev === state.rev;
    const oneStep = state.rev === this.verifiedRev + 1;
    if (narrator && snapshot) this.narratorMessages++;

    if (snapshot) {
      if (snapshot.view.viewer !== viewer) report(`снимок предназначен другому зрителю: ${snapshot.view.viewer}`);

      if (!narrator) {
        // 7. закулисье — только ведущему
        if (snapshot.view.backstage !== null) report('игроку показано закулисье (чужие ходы и голоса)');

        // 2. оракул: чьи роли получатель вправе знать
        const allowed = allowedToKnow(game, viewer);
        for (const p of snapshot.view.players) {
          if ((p.role !== null || p.team !== null) && !allowed.has(p.id)) report(`видна роль игрока ${p.id}`);
        }
        const head = currentDecision(game);
        if (snapshot.view.decision && head?.playerId !== viewer) report('решение показано не тому игроку');
      }

      const expectedComposition = display === 'stealth' ? null : compositionOf(game);
      if (!same(snapshot.composition, expectedComposition)) report('состав партии показан не по режиму');

      // 1. соответствие движку (для свежего снимка: состояние комнаты с тех пор не менялось)
      if (fresh) {
        const { events: _events, ...expected } = viewFor(game, viewer, options);
        if (!same(snapshot.view, expected)) report('снимок отличается от viewFor движка');
      }
    }

    if (events.length > 0 && fresh) {
      for (const event of events) {
        const source = game.log[event.id - 1];
        const expected = source ? projectEvent(game, source, viewer, options) : null;
        if (!same(event, expected)) report(`событие №${event.id} (${event.type}) отличается от проекции движка`);
      }
      // полнота: ровно те события, что положены получателю на этом шаге
      if (message.t === 'welcome') {
        if (!same(events, projectEvents(game, game.log, viewer, options))) {
          report('журнал при входе отличается от проекции движка');
        }
      } else if (oneStep) {
        const expected = projectEvents(game, game.log.slice(this.logLength), viewer, options);
        if (!same(events, expected)) report('события шага отличаются от проекции движка');
      }
    }

    // 6. личные сцены (во всех режимах; в «Скрытном» — без ролей)
    if (scenes.length > 0 && viewer === null) report('сцены пришли не игроку');
    if (display === 'stealth' && scenes.some((s) => s.role !== null)) report('в скрытном режиме сцена называет роль');
    const mine = viewer === null ? [] : expectedScenes(game, game.log, viewer, display);
    for (const scene of scenes) {
      this.scenesChecked++;
      const keys = Object.keys(scene).sort().join(',');
      if (keys !== 'ability,id,role,round,saved') report(`в сцене лишние поля: ${keys}`);
      if (ATTACKS.includes(scene.ability)) report(`сцена раскрывает нападавшего: ${scene.ability}`);
      if (!mine.some((expected) => same(expected, scene))) report(`сцена №${scene.id} не положена получателю или искажена`);
    }
    if (viewer !== null && fresh) {
      if (message.t === 'welcome') {
        if (!same(scenes, mine)) report('сцены при входе отличаются от положенных');
      } else if (message.t === 'game' && oneStep) {
        if (!same(scenes, expectedScenes(game, game.log.slice(this.logLength), viewer, display))) {
          report('сцены шага отличаются от положенных');
        }
      }
    }

    // 3. поиск по тексту: названия ролей, которых получатель знать не должен
    if (!narrator) {
      const text = scrub(message, display !== 'stealth' || client.memberId === state.hostId);
      const allowed = allowedToKnow(game, viewer);
      const knownRoles = new Set(game.players.filter((p) => allowed.has(p.id)).map((p) => p.role));
      for (const role of ROLE_IDS) {
        const hidden = game.players.some((p) => p.role === role && !allowed.has(p.id));
        if (hidden && !knownRoles.has(role) && text.includes(`"${role}"`)) {
          report(`в сообщении встречается скрытая роль «${role}»`);
        }
      }
    }
  }
}

/**
 * Текст сообщения для поиска названий ролей — без частей, где роли названы законно:
 * какие роли включены и их квоты (настройки комнаты), а в открытых режимах — состав партии
 * и личные сцены (их содержимое проверяется отдельно).
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
