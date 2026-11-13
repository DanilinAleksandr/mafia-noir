/**
 * /dev/scenes — только в разработке. Все сцены с выбором роли и режима, «Мягкие эффекты»,
 * «Уменьшить анимацию», скорость (×0.25…×1), пауза, покадровая прокрутка и ползунок.
 *
 * Параметры адреса (для скриншотов): ?scene=roleReveal&role=mafia&display=cinema&soft=1
 * &reduce=0&speed=0.25&at=0.5&ui=0 — `at` перематывает сцену к доле таймлайна (или `t` — к секунде)
 * и ставит паузу,
 * `ui=0` прячет панель.
 */
import { ROLE_IDS, isRoleId } from '@mafia/engine';
import type { RoleId } from '@mafia/engine';
import type { DisplayMode } from '@mafia/protocol';
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { roleName } from '../i18n';
import type { PresentationKind } from '../presenter/presenter';
import { sceneClock } from '../scenes/clock';
import { SCENES, SCENE_TITLES } from '../scenes/registry';
import { SceneStage } from '../scenes/SceneStage';
import { quality, setPrefs, usePrefs } from '../settings/prefs';
import { LAB_NAMES, labCase } from './labData';

const KINDS = Object.keys(SCENE_TITLES) as PresentationKind[];
const SPEEDS = [1, 0.5, 0.25];

function useClock() {
  return useSyncExternalStore(sceneClock.subscribe, () => `${sceneClock.speed}|${sceneClock.paused}|${Boolean(sceneClock.current)}`);
}

/** Текущая доля таймлайна — опрашивается по кадрам, пока панель открыта. */
function useProgress(active: boolean): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const loop = () => {
      setValue(sceneClock.current?.timeline.progress() ?? 0);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return value;
}

