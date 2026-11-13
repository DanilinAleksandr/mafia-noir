/**
 * План утренней сцены — чистая функция от представления «итоги ночи».
 *
 * Сцена идёт так: «Пробуждение» → личная часть (что случилось с тобой) → общая часть
 * (рассвет, погибшие падают на стол) → сводка с кнопкой «Готов».
 *
 * Главное правило: убийца не показывается никогда. Вид смерти выбирается случайно
 * (по игроку и кругу, одинаково у всех) и не зависит ни от убийцы, ни от причины.
 *
 * Режимы показа: в «Скрытном» личная часть — только предметы и эффекты, без ролей
 * (сервер и не присылает роль: `scene.role === null`); в «Открытом составе» рядом появляется
 * силуэт подействовавшей роли; в «Кино» — её полная карточка.
 */
import type { PlayerId, RoleId } from '@mafia/engine';
import type { DisplayMode, Scene } from '@mafia/protocol';
import type { Beat, Report } from '../../presenter/digest';

export const DEATH_STYLES = ['shot', 'knife', 'truck', 'piano', 'brick', 'poison', 'explosion'] as const;
export type DeathStyle = (typeof DEATH_STYLES)[number];

/** Детерминированный «случай»: одинаковый у всех клиентов для одного игрока и круга. */
export function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deathStyle(player: PlayerId, round: number): DeathStyle {
  return DEATH_STYLES[hash(`${player}:${round}`) % DEATH_STYLES.length] as DeathStyle;
}

/** Кто подействовал: в «Скрытном» — никто, в «Открытом» — силуэт, в «Кино» — карточка. */
export type ActorShow = { kind: 'none' } | { kind: 'silhouette'; role: RoleId } | { kind: 'card'; role: RoleId };

export type PersonalItem =
  | { kind: 'death'; style: DeathStyle }
  | { kind: 'heal'; saved: boolean; actor: ActorShow }
  | { kind: 'guard'; saved: boolean; actor: ActorShow }
  | { kind: 'bless'; actor: ActorShow }
  | { kind: 'block'; actor: ActorShow }
  | { kind: 'link'; actor: ActorShow; partners: PlayerId[] }
  | { kind: 'cover'; actor: ActorShow }
  | { kind: 'silenced' }
  | { kind: 'visit'; actor: ActorShow; ability: Scene['ability'] }
  | { kind: 'dossier'; target: PlayerId; verdict: 'mafia' | 'clean' | RoleId }
  | { kind: 'newspaper'; targets: PlayerId[]; sameTeam: boolean }
  | { kind: 'footprints'; target: PlayerId; visitors: PlayerId[] };

export type PublicItem =
  | { kind: 'death'; player: PlayerId; role: RoleId | null; style: DeathStyle; with: { player: PlayerId; role: RoleId | null } | null }
  | { kind: 'saved' }
  | { kind: 'silenced'; player: PlayerId };

export interface MorningPlan {
  round: number;
  me: PlayerId | null;
  personal: PersonalItem[];
  public: PublicItem[];
  quiet: boolean;
}

/** Сколько личных эпизодов анимировать (остальное — в сводке): личная часть ≤ 7 с. */
export const MAX_PERSONAL = 3;

function actor(scene: Scene, display: DisplayMode): ActorShow {
  if (display === 'stealth' || scene.role === null) return { kind: 'none' };
  return display === 'cinema' ? { kind: 'card', role: scene.role } : { kind: 'silhouette', role: scene.role };
}

export function morningPlan(report: Report, round: number, me: PlayerId | null, display: DisplayMode): MorningPlan {
  const personal: PersonalItem[] = [];
  const pub: PublicItem[] = [];
  const priv = report.private;
  const scenes = priv.filter((b): b is Extract<Beat, { kind: 'scene' }> => b.kind === 'scene').map((b) => b.scene);

  // гибель самого игрока — первой
  const myDeath = report.public.find((b) => b.kind === 'death' && b.player === me);
  if (me && myDeath) personal.push({ kind: 'death', style: deathStyle(me, round) });

  for (const scene of scenes) {
    const who = actor(scene, display);
    switch (scene.ability) {
      case 'heal':
      case 'potionHeal':
        personal.push({ kind: 'heal', saved: scene.saved, actor: who });
        break;
      case 'guard':
        personal.push({ kind: 'guard', saved: scene.saved, actor: who });
        break;
      case 'bless':
        personal.push({ kind: 'bless', actor: who });
        break;
      case 'block':
        personal.push({ kind: 'block', actor: who });
        break;
      case 'cover':
        personal.push({ kind: 'cover', actor: who });
        break;
      case 'link': {
        const lovers = priv.find((b) => b.kind === 'lovers');
        const partners = lovers && lovers.kind === 'lovers' ? lovers.targets.filter((id) => id !== me) : [];
        personal.push({ kind: 'link', actor: who, partners });
        break;
      }
      case 'stay':
        // Бомж и его гость в личной сцене не показываются — только в общей
        break;
      default:
        // проверки, разведка, сравнение: в «Скрытном» сервер их не присылает
        if (who.kind !== 'none') personal.push({ kind: 'visit', actor: who, ability: scene.ability });
    }
  }
  // блокировка без сцены (в «Скрытном» и при «Кино» — одна и та же помада)
  if (priv.some((b) => b.kind === 'blockedMe') && !personal.some((p) => p.kind === 'block')) {
    personal.push({ kind: 'block', actor: { kind: 'none' } });
  }
  if (me && report.public.some((b) => b.kind === 'silenced' && b.player === me)) personal.push({ kind: 'silenced' });

  // результаты информационных ролей
  for (const beat of priv) {
    if (beat.kind === 'checked') personal.push({ kind: 'dossier', target: beat.target, verdict: beat.isMafia ? 'mafia' : 'clean' });
    if (beat.kind === 'roleLearned') personal.push({ kind: 'dossier', target: beat.target, verdict: beat.role });
    if (beat.kind === 'compared') personal.push({ kind: 'newspaper', targets: beat.targets, sameTeam: beat.sameTeam });
    if (beat.kind === 'visitors') personal.push({ kind: 'footprints', target: beat.target, visitors: beat.visitors });
  }

  // общая часть: погибшие. Бомж падает вместе с хозяином ночлега, если хозяин однозначен
  // (одна «обычная» смерть за ночь); иначе — отдельно: кто был хозяином, всем знать не положено.
  const deaths = report.public.filter((b): b is Extract<Beat, { kind: 'death' }> => b.kind === 'death');
  const hobos = deaths.filter((d) => d.cause === 'hoboWithHost');
  const others = deaths.filter((d) => d.cause !== 'hoboWithHost');
  const pairHobo = hobos.length === 1 && others.length === 1;
  for (const death of others) {
    pub.push({
      kind: 'death',
      player: death.player,
      role: death.role,
      style: deathStyle(death.player, round),
      with: pairHobo ? { player: (hobos[0] as Extract<Beat, { kind: 'death' }>).player, role: (hobos[0] as Extract<Beat, { kind: 'death' }>).role } : null,
    });
  }
  if (!pairHobo) {
    for (const h of hobos) pub.push({ kind: 'death', player: h.player, role: h.role, style: deathStyle(h.player, round), with: null });
  }
  if (report.public.some((b) => b.kind === 'saved')) pub.push({ kind: 'saved' });
  for (const beat of report.public) if (beat.kind === 'silenced') pub.push({ kind: 'silenced', player: beat.player });

  return { round, me, personal, public: pub, quiet: deaths.length === 0 };
}
