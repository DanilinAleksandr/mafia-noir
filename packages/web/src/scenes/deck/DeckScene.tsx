/**
 * Сцена «Колода» — выдача роли.
 *
 * Колода рубашками вверх внизу экрана → игрок нажимает → верхняя карта срывается, летит по дуге
 * с вращением, растёт и встаёт по центру → переворот со вспышкой и искрами цвета команды →
 * название роли пишется по буквам, под ним описание → карточка-голограмма в полный рост.
 * Мафия видит напарников маленькими карточками внизу. «Спрятать» возвращает карту в колоду
 * и завершает сцену. Тап во время анимации — сразу к концу.
 */
import type { PlayerId } from '@mafia/engine';
import { gsap } from 'gsap';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CardBack, CardFace } from '../../components/RoleCard';
import { HoloCard } from '../../components/HoloCard';
import { roleName, t } from '../../i18n';
import { vibrate } from '../../settings/haptics';
import { TEAM_PALETTE } from '../../theme/tokens';
import { sfx } from '../audio/sfx';
import { ParticleCanvas } from '../fx/ParticleCanvas';
import type { Burst } from '../fx/particles';
import type { SceneOf } from '../types';
import { useSceneTimeline } from '../useSceneTimeline';

const DECK_SIZE = 7;
const DECK_W = 112;

/** Опорные моменты таймлайна, с. */
const T = {
  wait: 1.0,
  lift: 1.02,
  fly: 1.22,
  land: 1.98,
  flip: 2.12,
  flash: 2.4,
  name: 2.62,
  shown: 3.9,
};