export default function ScenesLab() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [kind, setKind] = useState<PresentationKind>(() => (KINDS.includes(params.get('scene') as PresentationKind) ? (params.get('scene') as PresentationKind) : 'roleReveal'));
  const [role, setRole] = useState<RoleId>(() => {
    const r = params.get('role');
    return isRoleId(r) ? r : 'mafia';
  });
  const [display, setDisplay] = useState<DisplayMode>(() => (['stealth', 'open', 'cinema'].includes(params.get('display') ?? '') ? (params.get('display') as DisplayMode) : 'stealth'));
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const [ui, setUi] = useState(params.get('ui') !== '0');
  const prefs = usePrefs();
  useClock();
  const progress = useProgress(ui);

  // начальные настройки из адреса
  useEffect(() => {
    const patch: Parameters<typeof setPrefs>[0] = {};
    if (params.has('soft')) patch.softEffects = params.get('soft') === '1';
    if (params.has('reduce')) patch.reduceMotion = params.get('reduce') === '1';
    if (params.has('sound')) patch.sound = params.get('sound') === '1';
    if (Object.keys(patch).length) setPrefs(patch);
    sceneClock.reset();
    if (params.has('speed')) sceneClock.setSpeed(Number(params.get('speed')));
  }, [params]);

  // перемотка для скриншотов: как только сцена зарегистрировала таймлайн
  useEffect(() => {
    const at = params.get('at');
    const time = params.get('t');
    if (at === null && time === null) return;
    const apply = () => {
      if (!sceneClock.current) return false;
      // даём сцене отрисовать первый кадр
      requestAnimationFrame(() => {
        if (time !== null) sceneClock.seekTime(Number(time));
        else sceneClock.seek(Number(at));
        document.body.dataset.sceneReady = '1';
      });
      return true;
    };
    if (apply()) return;
    const off = sceneClock.subscribe(() => {
      if (apply()) off();
    });
    return off;
  }, [params, run]);

  const data = useMemo(() => labCase(kind, role, display === 'cinema'), [kind, role, display]);
  const Scene = SCENES[kind];
  const name = (id: string) => LAB_NAMES[Number(id.slice(1)) - 1] ?? id;
  const restart = () => {
    setDone(false);
    setRun((n) => n + 1);
  };

  return (
    <div className="min-h-dvh bg-ink">
      {!done ? (
        <SceneStage hostSkip={null}>
          <Suspense fallback={<div className="fixed inset-0 bg-ink" />}>
            <Scene
              key={`${kind}-${role}-${display}-${run}-${prefs.reduceMotion}`}
              presentation={data.presentation}
              view={data.view}
              name={name}
              display={display}
              prefs={prefs}
              quality={quality(prefs)}
              live={false}
              onComplete={() => setDone(true)}
            />
          </Suspense>
        </SceneStage>
      ) : (
        <div className="flex min-h-dvh items-center justify-center text-muted">Сцена завершена</div>
      )}

      {ui ? (
        <div className="fixed inset-x-0 bottom-0 z-[90] max-h-[46dvh] overflow-y-auto border-t border-white/10 bg-black/85 p-3 text-xs text-paper backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
          <div className="mb-2 flex flex-wrap gap-2">
            <select value={kind} onChange={(e) => { setKind(e.target.value as PresentationKind); restart(); }} className="rounded bg-ash px-2 py-1">
              {KINDS.map((k) => <option key={k} value={k}>{SCENE_TITLES[k]}</option>)}
            </select>
            <select value={role} onChange={(e) => { setRole(e.target.value as RoleId); restart(); }} className="rounded bg-ash px-2 py-1">
              {ROLE_IDS.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
            </select>
            <select value={display} onChange={(e) => { setDisplay(e.target.value as DisplayMode); restart(); }} className="rounded bg-ash px-2 py-1">
              <option value="stealth">Скрытный</option>
              <option value="open">Открытый состав</option>
              <option value="cinema">Кино</option>
            </select>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" checked={prefs.softEffects} onChange={(e) => setPrefs({ softEffects: e.target.checked })} /> Мягкие эффекты</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => setPrefs({ reduceMotion: e.target.checked })} /> Уменьшить анимацию</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} /> Звук</label>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => sceneClock.setSpeed(s)} className={`rounded px-2 py-1 ${sceneClock.speed === s ? 'bg-gold-400 text-ink' : 'bg-ash'}`}>×{s}</button>
            ))}
            <button type="button" onClick={() => sceneClock.setPaused(!sceneClock.paused)} className="rounded bg-ash px-2 py-1">{sceneClock.paused ? '▶ Пуск' : '❚❚ Пауза'}</button>
            <button type="button" onClick={() => sceneClock.step(-1 / 60)} className="rounded bg-ash px-2 py-1">◀ кадр</button>
            <button type="button" onClick={() => sceneClock.step(1 / 60)} className="rounded bg-ash px-2 py-1">кадр ▶</button>
            <button type="button" onClick={() => sceneClock.skip()} className="rounded bg-ash px-2 py-1">Тап</button>
            <button type="button" onClick={restart} className="rounded bg-ash px-2 py-1">↺ Заново</button>
            <button type="button" onClick={() => setUi(false)} className="ml-auto rounded bg-ash px-2 py-1">Скрыть</button>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(e) => sceneClock.seek(Number(e.target.value) / 1000)}
            className="w-full"
            aria-label="Положение в сцене"
          />
          <p className="text-faint">{(progress * 100).toFixed(1)}% · {sceneClock.current ? `${sceneClock.current.timeline.time().toFixed(2)} с из ${sceneClock.current.timeline.duration().toFixed(2)} с` : 'сцена без таймлайна'}</p>
        </div>
      ) : params.get('ui') === '0' ? null : (
        <button type="button" onClick={() => setUi(true)} className="fixed right-2 bottom-2 z-[90] rounded bg-black/60 px-2 py-1 text-xs text-muted">панель</button>
      )}
    </div>
  );
}
