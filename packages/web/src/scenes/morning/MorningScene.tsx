/**
 * Сцена «Утро» — итоги ночи.
 *
 * «Пробуждение» (веки открываются сквозь размытие) → личная часть: что случилось с тобой
 * (своя карта рубашкой вверх — роль соседям не видна) → общая часть: рассвет над городом,
 * карточки погибших падают на стол и переворачиваются ролью → сводка с кнопкой «Готов».
 *
 * Убийца не показывается никогда: пуля прилетает из-за кадра, нож уже торчит, КАМАЗ едет
 * без водителя, сверху падает рояль или кирпич, яд, взрыв. Вид смерти случаен (plan.ts).
 * В «Скрытном» — только предметы и эффекты; в «Открытом составе» — силуэт роли; в «Кино» — карточка.
 */
import { gsap } from 'gsap';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CardBack, CardFace } from '../../components/RoleCard';
import { Avatar } from '../../components/players';
import { TONE_CLASS } from '../../components/Journal';
import { cx } from '../../components/ui';
import { roleName, t } from '../../i18n';
import { type NameOf, describeBeat } from '../../lib/describe';
import { vibrate } from '../../settings/haptics';
import { TEAM_PALETTE } from '../../theme/tokens';
import { teamOf } from '@mafia/engine';
import type { Rules } from '@mafia/engine';
import { sfx } from '../audio/sfx';
import { ParticleCanvas } from '../fx/ParticleCanvas';
import type { Burst } from '../fx/particles';
import type { SceneOf } from '../types';
import { useSceneTimeline } from '../useSceneTimeline';
import { type ActorShow, type DeathStyle, MAX_PERSONAL, type MorningPlan, type PersonalItem, hash, morningPlan } from './plan';
import {
  ArrowHeart,
  Bird,
  Brick,
  BulletHole,
  Drips,
  Folder,
  Footprint,
  Kiss,
  Knife,
  Newspaper,
  Piano,
  Plaster,
  Shield,
  Skyline,
  Syringe,
  Tape,
  Truck,
} from './props';
import { type Schedule, schedule } from './schedule';

const GREEN = '#5fe0a0';
const GOLD = '#f1d27a';
const PINK = '#ff6f8f';

// ───────────────────────────── подписи ─────────────────────────────

function caption(item: PersonalItem, name: NameOf): string {
  const role = (a: ActorShow) => (a.kind === 'none' ? null : roleName(a.role));
  switch (item.kind) {
    case 'death':
      return 'Этой ночью вы погибли.';
    case 'heal': {
      const r = role(item.actor);
      return r ? (item.saved ? `${r} спас вас этой ночью!` : `Ночью вас лечил ${r}.`) : t.game.scenesAnon.heal(item.saved);
    }
    case 'guard': {
      const r = role(item.actor);
      return r ? (item.saved ? `${r} закрыл вас собой!` : `${r} охранял вас этой ночью.`) : t.game.scenesAnon.guard(item.saved);
    }
    case 'bless': {
      const r = role(item.actor);
      return r ? `${r} благословил вас на завтра.` : t.game.scenesAnon.bless();
    }
    case 'block': {
      const r = role(item.actor);
      return r ? `${r} провела с вами ночь — способность не сработала.` : t.game.scenesAnon.block();
    }
    case 'link':
      return item.partners.length > 0 ? `Ваша судьба связана с игроком ${item.partners.map(name).join(', ')}.` : t.game.scenesAnon.link();
    case 'cover': {
      const r = role(item.actor);
      return r ? `${r} прикрыл вас от проверки.` : t.game.scenesAnon.cover();
    }
    case 'silenced':
      return 'Сегодня вы молчите.';
    case 'visit': {
      const r = role(item.actor);
      return r ? `Ночью к вам приходил ${r}.` : t.game.scenesAnon.generic();
    }
    case 'dossier':
      return `Досье: ${name(item.target)}`;
    case 'newspaper':
      return 'Утренний выпуск';
    case 'footprints':
      return item.visitors.length > 0 ? `Следы у дома игрока ${name(item.target)}` : `К игроку ${name(item.target)} никто не приходил`;
  }
}

// ───────────────────────────── действующее лицо ─────────────────────────────

/** Силуэт («Открытый состав») или карточка («Кино») роли, которая подействовала на игрока. */
function Actor({ actor, rules, width }: { actor: ActorShow; rules: Rules; width: number }) {
  if (actor.kind === 'none') return null;
  const team = teamOf(actor.role, rules);
  const palette = TEAM_PALETTE[team];
  return (
    <div className="ep-actor absolute flex flex-col items-center" style={{ left: '4%', top: '24%', width: width * 0.62 }}>
      {actor.kind === 'card' ? (
        <div className="relative" style={{ width: width * 0.56, height: width * 0.84 }}>
          <CardFace role={actor.role} team={team} width={width * 0.56} />
        </div>
      ) : (
        <svg viewBox="0 0 80 120" width={width * 0.5} aria-hidden style={{ filter: `drop-shadow(0 0 10px ${palette.primary})` }}>
          <circle cx="40" cy="26" r="16" fill="#07060a" stroke={palette.trim} strokeWidth="1.5" />
          <path d="M8 118 C8 70 20 52 40 52 C60 52 72 70 72 118 Z" fill="#07060a" stroke={palette.trim} strokeWidth="1.5" />
          <path d="M22 18 L58 18 L54 6 L26 6 Z" fill="#07060a" stroke={palette.trim} strokeWidth="1.2" />
        </svg>
      )}
      <span className="mt-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold" style={{ color: palette.trim }}>
        {roleName(actor.role)}
      </span>
    </div>
  );
}

// ───────────────────────────── эпизоды личной части ─────────────────────────────

