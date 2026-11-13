/**
 * Рендереры представлений. Сейчас — простые экраны с анимацией; на этапе 4 здесь появятся
 * кинематографичные сцены (колода, ночь, круглый стол). Каждый рендерер получает представление
 * и вызывает onDone, когда игрок досмотрел.
 */
import type { ClientView } from '@mafia/protocol';
import { AnimatePresence, motion } from 'framer-motion';
import { type ComponentType, useState } from 'react';
import { HoldToReveal } from '../components/HoldToReveal';
import { RoleCard } from '../components/RoleCard';
import { Avatar } from '../components/players';
import { IconEye, IconLock, IconMoon, IconSun } from '../components/icons';
import { Button, Ornament, cx } from '../components/ui';
import { TONE_CLASS } from '../components/Journal';
import { roleName, t } from '../i18n';
import { type NameOf, describeBeat } from '../lib/describe';
import { MOTION } from '../theme/tokens';
import type { Beat } from './digest';
import type { Presentation, PresentationKind } from './presenter';

export interface RendererProps<P extends Presentation = Presentation> {
  presentation: P;
  view: ClientView;
  name: NameOf;
  /** Шаг ещё актуален: «готов» уйдёт серверу. Иначе кнопка просто закрывает экран. */
  live: boolean;
  onDone: () => void;
}

type Registry = { [K in PresentationKind]: ComponentType<RendererProps<Extract<Presentation, { kind: K }>>> };

function SceneFrame({ phase, children }: { phase: 'night' | 'day' | 'ended'; children: React.ReactNode }) {
  return (
    <div data-phase={phase} className="scene-bg grain fixed inset-0 z-30 overflow-y-auto">
      <div className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">{children}</div>
    </div>
  );
}

const item = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.35 + i * MOTION.stagger * 2, duration: 0.45 } }),
};

// ───────────────────────────── раздача роли ─────────────────────────────

function RoleRevealScene({ view, onDone }: RendererProps<Extract<Presentation, { kind: 'roleReveal' }>>) {
  const you = view.you;
  const [seen, setSeen] = useState(false);
  if (!you) return null;
  const teammates = view.players.filter((p) => you.team === 'black' && p.team === 'black' && p.id !== you.id);
  return (
    <SceneFrame phase="night">
      <div className="flex flex-1 flex-col items-center justify-center py-6" data-testid="role-reveal" onPointerUp={() => setSeen(true)}>
        <p className="text-xs font-bold tracking-[0.3em] text-muted uppercase">{t.game.yourRole}</p>
        <h2 className="mb-6 font-display text-3xl">Карта роздана</h2>
        <motion.div initial={{ y: 60, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ duration: 0.7, ease: MOTION.flip.ease }}>
          <HoldToReveal role={you.role} team={you.team} width={210}>
            <p className="font-display text-2xl" data-testid="revealed-role">
              {roleName(you.role)}
            </p>
            <p className="mt-1 text-sm text-muted">{t.roles[you.role].long}</p>
            {teammates.length > 0 ? (
              <p className="mt-2 text-sm text-gold-200">
                {t.game.teammates}: {teammates.map((p) => `${p.name}${p.role ? ` (${roleName(p.role)})` : ''}`).join(', ')}
              </p>
            ) : null}
          </HoldToReveal>
        </motion.div>
      </div>
      <div className="pb-4">
        <Button block size="lg" tone={seen ? 'gold' : 'ghost'} onClick={onDone} data-testid="role-ok">
          {t.game.understood}
        </Button>
      </div>
    </SceneFrame>
  );
}

// ───────────────────────────── утро ─────────────────────────────