export default function DeckScene({ view, name, quality, onComplete }: SceneOf<'roleReveal'>) {
  const you = view.you;
  const root = useRef<HTMLDivElement>(null);
  const [size] = useState(() => ({ w: Math.min(window.innerWidth, 480), h: window.innerHeight }));
  const reduced = quality === 'reduced';
  const teammates = useMemo(
    () => (you?.team === 'black' ? view.players.filter((p) => p.team === 'black' && p.id !== you.id) : []),
    [view.players, you],
  );
  // компоновка по высоте: шапка, карта, название с описанием, напарники, кнопка
  const TOP = 92;
  const TITLE_H = 112;
  const MATES_H = teammates.length > 0 ? 112 : 0;
  const BUTTON_H = 92;
  const cardH = Math.round(Math.min(405, size.h - TOP - TITLE_H - MATES_H - BUTTON_H - 12, (size.w * 0.68) * 1.5));
  const cardW = Math.round(cardH / 1.5);
  const centerY = TOP + cardH / 2;
  const titleTop = TOP + cardH + 12;
  const deckY = size.h - 74 - (DECK_W * 1.5) / 2;
  const team = you?.team ?? 'red';
  const palette = TEAM_PALETTE[team];
  const roleTitle = you ? roleName(you.role) : '';
  const letters = useMemo(() => Array.from(roleTitle), [roleTitle]);
  const hiding = useRef(false);
  /** Карта уже взята из колоды. */
  const taken = useRef(false);

  const bursts = useMemo<Burst[]>(
    () => [
      // пыль в луче прожектора — всё время
      { at: 0, x: 0.5, y: 0.55, count: 34, colors: ['#e9d9b0', '#9fb4d8'], shape: 'dot', speed: 0.06, jitter: 0.9, gravity: -0.012, drag: 0.1, life: 7, size: 0.0022, seed: 21, loop: true },
      // искры раскрытия вылетают за края карты
      { at: T.flash, x: 0.5, y: centerY / size.h, count: 110, colors: [palette.primary, palette.trim, '#fff6d8'], shape: 'spark', speed: 2.1, jitter: 0.55, gravity: 0.55, drag: 0.55, life: 1.3, size: 0.0065, seed: 3 },
      { at: T.flash + 0.05, x: 0.5, y: centerY / size.h, count: 26, colors: ['#ffe9a8', palette.trim], shape: 'star', speed: 0.95, gravity: 0.08, drag: 0.6, life: 1.6, size: 0.012, seed: 9 },
      { at: T.flash, x: 0.5, y: centerY / size.h, count: 26, colors: [team === 'black' ? '#8a6a2a' : palette.primary], shape: 'smoke', speed: 0.5, gravity: -0.05, drag: 0.7, life: 1.4, size: 0.05, seed: 5 },
    ],
    [centerY, size.h, palette],
  );

  const tl = useSceneTimeline(
    root,
    (tl) => {
      const q = (sel: string) => root.current?.querySelectorAll(sel) ?? [];
      const startX = 0;
      const startY = deckY - centerY - DECK_SIZE * 1.6;
      const startScale = DECK_W / cardW;

      // исходное положение: летящая карта лежит на вершине колоды рубашкой вверх
      tl.set('.dk-flyer', { x: startX, y: startY, scale: startScale, rotation: 0, autoAlpha: 0 }, 0);
      tl.set('.dk-flipper', { rotationY: 0 }, 0);
      tl.set(['.dk-flash', '.dk-ring'], { autoAlpha: 0 }, 0);
      tl.set(['.dk-letter', '.dk-desc', '.dk-team', '.dk-buttons', '.dk-mate'], { autoAlpha: 0 }, 0);

      // 1. колода появляется
      tl.fromTo('.dk-title', { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0.05);
      tl.fromTo(
        q('.dk-deck-card'),
        { y: 90, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.55, ease: 'back.out(1.6)', stagger: 0.05 },
        0.1,
      );
      tl.to('.dk-flyer', { autoAlpha: 1, duration: 0.01 }, 0.1 + DECK_SIZE * 0.05 + 0.3);
      tl.fromTo('.dk-prompt', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.7);
      tl.addPause(T.wait);

      // 2. карта срывается и летит по дуге
      tl.to(['.dk-prompt', '.dk-subtitle'], { autoAlpha: 0, duration: 0.2 }, T.lift);
      tl.call(() => {
        sfx.play('deal');
        vibrate('tap');
      }, undefined, T.lift);
      tl.to('.dk-flyer', { y: startY - 26, scale: startScale * 1.08, duration: 0.2, ease: 'power2.out' }, T.lift);
      if (reduced) {
        tl.to('.dk-flyer', { x: 0, y: 0, scale: 1, duration: 0.3, ease: 'power2.out' }, T.fly);
      } else {
        tl.call(() => sfx.play('whoosh'), undefined, T.fly);
        const flight = T.land - T.fly;
        tl.to('.dk-flyer', { x: size.w * 0.16, duration: flight * 0.5, ease: 'sine.out' }, T.fly);
        tl.to('.dk-flyer', { x: 0, duration: flight * 0.5, ease: 'sine.in' }, T.fly + flight * 0.5);
        tl.to('.dk-flyer', { y: 0, duration: flight, ease: 'power2.inOut' }, T.fly);
        tl.to('.dk-flyer', { rotation: -360, duration: flight, ease: 'power2.out' }, T.fly);
        tl.to('.dk-flyer', { scale: 1, duration: flight, ease: 'power3.out' }, T.fly);
        tl.to('.dk-flyer', { scale: 1.05, duration: 0.07, ease: 'power1.out' }, T.land);
        tl.to('.dk-flyer', { scale: 1, duration: 0.14, ease: 'power2.inOut' }, T.land + 0.07);
        tl.to(q('.dk-deck-card'), { y: 6, duration: 0.2, yoyo: true, repeat: 1, stagger: 0.02 }, T.lift);
      }

      // колода и стол уходят вниз — место для названия и напарников
      tl.to(q('.dk-deck, .dk-table'), { y: 220, autoAlpha: 0, duration: 0.5, ease: 'power2.in' }, T.land - 0.2);

      // 3. переворот со вспышкой
      tl.call(() => {
        sfx.play('flip');
        vibrate('flip');
      }, undefined, T.flip);
      tl.to('.dk-flipper', { rotationY: 180, duration: reduced ? 0.35 : 0.55, ease: 'power2.inOut' }, T.flip);
      if (!reduced) {
        tl.to('.dk-flyer', { y: -14, duration: 0.27, ease: 'power2.out', yoyo: true, repeat: 1 }, T.flip);
        tl.call(() => sfx.play('reveal'), undefined, T.flash - 0.05);
        tl.fromTo('.dk-flash', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08, ease: 'power1.out' }, T.flash);
        tl.to('.dk-flash', { autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, T.flash + 0.08);
        tl.fromTo('.dk-ring', { autoAlpha: 0.9, scale: 0.4 }, { autoAlpha: 0, scale: 2.6, duration: 0.9, ease: 'power2.out' }, T.flash);
      }

      // 4. название по буквам, описание, напарники, кнопки
      if (reduced) {
        tl.to(['.dk-letter', '.dk-team', '.dk-desc'], { autoAlpha: 1, duration: 0.3 }, T.name);
      } else {
        tl.to('.dk-team', { autoAlpha: 1, duration: 0.4 }, T.name - 0.1);
        tl.fromTo(
          q('.dk-letter'),
          { autoAlpha: 0, y: 16, rotationX: -80 },
          { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.42, ease: 'back.out(2)', stagger: 0.055 },
          T.name,
        );
        for (let i = 0; i < letters.length; i += 2) tl.call(() => sfx.play('tick', { volume: 0.35 }), undefined, T.name + i * 0.055);
        tl.fromTo('.dk-desc', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, T.name + letters.length * 0.055 + 0.1);
      }
      tl.fromTo(q('.dk-mate'), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'back.out(1.4)', stagger: 0.12 }, T.shown - 0.6);
      tl.fromTo('.dk-buttons', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4 }, T.shown - 0.35);
      tl.set({}, {}, T.shown);

      return {
        // тап: во вступлении — к ожиданию колоды, у колоды — взять карту, во время раскрытия — к концу
        skip: () => {
          if (hiding.current) return;
          const time = tl.time();
          const started = taken.current || time > T.wait + 0.01;
          if (time < T.wait - 0.001) tl.seek(T.wait);
          else if (!started) {
            taken.current = true;
            tl.play(T.wait + 0.001);
          } else if (time < T.shown) tl.progress(1);
        },
      };
    },
    [],
  );

  useLayoutEffect(() => {
    sfx.preload(['deal', 'whoosh', 'flip', 'reveal', 'tick', 'hide']);
  }, []);

  const hide = useCallback(() => {
    if (hiding.current) return;
    hiding.current = true;
    sfx.play('hide');
    vibrate('tap');
    const startY = deckY - centerY - DECK_SIZE * 1.6;
    const q = gsap.utils.selector(root);
    const back = gsap.timeline({ onComplete });
    back.to(q('.dk-buttons, .dk-desc, .dk-letter, .dk-team, .dk-mate'), { autoAlpha: 0, duration: 0.2 }, 0);
    back.to(q('.dk-deck, .dk-table'), { y: 0, autoAlpha: 1, duration: 0.35, ease: 'power2.out' }, 0.05);
    back.to(q('.dk-flipper'), { rotationY: 360, duration: reduced ? 0.2 : 0.4, ease: 'power2.inOut' }, 0.05);
    back.to(q('.dk-flyer'), { x: 0, y: startY, scale: DECK_W / cardW, rotation: 0, duration: reduced ? 0.25 : 0.55, ease: 'power3.in' }, 0.25);
    back.to(q('.dk-deck-card'), { y: 4, duration: 0.1, yoyo: true, repeat: 1 }, reduced ? 0.5 : 0.8);
    back.to(root.current, { autoAlpha: 0, duration: 0.3 }, reduced ? 0.55 : 0.95);
  }, [cardW, centerY, deckY, onComplete, reduced]);

  const getTime = useCallback(() => tl.current?.time() ?? 0, [tl]);

  if (!you) return null;
  return (
    <div
      ref={root}
      data-testid="role-reveal"
      data-scene="deck"
      className="fixed inset-0 z-30 overflow-hidden select-none"
      style={{ background: 'radial-gradient(70% 45% at 50% 42%, #1c2238 0%, #0a0d18 55%, #030407 100%)' }}
    >
      {/* луч прожектора и виньетка */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(38% 30% at 50% ${(centerY / size.h) * 100}%, ${palette.primary}33, transparent 70%), radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,0.75) 100%)`,
        }}
      />
      <div className="dk-flash pointer-events-none absolute inset-0" style={{ background: `radial-gradient(45% 32% at 50% ${(centerY / size.h) * 100}%, #ffffffee, ${palette.primary}aa 45%, transparent 75%)` }} />

      <header className="dk-title safe-top absolute inset-x-0 top-0 pt-8 text-center">
        <p className="text-[11px] font-bold tracking-[0.4em] text-gold-300/80 uppercase">{t.game.yourRole}</p>
        <p className="dk-subtitle mt-2 font-display text-2xl text-paper/90 italic">Судьба уже в колоде</p>
      </header>

      {/* бархатный стол под колодой */}
      <div
        className="dk-table pointer-events-none absolute left-1/2 rounded-[50%]"
        style={{
          top: deckY - 40,
          width: size.w * 1.3,
          height: 260,
          marginLeft: -size.w * 0.65,
          background: 'radial-gradient(50% 50% at 50% 50%, #3a0f1c 0%, #22070f 60%, #0b0306 100%)',
          boxShadow: 'inset 0 0 0 2px rgba(212,173,79,0.35), inset 0 18px 40px rgba(0,0,0,0.7), 0 -10px 60px rgba(122,22,40,0.25)',
        }}
      />
      {/* колода */}
      <div className="dk-deck absolute left-1/2" style={{ top: deckY - (DECK_W * 1.5) / 2, marginLeft: -DECK_W / 2, width: DECK_W, height: DECK_W * 1.5 }}>
        <div className="absolute -inset-6 rounded-full bg-gold-400/10 blur-2xl" />
        {Array.from({ length: DECK_SIZE }, (_, i) => (
          <div
            key={i}
            className="dk-deck-card absolute inset-0"
            style={{ transform: `translate(${(i % 2 ? 1 : -1) * (i * 0.4)}px, ${-i * 1.6}px) rotate(${((i * 37) % 7) - 3}deg)` }}
          >
            <CardBack width={DECK_W} />
          </div>
        ))}
      </div>
      <p className="dk-prompt pointer-events-none absolute inset-x-0 text-center" style={{ top: deckY - (DECK_W * 1.5) / 2 - 56 }}>
        <span className="inline-flex animate-pulse items-center gap-2 rounded-full border border-gold-400/30 bg-black/40 px-4 py-1.5 text-sm text-gold-100">
          Нажмите на колоду
        </span>
      </p>

      {/* кольцо вспышки */}
      <div
        className="dk-ring pointer-events-none absolute left-1/2 rounded-full border-2"
        style={{ top: centerY - cardW * 0.6, width: cardW * 1.2, height: cardW * 1.2, marginLeft: -cardW * 0.6, borderColor: palette.trim, boxShadow: `0 0 40px ${palette.primary}` }}
      />

      {/* летящая карта */}
      <div className="dk-flyer absolute left-1/2" style={{ top: centerY - cardH / 2, marginLeft: -cardW / 2, width: cardW, height: cardH }}>
        <HoloCard width={cardW} disabled={reduced}>
          <div className="dk-flipper relative h-full w-full" style={{ transformStyle: 'preserve-3d' }}>
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
              <CardBack width={cardW} />
            </div>
            <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}>
              <CardFace role={you.role} team={you.team} width={cardW} />
            </div>
          </div>
        </HoloCard>
      </div>

      <ParticleCanvas bursts={bursts} getTime={getTime} quality={quality} />

      {/* название и описание */}
      <div className="absolute inset-x-0 px-6 text-center" style={{ top: titleTop }}>
        <p className="dk-team text-[11px] font-bold tracking-[0.32em] uppercase" style={{ color: palette.trim }}>
          {t.teams[team].name} · {t.teams[team].plural}
        </p>
        <h2 className="mt-1 font-display text-[34px] leading-tight font-bold" style={{ perspective: 400, textShadow: `0 0 24px ${palette.primary}` }} data-testid="revealed-role" aria-label={roleTitle}>
          {letters.map((ch, i) => (
            <span key={i} className="dk-letter inline-block" aria-hidden style={{ whiteSpace: 'pre' }}>
              {ch}
            </span>
          ))}
        </h2>
        <p className="dk-desc mx-auto mt-1 max-w-xs text-[14px] leading-snug text-paper/75">{t.roles[you.role].short}</p>
      </div>

      {/* напарники мафии */}
      {teammates.length > 0 ? (
        <div className="absolute inset-x-0 flex justify-center gap-3" style={{ top: titleTop + TITLE_H }}>
          {teammates.map((p) => (
            <Mate key={p.id} id={p.id} name={name(p.id)} role={p.role} />
          ))}
        </div>
      ) : null}

      <div className="dk-buttons safe-bottom absolute inset-x-0 bottom-0 mx-auto flex max-w-md gap-3 px-5 pb-4" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          data-testid="role-ok"
          onClick={hide}
          className="h-14 flex-1 rounded-2xl bg-gradient-to-b from-gold-300 to-gold-500 font-semibold text-ink shadow-[0_8px_24px_-10px_rgb(212_173_79/0.7)] active:scale-[0.98]"
        >
          Спрятать
        </button>
      </div>
    </div>
  );
}

function Mate({ id, name, role }: { id: PlayerId; name: string; role: import('@mafia/engine').RoleId | null }) {
  return (
    <div className="dk-mate flex w-20 flex-col items-center text-center" data-testid="teammate" data-id={id}>
      <div className="relative" style={{ width: 52, height: 78 }}>
        {role ? <CardFace role={role} team="black" width={52} /> : <CardBack width={52} />}
      </div>
      <span className="mt-1 w-full truncate text-xs font-semibold text-paper/90">{name}</span>
      {role ? <span className="text-[10px] text-team-black-gold">{roleName(role)}</span> : null}
    </div>
  );
}