function DeathMarkup({ style, soft, cardW }: { style: DeathStyle; soft: boolean; cardW: number }) {
  const liquid = soft ? '#1d2a6b' : '#8a0f1c';
  return (
    <>
      {style === 'shot' ? (
        <>
          <div className="fx-flash pointer-events-none fixed top-1/3 right-0 h-40 w-24 rounded-l-full bg-[radial-gradient(circle_at_right,#fff7c2,#ffb347_40%,transparent_70%)]" />
          <div className="fx-bullet absolute top-1/2 h-[3px] w-24 rounded-full bg-gradient-to-l from-[#ffe9a8] to-transparent" style={{ left: '50%' }} />
          <BulletHole className="fx-hole absolute" width={cardW * 0.42} style={{ left: '38%', top: '30%' }} />
        </>
      ) : null}
      {style === 'knife' ? <Knife className="fx-knife absolute" width={cardW * 0.95} style={{ left: '30%', top: '34%', transformOrigin: '100% 50%' }} /> : null}
      {style === 'truck' ? <Truck className="fx-truck absolute bottom-[-6%] left-0" width={cardW * 2.2} /> : null}
      {style === 'piano' ? (
        <>
          <div className="fx-shadow absolute -bottom-6 left-1/2 h-8 w-[120%] -translate-x-1/2 rounded-[50%] bg-black/70 blur-md" />
          <Piano className="fx-piano absolute left-1/2 -translate-x-1/2" width={cardW * 1.5} style={{ top: -cardW * 0.6 }} />
        </>
      ) : null}
      {style === 'brick' ? (
        <>
          <div className="fx-shadow absolute -bottom-6 left-1/2 h-6 w-[80%] -translate-x-1/2 rounded-[50%] bg-black/60 blur-md" />
          <Brick className="fx-brick absolute left-1/2 -translate-x-1/2" width={cardW * 0.7} style={{ top: cardW * 0.2 }} />
        </>
      ) : null}
      {style === 'poison' ? (
        <div
          className="fx-poison absolute inset-0 rounded-[14px]"
          style={{ background: 'linear-gradient(to top, rgba(10,28,12,0.95), rgba(40,90,30,0.7) 55%, transparent)', transformOrigin: 'bottom' }}
        />
      ) : null}
      {style === 'explosion' ? (
        <div className="fx-flash pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_42%,#fff6d0,#ff9b3d_25%,#7a1d08_45%,transparent_65%)]" />
      ) : null}
      {style !== 'truck' && style !== 'explosion' ? (
        <Drips className="fx-drips absolute" width={cardW * 0.42} color={liquid} style={{ left: style === 'knife' ? '18%' : '30%', top: style === 'piano' || style === 'brick' ? '10%' : '30%' }} />
      ) : null}
    </>
  );
}