function BeatLine({ beat, name, index, view }: { beat: Beat; name: NameOf; index: number; view: ClientView }) {
  const line = describeBeat(beat, name);
  if (!line) return null;
  if (beat.kind === 'death') {
    const player = view.players.find((p) => p.id === beat.player);
    return (
      <motion.li custom={index} variants={item} initial="hidden" animate="show" className="flex items-center gap-3 rounded-2xl border border-[#f08a8f]/25 bg-black/35 p-3">
        <Avatar name={player?.name ?? '?'} id={beat.player} dead size={44} />
        <span className={cx('flex-1 text-[15px] leading-snug', TONE_CLASS.death)}>{line.text}</span>
        {beat.role ? <RoleCard role={beat.role} team={player?.team ?? null} faceUp width={44} /> : null}
      </motion.li>
    );
  }
  return (
    <motion.li custom={index} variants={item} initial="hidden" animate="show" className={cx('text-[15px] leading-snug', TONE_CLASS[line.tone])}>
      {line.text}
    </motion.li>
  );
}

function PrivateCard({ beats, name, index }: { beats: Beat[]; name: NameOf; index: number }) {
  const [open, setOpen] = useState(false);
  const lines = beats.map((b) => describeBeat(b, name)).filter((l): l is NonNullable<typeof l> => l !== null);
  return (
    <motion.div custom={index} variants={item} initial="hidden" animate="show">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid="private-card"
        className="w-full rounded-2xl border border-gold-400/40 bg-gradient-to-b from-gold-400/12 to-black/40 p-4 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-gold-300 uppercase">
          {open ? <IconEye size={15} /> : <IconLock size={15} />} {t.game.morning.privateTitle}
        </span>
        <AnimatePresence initial={false} mode="wait">
          {open ? (
            <motion.ul key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2 space-y-1.5">
              {lines.length === 0 ? <li className="text-sm text-muted">{t.game.morning.privateEmpty}</li> : null}
              {lines.map((l, i) => (
                <li key={i} className={cx('text-[15px] leading-snug', TONE_CLASS[l.tone])}>
                  {l.text}
                </li>
              ))}
            </motion.ul>
          ) : (
            <motion.p key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1 text-sm text-muted">
              {t.game.morning.privateTap}
            </motion.p>
          )}
        </AnimatePresence>
      </button>
    </motion.div>
  );
}

function NightReportScene({ presentation, view, name, live, onDone }: RendererProps<Extract<Presentation, { kind: 'nightReport' }>>) {
  const { report } = presentation;
  return (
    <SceneFrame phase="day">
      <div className="flex-1 py-6" data-testid="night-report">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-5 text-center">
          <motion.span
            className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-phase-soft text-phase-accent"
            initial={{ rotate: -30, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ duration: 0.9 }}
          >
            <IconSun size={32} />
          </motion.span>
          <h2 className="font-display text-4xl">{t.game.morning.title}</h2>
          <p className="font-display text-muted italic">
            {t.game.morning.subtitle} · {t.log.night(presentation.round)}
          </p>
        </motion.div>
        <Ornament className="mb-5" />
        <ul className="space-y-3">
          {report.public.map((beat, i) => (
            <BeatLine key={i} beat={beat} name={name} index={i} view={view} />
          ))}
        </ul>
        {view.you ? (
          <div className="mt-6">
            <PrivateCard beats={report.private} name={name} index={report.public.length} />
          </div>
        ) : null}
      </div>
      <div className="pb-4">
        <Button block size="lg" onClick={onDone} data-testid="report-ready">
          {live ? t.game.ready : view.phase === 'ended' ? 'Дальше' : t.common.close}
        </Button>
      </div>
    </SceneFrame>
  );
}

// ───────────────────────────── вечер ─────────────────────────────