function Episode({ item, index, cardW, plan, rules, soft, name }: { item: PersonalItem; index: number; cardW: number; plan: MorningPlan; rules: Rules; soft: boolean; name: NameOf }) {
  const cardH = cardW * 1.5;
  const seed = hash(`${plan.me}:${plan.round}:${index}`);
  const spot = { left: `${18 + (seed % 40)}%`, top: `${22 + ((seed >> 4) % 40)}%`, rot: ((seed >> 8) % 50) - 25 };
  const withCard = item.kind !== 'dossier' && item.kind !== 'newspaper' && item.kind !== 'footprints';
  return (
    <div className={`ep ep-${index} absolute inset-0`} data-episode={item.kind}>
      {withCard ? (
        <div className="ep-cardwrap absolute left-1/2" style={{ top: '40%', width: cardW, height: cardH, marginLeft: -cardW / 2, marginTop: -cardH / 2 }}>
          <div className="ep-card relative h-full w-full">
            <CardBack width={cardW} />
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-gold-400/50 bg-black/80 px-3 py-0.5 text-xs font-semibold text-gold-200">
              {t.common.you}
            </span>
            {item.kind === 'death' ? <DeathMarkup style={item.style} soft={soft} cardW={cardW} /> : null}
            {item.kind === 'heal' ? (
              <>
                <Plaster className="fx-plaster absolute" width={cardW * 0.62} style={{ left: spot.left, top: spot.top, rotate: `${spot.rot}deg` }} />
                <Syringe className="fx-syringe fixed top-[38%] right-[-10px]" width={cardW * 0.9} />
              </>
            ) : null}
            {item.kind === 'guard' ? (
              <>
                <Shield className="fx-shield absolute left-1/2 top-[12%] -translate-x-1/2" width={cardW * 0.85} />
                {item.saved ? <div className="fx-bullet absolute top-[40%] h-[3px] w-24 rounded-full bg-gradient-to-l from-[#ffe9a8] to-transparent" style={{ left: '60%' }} /> : null}
              </>
            ) : null}
            {item.kind === 'bless' ? (
              <>
                <div className="fx-beam pointer-events-none absolute -top-[120%] left-1/2 h-[220%] w-[90%] -translate-x-1/2 bg-[linear-gradient(to_bottom,rgba(255,236,170,0),rgba(255,236,170,0.55),rgba(255,236,170,0))]" style={{ transformOrigin: 'top' }} />
                <div className="fx-halo absolute -top-10 left-1/2 h-8 w-28 -translate-x-1/2 rounded-[50%] border-4 border-[#ffe6a0] shadow-[0_0_24px_#ffe6a0]" />
              </>
            ) : null}
            {item.kind === 'block' ? <Kiss className="fx-kiss absolute" width={cardW * 0.6} style={{ left: spot.left, top: spot.top, rotate: `${spot.rot}deg` }} /> : null}
            {item.kind === 'link' ? (
              <>
                <div className="fx-glow absolute inset-0 rounded-[14px] shadow-[0_0_60px_10px_rgba(255,90,140,0.6)]" />
                <ArrowHeart className="fx-arrow absolute left-1/2 top-1/3 -translate-x-1/2" width={cardW * 1.1} />
              </>
            ) : null}
            {item.kind === 'cover' ? (
              <div className="fx-stamp absolute left-1/2 top-[40%] -translate-x-1/2 -rotate-12 rounded border-4 border-[#d6b25a] px-3 py-1 font-display text-2xl font-bold tracking-widest text-[#d6b25a]">
                ПРИКРЫТ
              </div>
            ) : null}
            {item.kind === 'silenced' ? (
              <>
                <Tape className="fx-tape1 absolute left-1/2 top-[38%] -translate-x-1/2 rotate-[24deg]" width={cardW * 1.05} />
                <Tape className="fx-tape2 absolute left-1/2 top-[38%] -translate-x-1/2 -rotate-[24deg]" width={cardW * 1.05} />
              </>
            ) : null}
            {item.kind === 'visit' ? <div className="fx-ring absolute inset-0 rounded-[14px] border-2 border-[#9fb4d8] shadow-[0_0_30px_#9fb4d8]" /> : null}
          </div>
        </div>
      ) : null}

      {item.kind === 'dossier' ? (
        <div className="fx-folder absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2">
          <Folder width={Math.min(300, cardW * 1.6)}>
            <div className="absolute top-[22%] left-[9%] flex flex-col items-center">
              <Avatar name={name(item.target)} id={item.target} size={64} />
              <span className="mt-1 text-sm font-bold text-[#2a2015]">{name(item.target)}</span>
            </div>
            <span className="absolute top-[8%] right-[8%] text-[10px] font-bold tracking-[0.25em] text-[#6b5530]">СЕКРЕТНО</span>
            <div
              className={cx(
                'fx-stamp absolute top-[50%] right-[8%] -rotate-12 rounded-md border-4 px-2 py-0.5 font-display text-[26px] leading-none font-bold tracking-wider uppercase',
                item.verdict === 'mafia' ? 'border-[#b4142b] text-[#b4142b]' : item.verdict === 'clean' ? 'border-[#1e7a4c] text-[#1e7a4c]' : 'border-[#7a5a14] text-[#7a5a14]',
              )}
            >
              {item.verdict === 'mafia' ? 'Мафия' : item.verdict === 'clean' ? 'Чист' : roleName(item.verdict)}
            </div>
          </Folder>
        </div>
      ) : null}
      {item.kind === 'newspaper' ? (
        <div className="fx-paper absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2">
          <Newspaper
            width={Math.min(300, cardW * 1.6)}
            headline={item.sameTeam ? 'В одной команде!' : 'По разные стороны!'}
            names={item.targets.map(name).join(' и ')}
          />
        </div>
      ) : null}
      {item.kind === 'footprints' ? (
        <div className="absolute inset-x-0 top-[16%] h-[48%]">
          <div className="fx-door absolute top-0 left-1/2 flex -translate-x-1/2 flex-col items-center">
            <div className="h-24 w-16 rounded-t-[32px] border-4 border-[#6b4a2a] bg-[#2a1a10] shadow-[0_0_30px_rgba(255,200,120,0.25)]" />
            <span className="mt-1 text-xs font-semibold text-paper/80">{name(item.target)}</span>
          </div>
          {item.visitors.slice(0, 3).map((v, vi) =>
            [0, 1, 2, 3].map((s) => (
              <Footprint
                key={`${v}-${s}`}
                className={`fx-step fx-step-${vi} absolute text-[#c9b79a]`}
                flip={s % 2 === 1}
                style={{ left: `${22 + vi * 26 + (s % 2) * 6}%`, top: `${92 - s * 16}%`, rotate: `${(vi - 1) * 14}deg`, opacity: 0 }}
              />
            )),
          )}
          {item.visitors.slice(0, 3).map((v, vi) => (
            <span key={v} className={`fx-tag fx-tag-${vi} absolute rounded-full bg-black/60 px-2 py-0.5 text-xs text-gold-200`} style={{ left: `${16 + vi * 26}%`, top: '102%' }}>
              {name(v)}
            </span>
          ))}
        </div>
      ) : null}

      <Actor actor={'actor' in item ? item.actor : { kind: 'none' }} rules={rules} width={cardW} />
      <p className="ep-caption absolute inset-x-0 px-8 text-center font-display text-[22px] leading-snug text-paper" style={{ top: '66%' }}>
        {caption(item, name)}
      </p>
    </div>
  );
}

// ───────────────────────────── таймлайн личной части ─────────────────────────────

function buildEpisode(tl: gsap.core.Timeline, q: (s: string) => Element[], item: PersonalItem, i: number, at: number, dur: number, vw: number) {
  const ep = `.ep-${i}`;
  const end = at + dur;
  tl.fromTo(q(ep), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, at);
  tl.fromTo(q(`${ep} .ep-cardwrap`), { y: 30, scale: 0.9 }, { y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.6)' }, at);
  tl.fromTo(q(`${ep} .ep-actor`), { x: -80, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: 'power2.out' }, at + 0.15);
  tl.fromTo(q(`${ep} .ep-caption`), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4 }, at + dur * 0.45);
  const hit = at + 0.55;
  switch (item.kind) {
    case 'death': {
      tl.call(() => vibrate('impact'), undefined, hit + 0.3);
      if (item.style === 'shot') {
        tl.fromTo(q(`${ep} .fx-flash`), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06, yoyo: true, repeat: 1 }, hit);
        tl.call(() => sfx.play('shot'), undefined, hit);
        tl.fromTo(q(`${ep} .fx-bullet`), { x: vw, autoAlpha: 1 }, { x: -40, duration: 0.14, ease: 'none' }, hit + 0.05);
        tl.set(q(`${ep} .fx-bullet`), { autoAlpha: 0 }, hit + 0.2);
        tl.fromTo(q(`${ep} .fx-hole`), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.12 }, hit + 0.18);
        tl.to(q(`${ep} .ep-card`), { x: -14, rotation: -4, duration: 0.08, yoyo: true, repeat: 1 }, hit + 0.18);
      } else if (item.style === 'knife') {
        tl.call(() => sfx.play('whoosh'), undefined, hit - 0.15);
        tl.fromTo(q(`${ep} .fx-knife`), { x: vw * 0.7, y: -vw * 0.5, rotation: -200, autoAlpha: 1 }, { x: 0, y: 0, rotation: -18, duration: 0.32, ease: 'power3.in' }, hit - 0.15);
        tl.call(() => sfx.play('thud'), undefined, hit + 0.17);
        tl.to(q(`${ep} .fx-knife`), { rotation: -14, duration: 0.05, yoyo: true, repeat: 5 }, hit + 0.17);
        tl.to(q(`${ep} .ep-card`), { x: -6, duration: 0.05, yoyo: true, repeat: 3 }, hit + 0.17);
      } else if (item.style === 'truck') {
        tl.call(() => sfx.play('engine'), undefined, hit - 0.3);
        tl.fromTo(q(`${ep} .fx-truck`), { x: -vw * 1.4, autoAlpha: 1 }, { x: vw * 0.9, duration: 0.9, ease: 'power1.in' }, hit - 0.3);
        tl.call(() => sfx.play('crash'), undefined, hit + 0.22);
        tl.to(q(`${ep} .ep-card`), { x: vw, y: -120, rotation: 540, duration: 0.7, ease: 'power2.out' }, hit + 0.25);
      } else if (item.style === 'piano' || item.style === 'brick') {
        const obj = item.style === 'piano' ? '.fx-piano' : '.fx-brick';
        tl.fromTo(q(`${ep} .fx-shadow`), { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5 }, hit - 0.3);
        tl.fromTo(q(`${ep} ${obj}`), { y: -900, autoAlpha: 1, rotation: item.style === 'brick' ? -30 : 0 }, { y: 0, rotation: item.style === 'brick' ? 8 : 0, duration: 0.5, ease: 'power3.in' }, hit - 0.3);
        tl.call(() => sfx.play('crash'), undefined, hit + 0.2);
        tl.to(q(`${ep} .ep-card`), { scaleY: item.style === 'piano' ? 0.18 : 0.85, transformOrigin: '50% 100%', duration: 0.12, ease: 'power2.out' }, hit + 0.2);
      } else if (item.style === 'poison') {
        tl.call(() => sfx.play('poison'), undefined, hit);
        tl.fromTo(q(`${ep} .fx-poison`), { scaleY: 0, autoAlpha: 0.9 }, { scaleY: 1, duration: 1.1, ease: 'power1.inOut' }, hit);
        tl.to(q(`${ep} .ep-card`), { rotation: 3, duration: 0.3, yoyo: true, repeat: 3, ease: 'sine.inOut' }, hit + 0.3);
      } else if (item.style === 'explosion') {
        tl.call(() => sfx.play('explosion'), undefined, hit);
        tl.fromTo(q(`${ep} .fx-flash`), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, hit);
        tl.to(q(`${ep} .fx-flash`), { autoAlpha: 0, duration: 0.9 }, hit + 0.08);
        tl.to(q(`${ep} .ep-card`), { x: 8, y: -6, duration: 0.04, yoyo: true, repeat: 7 }, hit);
        tl.to(q(`${ep} .ep-card`), { scale: 1.3, autoAlpha: 0, rotation: 25, duration: 0.6, ease: 'power2.out' }, hit + 0.32);
      }
      if (item.style !== 'truck' && item.style !== 'explosion') {
        tl.fromTo(q(`${ep} .fx-drips`), { scaleY: 0, autoAlpha: 1 }, { scaleY: 1, duration: 1.3, ease: 'power1.in' }, hit + 0.35);
      }
      break;
    }
    case 'heal':
      tl.fromTo(q(`${ep} .fx-syringe`), { x: 120, autoAlpha: 0 }, { x: -vw * 0.2, autoAlpha: 1, duration: 0.35, ease: 'power2.out' }, at + 0.25);
      tl.fromTo(q(`${ep} .fx-syringe .plunger`), { scaleX: 1 }, { scaleX: 0.35, duration: 0.3 }, at + 0.62);
      tl.to(q(`${ep} .fx-syringe`), { x: 160, autoAlpha: 0, duration: 0.3, ease: 'power2.in' }, at + 0.98);
      tl.call(() => sfx.play('pop'), undefined, at + 1.12);
      tl.fromTo(q(`${ep} .fx-plaster`), { scale: 1.8, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.18, ease: 'back.out(3)' }, at + 1.1);
      tl.call(() => vibrate('tap'), undefined, at + 1.12);
      break;
    case 'guard':
      tl.fromTo(q(`${ep} .fx-shield`), { y: 60, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.8)' }, at + 0.3);
      tl.set(q(`${ep} .fx-shield .cracks`), { autoAlpha: 0 }, at);
      if (item.saved) {
        tl.call(() => sfx.play('shot'), undefined, at + 0.9);
        tl.fromTo(q(`${ep} .fx-bullet`), { x: vw, autoAlpha: 1 }, { x: 0, duration: 0.14, ease: 'none' }, at + 0.92);
        tl.set(q(`${ep} .fx-bullet`), { autoAlpha: 0 }, at + 1.07);
        tl.to(q(`${ep} .fx-shield .cracks`), { autoAlpha: 1, duration: 0.05 }, at + 1.06);
        tl.call(() => vibrate('impact'), undefined, at + 1.06);
        tl.to(q(`${ep} .fx-shield`), { x: -10, duration: 0.06, yoyo: true, repeat: 3 }, at + 1.06);
      }
      break;
    case 'bless':
      tl.call(() => sfx.play('sparkle'), undefined, at + 0.3);
      tl.fromTo(q(`${ep} .fx-beam`), { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.7, ease: 'power2.out' }, at + 0.3);
      tl.fromTo(q(`${ep} .fx-halo`), { y: -30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, at + 0.7);
      break;
    case 'block':
      tl.call(() => sfx.play('pop'), undefined, at + 0.6);
      tl.fromTo(q(`${ep} .fx-kiss`), { scale: 2.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.2, ease: 'back.out(2.6)' }, at + 0.6);
      break;
    case 'link':
      tl.call(() => sfx.play('whoosh'), undefined, at + 0.4);
      tl.fromTo(q(`${ep} .fx-arrow`), { x: -vw, autoAlpha: 1 }, { x: 0, duration: 0.4, ease: 'power3.out' }, at + 0.4);
      tl.fromTo(q(`${ep} .fx-glow`), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, at + 0.8);
      break;
    case 'cover':
    case 'silenced': {
      const parts = item.kind === 'cover' ? [`${ep} .fx-stamp`] : [`${ep} .fx-tape1`, `${ep} .fx-tape2`];
      parts.forEach((p, pi) => {
        tl.call(() => sfx.play(item.kind === 'cover' ? 'stamp' : 'tape'), undefined, at + 0.6 + pi * 0.3);
        tl.fromTo(q(p), { scale: 1.8, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.16, ease: 'power4.in' }, at + 0.6 + pi * 0.3);
      });
      tl.call(() => vibrate('stamp'), undefined, at + 0.76);
      break;
    }
    case 'visit':
      tl.fromTo(q(`${ep} .fx-ring`), { autoAlpha: 0, scale: 1.2 }, { autoAlpha: 1, scale: 1, duration: 0.5 }, at + 0.5);
      break;
    case 'dossier':
      tl.call(() => sfx.play('paper'), undefined, at + 0.1);
      tl.fromTo(q(`${ep} .fx-folder`), { y: 300, rotation: 8, autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' }, at + 0.1);
      tl.call(() => sfx.play('stamp'), undefined, at + 0.95);
      tl.call(() => vibrate('stamp'), undefined, at + 0.95);
      tl.fromTo(q(`${ep} .fx-stamp`), { scale: 2.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.15, ease: 'power4.in' }, at + 0.8);
      tl.to(q(`${ep} .fx-folder`), { y: 4, duration: 0.06, yoyo: true, repeat: 1 }, at + 0.95);
      break;
    case 'newspaper':
      tl.call(() => sfx.play('paper'), undefined, at + 0.1);
      tl.fromTo(q(`${ep} .fx-paper`), { scale: 0.1, rotation: -720, autoAlpha: 0 }, { scale: 1, rotation: -4, autoAlpha: 1, duration: 0.9, ease: 'power2.out' }, at + 0.1);
      break;
    case 'footprints':
      tl.fromTo(q(`${ep} .fx-door`), { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.4 }, at + 0.1);
      for (let v = 0; v < 3; v++) {
        tl.fromTo(q(`${ep} .fx-step-${v}`), { autoAlpha: 0 }, { autoAlpha: 0.85, duration: 0.15, stagger: 0.18 }, at + 0.4 + v * 0.25);
        tl.fromTo(q(`${ep} .fx-tag-${v}`), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3 }, at + 0.9 + v * 0.25);
      }
      break;
  }
  tl.to(q(ep), { autoAlpha: 0, duration: 0.3 }, end - 0.3);
}

// ───────────────────────────── общая часть ─────────────────────────────

function DeathMark({ style, soft }: { style: DeathStyle; soft: boolean }) {
  // след на рубашке упавшей карты — без убийцы
  switch (style) {
    case 'shot':
      return <BulletHole className="absolute top-[30%] left-[25%]" width={46} />;
    case 'knife':
      return <Knife className="absolute top-[34%] left-[18%] rotate-[-30deg]" width={84} />;
    case 'truck':
      return <div className="absolute inset-y-0 left-[30%] w-5 bg-[repeating-linear-gradient(0deg,#111_0_6px,transparent_6px_12px)] opacity-80" />;
    case 'piano':
    case 'brick':
      return <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,transparent_30%,rgba(120,100,80,0.55)_80%)]" />;
    case 'poison':
      return <div className="absolute inset-0 rounded-[10px] bg-[linear-gradient(to_top,rgba(20,60,20,0.9),transparent_70%)]" />;
    case 'explosion':
      return <div className="absolute inset-0 rounded-[10px] bg-[radial-gradient(circle_at_60%_60%,rgba(20,10,5,0.95),rgba(60,25,5,0.6)_40%,transparent_70%)]" />;
  }
  void soft;
}