function Tally({ beat, name, index }: { beat: Extract<Beat, { kind: 'voteResult' }>; name: NameOf; index: number }) {
  const entries = Object.entries(beat.tally).sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <motion.div custom={index} variants={item} initial="hidden" animate="show" className="rounded-2xl border border-white/10 bg-black/35 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.18em] text-gold-300 uppercase">
        {beat.stage === 'revote' ? t.game.day.revote : t.game.evening.tally}
      </p>
      <ul className="space-y-2">
        {entries.map(([id, n], i) => (
          <li key={id}>
            <div className="mb-1 flex justify-between text-sm">
              <span className={cx(beat.leaders.includes(id) && 'font-semibold text-paper')}>{name(id)}</span>
              <span className="tabular-nums text-muted">{n}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8">
              <motion.div
                className={cx('h-full rounded-full', beat.leaders.includes(id) ? 'bg-wine-300' : 'bg-white/30')}
                initial={{ width: 0 }}
                animate={{ width: `${(n / top) * 100}%` }}
                transition={{ delay: 0.5 + index * 0.2 + i * 0.08, duration: 0.6 }}
              />
            </div>
          </li>
        ))}
        {entries.length === 0 ? <li className="text-sm text-muted">{t.game.evening.noVotes}</li> : null}
      </ul>
      {beat.abstained > 0 ? <p className="mt-2 text-xs text-muted">{t.game.evening.abstained(beat.abstained)}</p> : null}
    </motion.div>
  );
}

function VerdictScene({ presentation, view, name, live, onDone }: RendererProps<Extract<Presentation, { kind: 'verdict' }>>) {
  const { report } = presentation;
  return (
    <SceneFrame phase="day">
      <div className="flex-1 py-6" data-testid="verdict">
        <div className="mb-5 text-center">
          <span className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-phase-soft text-phase-accent">
            <IconMoon size={30} />
          </span>
          <h2 className="font-display text-4xl">{t.game.evening.title}</h2>
          <p className="font-display text-muted italic">
            {t.game.evening.subtitle} · {t.log.day(presentation.round)}
          </p>
        </div>
        <Ornament className="mb-5" />
        <ul className="space-y-3">
          {report.public.map((beat, i) =>
            beat.kind === 'voteResult' ? (
              <li key={i}>
                <Tally beat={beat} name={name} index={i} />
              </li>
            ) : beat.kind === 'ballots' ? (
              <motion.li key={i} custom={i} variants={item} initial="hidden" animate="show" className="text-sm text-muted">
                {Object.entries(beat.ballots)
                  .map(([voter, target]) => `${name(voter)} → ${target ? name(target) : 'воздержание'}`)
                  .join(' · ')}
              </motion.li>
            ) : (
              <BeatLine key={i} beat={beat} name={name} index={i} view={view} />
            ),
          )}
        </ul>
        {report.private.length > 0 ? (
          <div className="mt-6">
            <PrivateCard beats={report.private} name={name} index={report.public.length} />
          </div>
        ) : null}
      </div>
      <div className="pb-4">
        <Button block size="lg" onClick={onDone} data-testid="report-ready">
          {live ? t.game.ready : view.phase === 'ended' ? 'Дальше' : t.common.close}
        </Button>
      </div>
    </SceneFrame>
  );
}

// ───────────────────────────── финал ─────────────────────────────

function FinaleScene({ presentation, onDone }: RendererProps<Extract<Presentation, { kind: 'finale' }>>) {
  const outcome = t.outcomes[presentation.result.outcome];
  return (
    <SceneFrame phase="ended">
      <div className="flex flex-1 flex-col items-center justify-center text-center" data-testid="finale">
        <motion.p initial={{ opacity: 0, letterSpacing: '0.1em' }} animate={{ opacity: 1, letterSpacing: '0.4em' }} transition={{ duration: 1.2 }} className="text-xs font-bold text-muted uppercase">
          {t.stages.ended}
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.9, ease: MOTION.flip.ease }}
          className="gold-text mt-3 font-display text-[52px] leading-[1.05] font-bold"
        >
          {outcome.title}
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-3 font-display text-lg text-paper/80 italic">
          {outcome.subtitle}
        </motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} className="mt-2 max-w-xs text-sm text-muted">
          {t.winReasons[presentation.result.reason]}
        </motion.p>
      </div>
      <div className="pb-4">
        <Button block size="lg" onClick={onDone} data-testid="finale-ok">
          Раскрыть роли
        </Button>
      </div>
    </SceneFrame>
  );
}

export const renderers: Registry = {
  roleReveal: RoleRevealScene,
  nightReport: NightReportScene,
  verdict: VerdictScene,
  finale: FinaleScene,
};