function FallingCard({ player, role, style, soft, rules, width, name }: { player: string; role: import('@mafia/engine').RoleId | null; style: DeathStyle; soft: boolean; rules: Rules; width: number; name: NameOf }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width, height: width * 1.5, perspective: 900 }}>
        <div className="pd-flip relative h-full w-full" style={{ transformStyle: 'preserve-3d' }}>
          <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
            <CardBack width={width} />
            <DeathMark style={style} soft={soft} />
          </div>
          <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}>
            {role ? <CardFace role={role} team={teamOf(role, rules)} width={width} /> : <CardBack width={width} />}
          </div>
        </div>
      </div>
      <span className="mt-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-sm font-semibold text-paper">{name(player)}</span>
    </div>
  );
}

// ───────────────────────────── сцена ─────────────────────────────

export default function MorningScene({ presentation, view, name, display, prefs, quality, live, onComplete }: SceneOf<'nightReport'>) {
  const root = useRef<HTMLDivElement>(null);
  const [size] = useState(() => ({ w: Math.min(window.innerWidth, 480), h: window.innerHeight }));
  const reduced = quality === 'reduced';
  const me = view.you?.id ?? null;
  const plan = useMemo(() => morningPlan(presentation.report, presentation.round, me, display), [presentation, me, display]);
  const sched = useMemo<Schedule>(() => schedule(plan, reduced), [plan, reduced]);
  const cardW = Math.round(Math.min(size.w * 0.46, 190));
  const deadW = Math.round(Math.min(size.w * 0.26, 110));
  const episodes = plan.personal.slice(0, MAX_PERSONAL);
  const deaths = plan.public.filter((p) => p.kind === 'death').slice(0, 3);

  const bursts = useMemo<Burst[]>(() => {
    const list: Burst[] = [
      // утренняя пыль в лучах
      { at: sched.publicAt, x: 0.5, y: 0.5, count: 26, colors: ['#ffe2a8', '#ffffff'], shape: 'dot', speed: 0.05, jitter: 0.9, gravity: -0.01, drag: 0.1, life: 6, size: 0.002, seed: 4, loop: true },
    ];
    episodes.forEach((item, i) => {
      const slot = sched.personal[i]!;
      const hit = slot.at + 0.55;
      if (item.kind === 'heal') list.push({ at: slot.at + 1.12, x: 0.5, y: 0.4, count: 26, colors: [GREEN, '#c9ffe4'], shape: 'cross', speed: 0.5, gravity: -0.1, drag: 0.6, life: 1.2, size: 0.012, seed: 11 + i });
      if (item.kind === 'block') list.push({ at: slot.at + 0.62, x: 0.5, y: 0.4, count: 18, colors: [PINK, '#ffc0cf'], shape: 'heart', speed: 0.4, gravity: -0.12, drag: 0.6, life: 1.3, size: 0.014, seed: 21 + i });
      if (item.kind === 'link') list.push({ at: slot.at + 0.8, x: 0.5, y: 0.4, count: 22, colors: [PINK, '#ffd6e0'], shape: 'heart', speed: 0.45, gravity: -0.1, drag: 0.6, life: 1.3, size: 0.014, seed: 31 + i });
      if (item.kind === 'bless') list.push({ at: slot.at + 0.5, x: 0.5, y: 0.25, count: 30, colors: [GOLD, '#fff6d8'], shape: 'star', speed: 0.18, gravity: 0.08, drag: 0.4, life: 1.6, size: 0.01, seed: 41 + i });
      if (item.kind === 'guard' && item.saved) list.push({ at: slot.at + 1.06, x: 0.6, y: 0.33, count: 30, colors: ['#ffe9a8', '#ffffff'], shape: 'spark', speed: 1.2, gravity: 0.6, drag: 0.5, life: 0.8, size: 0.005, seed: 51 + i });
      if (item.kind === 'death') {
        const color = prefs.softEffects ? '#1d2a6b' : '#9a1020';
        if (item.style === 'shot') list.push({ at: hit + 0.18, x: 0.47, y: 0.36, count: prefs.softEffects ? 20 : 28, colors: prefs.softEffects ? ['#cfd6e6', '#6b7690'] : [color, '#d43a3a'], shape: prefs.softEffects ? 'smoke' : 'dot', speed: 0.5, gravity: 0.5, drag: 0.5, life: 0.9, size: prefs.softEffects ? 0.03 : 0.006, seed: 61 + i });
        if (item.style === 'piano' || item.style === 'brick' || item.style === 'truck') list.push({ at: hit + 0.2, x: 0.5, y: 0.52, count: 34, colors: ['#8a7a68', '#5a4c3e'], shape: 'smoke', speed: 0.35, gravity: -0.05, drag: 0.7, life: 1.3, size: 0.04, seed: 71 + i });
        if (item.style === 'piano') list.push({ at: hit + 0.2, x: 0.5, y: 0.5, count: 22, colors: ['#f2efe6', '#111'], shape: 'shard', speed: 0.9, gravity: 0.9, drag: 0.4, life: 1, size: 0.012, seed: 72 + i });
        if (item.style === 'poison') list.push({ at: hit + 0.2, x: 0.5, y: 0.45, count: 30, colors: ['#3f8a3a', '#1b3d18', '#88c76c'], shape: 'smoke', speed: 0.2, gravity: -0.14, drag: 0.6, life: 1.6, size: 0.05, seed: 81 + i });
        if (item.style === 'explosion') {
          list.push({ at: hit, x: 0.5, y: 0.4, count: 60, colors: ['#ffd27a', '#ff7b2a', '#ffffff'], shape: 'spark', speed: 1.6, gravity: 0.5, drag: 0.5, life: 1, size: 0.006, seed: 91 + i });
          list.push({ at: hit + 0.1, x: 0.5, y: 0.4, count: 30, colors: ['#3a2a22', '#5a4a40'], shape: 'smoke', speed: 0.4, gravity: -0.08, drag: 0.6, life: 1.6, size: 0.06, seed: 92 + i });
          list.push({ at: hit + 0.32, x: 0.5, y: 0.4, count: 24, colors: ['#2a1218', '#d4ad4f'], shape: 'shard', speed: 1, gravity: 0.8, drag: 0.4, life: 1.1, size: 0.014, seed: 93 + i });
        }
      }
    });
    deaths.forEach((_, i) => {
      const slot = sched.deaths[i]!;
      list.push({ at: slot.at + 0.55, x: (i + 1) / (deaths.length + 1), y: 0.74, count: 18, colors: ['#9c8a74', '#6a5b4a'], shape: 'smoke', speed: 0.25, gravity: -0.04, drag: 0.7, life: 1.1, size: 0.035, seed: 101 + i });
    });
    return list;
  }, [sched, episodes, deaths, prefs.softEffects]);

  const tl = useSceneTimeline(
    root,
    (tl) => {
      const q = gsap.utils.selector(root);
      tl.set(q('.ep, .pub, .mo-summary, .pd, .quiet, .extra'), { autoAlpha: 0 }, 0);
      tl.set(q('.fx-plaster, .fx-kiss, .fx-stamp, .fx-tape1, .fx-tape2, .fx-hole, .fx-drips, .fx-knife, .fx-shield, .fx-halo, .fx-beam, .fx-glow, .fx-arrow, .fx-ring, .fx-folder, .fx-paper, .fx-door, .fx-poison, .fx-flash, .fx-bullet, .fx-piano, .fx-brick, .fx-shadow, .fx-syringe, .fx-tag'), { autoAlpha: 0 }, 0);

      // 1. пробуждение: веки открываются, мир проступает из размытия
      const w = sched.wake;
      tl.call(() => sfx.play('wake'), undefined, 0.05);
      tl.fromTo(q('.mo-lid-top'), { yPercent: 0 }, { yPercent: -55, duration: w.duration * 0.35, ease: 'power2.out' }, w.at + 0.1);
      tl.fromTo(q('.mo-lid-bot'), { yPercent: 0 }, { yPercent: 55, duration: w.duration * 0.35, ease: 'power2.out' }, w.at + 0.1);
      tl.to(q('.mo-lid-top'), { yPercent: -20, duration: w.duration * 0.15, ease: 'power2.in' }, w.at + w.duration * 0.45);
      tl.to(q('.mo-lid-bot'), { yPercent: 20, duration: w.duration * 0.15, ease: 'power2.in' }, w.at + w.duration * 0.45);
      tl.to(q('.mo-lid-top'), { yPercent: -110, duration: w.duration * 0.35, ease: 'power3.out' }, w.at + w.duration * 0.62);
      tl.to(q('.mo-lid-bot'), { yPercent: 110, duration: w.duration * 0.35, ease: 'power3.out' }, w.at + w.duration * 0.62);
      tl.fromTo(q('.mo-haze'), { autoAlpha: 1 }, { autoAlpha: 0, duration: w.duration * 0.8 }, w.at + w.duration * 0.3);

      // 2. личная часть
      episodes.forEach((item, i) => {
        const slot = sched.personal[i]!;
        if (reduced) {
          tl.fromTo(q(`.ep-${i}`), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, slot.at);
          tl.set(q(`.ep-${i} [class*="fx-"]`), { autoAlpha: 1 }, slot.at);
          tl.to(q(`.ep-${i}`), { autoAlpha: 0, duration: 0.2 }, slot.at + slot.duration - 0.2);
        } else buildEpisode(tl, q, item, i, slot.at, slot.duration, size.w);
      });

      // 3. общая часть: рассвет, погибшие на столе
      tl.set(q('.mo-personal'), { autoAlpha: episodes.length > 0 ? 1 : 0 }, 0);
      tl.to(q('.mo-personal'), { autoAlpha: 0, duration: 0.4 }, sched.publicAt);
      tl.fromTo(q('.pub'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, sched.publicAt);
      tl.call(() => sfx.play('dawn'), undefined, sched.publicAt);
      tl.fromTo(q('.mo-dawn'), { autoAlpha: 0 }, { autoAlpha: 1, duration: sched.sky.duration, ease: 'sine.inOut' }, sched.sky.at);
      tl.fromTo(q('.mo-sun'), { yPercent: 70 }, { yPercent: 0, duration: sched.sky.duration + 1.5, ease: 'power1.out' }, sched.sky.at);
      tl.fromTo(q('.mo-title'), { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.6 }, sched.sky.at + 0.3);
      deaths.forEach((d, i) => {
        const slot = sched.deaths[i]!;
        const sel = `.pd-${i}`;
        const rot = ((hash(`${d.kind === 'death' ? d.player : i}`) % 40) - 20);
        tl.fromTo(q(sel), { y: -size.h * 0.8, rotation: rot * 3, autoAlpha: 1 }, { y: 0, rotation: rot / 4, duration: reduced ? 0.2 : 0.55, ease: 'power3.in' }, slot.at);
        tl.call(() => {
          sfx.play('thud');
          vibrate('tap');
        }, undefined, slot.at + 0.55);
        if (!reduced) tl.to(q(sel), { y: -8, duration: 0.1, yoyo: true, repeat: 1, ease: 'power1.out' }, slot.at + 0.55);
        if (d.kind === 'death' && d.role) {
          tl.call(() => sfx.play('flip'), undefined, slot.at + 0.95);
          tl.to(q(`${sel} .pd-flip`), { rotationY: 180, duration: 0.45, ease: 'power2.inOut', stagger: 0.12 }, slot.at + 0.95);
        }
      });
      if (sched.quiet) {
        tl.fromTo(q('.quiet'), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6 }, sched.quiet.at);
        tl.fromTo(q('.bird'), { x: -60, y: 0 }, { x: size.w + 60, y: -40, duration: 3, ease: 'none', stagger: 0.25 }, sched.quiet.at);
      }
      if (sched.extras) tl.fromTo(q('.extra'), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.2 }, sched.extras.at);

      // 4. сводка и «Готов»
      tl.to(q('.pub-stage'), { y: -size.h * 0.05, duration: 0.5, ease: 'power2.inOut' }, sched.summaryAt);
      tl.fromTo(q('.mo-summary'), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, sched.summaryAt);
      tl.set({}, {}, sched.total);
      return { skip: () => tl.progress(1) };
    },
    [],
  );

  useLayoutEffect(() => {
    sfx.preload(['wake', 'shot', 'thud', 'crash', 'pop', 'stamp', 'paper', 'dawn', 'flip', 'sparkle', 'tape', 'engine', 'explosion', 'poison', 'whoosh']);
  }, []);

  const getTime = useCallback(() => tl.current?.time() ?? 0, [tl]);
  const rules = view.rules;
  const publicLines = presentation.report.public.map((b) => describeBeat(b, name)).filter((l): l is NonNullable<typeof l> => l !== null);
  const privateLines = presentation.report.private.map((b) => describeBeat(b, name)).filter((l): l is NonNullable<typeof l> => l !== null);

  return (
    <div ref={root} data-testid="night-report" data-scene="morning" className="fixed inset-0 z-30 overflow-hidden bg-[#06070c] select-none">
      {/* небо: ночь → рассвет */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#05060d,#0d1226_60%,#1a1220)]" />
      <div className="mo-dawn absolute inset-0 bg-[linear-gradient(to_bottom,#2a3a66_0%,#c46a5a_48%,#f2b46a_64%,#3a1c16_100%)]" />
      <div className="mo-sun absolute left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#fff3c8,#ffc25e_45%,rgba(255,150,60,0)_70%)]" style={{ top: '30%' }} />
      <Skyline className="absolute inset-x-0 h-[18%] w-full" style={{ top: '34%' }} />

      {/* общая часть */}
      <div className="pub absolute inset-0">
        <div className="pub-stage absolute inset-0" style={{ transformOrigin: '50% 30%' }}>
          <p className="mo-title absolute inset-x-0 top-[8%] text-center">
            <span className="block font-display text-4xl text-paper drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">{t.game.morning.title}</span>
            <span className="font-display text-paper/80 italic">
              {t.game.morning.subtitle} · {t.log.night(presentation.round)}
            </span>
          </p>
          {/* стол */}
          <div
            className="absolute left-1/2 rounded-[50%]"
            style={{
              top: '47%',
              width: size.w * 1.35,
              height: size.h * 0.42,
              marginLeft: -size.w * 0.675,
              background: 'radial-gradient(50% 50% at 50% 40%, #4a1422 0%, #2a0a14 55%, #0e0307 100%)',
              boxShadow: 'inset 0 0 0 3px rgba(212,173,79,0.35), inset 0 30px 60px rgba(0,0,0,0.6)',
            }}
          />
          <div className="absolute inset-x-0 flex justify-center gap-3" style={{ top: '50%' }}>
            {deaths.map((d, i) =>
              d.kind === 'death' ? (
                <div key={d.player} className={`pd pd-${i} flex gap-1`}>
                  <FallingCard player={d.player} role={d.role} style={d.style} soft={prefs.softEffects} rules={rules} width={d.with ? deadW * 0.8 : deadW} name={name} />
                  {d.with ? <FallingCard player={d.with.player} role={d.with.role} style={d.style} soft={prefs.softEffects} rules={rules} width={deadW * 0.8} name={name} /> : null}
                </div>
              ) : null,
            )}
          </div>
          {plan.quiet ? (
            <div className="quiet absolute inset-x-0 text-center" style={{ top: '54%' }}>
              <p className="font-display text-2xl text-paper">{t.game.morning.nobodyDied}</p>
              <p className="mt-1 text-sm text-paper/70">Город проснулся в полном составе.</p>
            </div>
          ) : null}
          {plan.quiet
            ? [0, 1, 2].map((b) => <Bird key={b} className="bird absolute" width={22 + b * 4} style={{ top: `${18 + b * 4}%`, left: 0 }} />)
            : null}
          <div className="absolute inset-x-0 flex flex-col items-center gap-1" style={{ top: '76%' }}>
            {plan.public.map((p, i) =>
              p.kind === 'saved' ? (
                <span key={`s${i}`} className="extra rounded-full bg-black/60 px-3 py-1 text-sm text-[#8fd6b4]">
                  ✚ {t.game.morning.someoneSaved}
                </span>
              ) : p.kind === 'silenced' ? (
                <span key={`m${i}`} className="extra rounded-full bg-black/60 px-3 py-1 text-sm text-paper/90">
                  {t.game.morning.silenced(name(p.player))}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* личная часть */}
      <div className="mo-personal absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_40%,rgba(30,36,60,0.92),rgba(5,6,12,0.97))]">
        {episodes.map((item, i) => (
          <Episode key={i} item={item} index={i} cardW={cardW} plan={plan} rules={rules} soft={prefs.softEffects} name={name} />
        ))}
      </div>

      <ParticleCanvas bursts={bursts} getTime={getTime} quality={quality} />

      {/* пробуждение */}
      <div className="mo-haze pointer-events-none absolute inset-0 bg-[radial-gradient(60%_30%_at_50%_50%,rgba(255,190,140,0.18),rgba(10,11,18,0.85))] backdrop-blur-md" />
      <div className="mo-lid-top pointer-events-none absolute inset-x-[-30%] top-0 h-[56%] rounded-b-[50%] bg-[linear-gradient(to_bottom,#000_70%,#140a08)] shadow-[0_18px_30px_-6px_rgba(0,0,0,0.95)]">
      </div>
      <div className="mo-lid-bot pointer-events-none absolute inset-x-[-30%] bottom-0 h-[56%] rounded-t-[50%] bg-[linear-gradient(to_top,#000_70%,#140a08)] shadow-[0_-18px_30px_-6px_rgba(0,0,0,0.95)]" />

      {/* сводка */}
      <div className="mo-summary safe-bottom absolute inset-x-0 bottom-0 max-h-[40%] overflow-y-auto rounded-t-[26px] border-t border-gold-400/30 bg-coal/95 px-5 pt-4 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <ul className="space-y-1.5">
          {publicLines.map((l, i) => (
            <li key={i} className={cx('text-[15px] leading-snug', TONE_CLASS[l.tone])}>
              {l.text}
            </li>
          ))}
        </ul>
        {me && privateLines.length > 0 ? <PrivateLines lines={privateLines} /> : null}
        <div className="pt-3 pb-3">
          <button
            type="button"
            data-testid="report-ready"
            onClick={onComplete}
            className="h-14 w-full rounded-2xl bg-gradient-to-b from-gold-300 to-gold-500 font-semibold text-ink active:scale-[0.98]"
          >
            {live ? t.game.ready : view.phase === 'ended' ? 'Дальше' : t.common.close}
          </button>
        </div>
      </div>
      <SceneTextForTests personal={episodes.length} />
    </div>
  );
}

function PrivateLines({ lines }: { lines: { text: string; tone: keyof typeof TONE_CLASS }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      data-testid="private-card"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="mt-3 w-full rounded-2xl border border-gold-400/40 bg-gradient-to-b from-gold-400/12 to-black/40 p-3 text-left"
    >
      <span className="text-xs font-bold tracking-[0.18em] text-gold-300 uppercase">{t.game.morning.privateTitle}</span>
      {open ? (
        <ul className="mt-1.5 space-y-1">
          {lines.map((l, i) => (
            <li key={i} className={cx('text-[14px] leading-snug', TONE_CLASS[l.tone])}>
              {l.text}
            </li>
          ))}
        </ul>
      ) : (
        <span className="mt-0.5 block text-sm text-muted">{t.game.morning.privateTap}</span>
      )}
    </button>
  );
}

/** Невидимая метка для e2e: сколько личных эпизодов в сцене. */
function SceneTextForTests({ personal }: { personal: number }) {
  return <span hidden data-testid="morning-episodes" data-count={personal} />;
}
