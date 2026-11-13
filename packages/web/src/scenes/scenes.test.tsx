/**
 * Инфраструктура сцен: частицы как функция времени, часы сцен, сцена «Колода», «Блокнот».
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gsap } from 'gsap';
import { describe, expect, it, vi } from 'vitest';
import { NightPanel } from '../screens/game/NightPanel';
import { GameScreen } from '../screens/game/GameScreen';
import { Notebook } from '../screens/game/MafiaChat';
import { getPrefs } from '../settings/prefs';
import { newGame, renderWith, room, snapshot, storeWith } from '../test/fixtures';
import { sceneClock } from './clock';
import DeckScene from './deck/DeckScene';
import { type Burst, drawBursts } from './fx/particles';

/** Холст-подделка: считает нарисованные частицы и запоминает их положения. */
function fakeCtx() {
  const points: [number, number][] = [];
  let tx = 0;
  let ty = 0;
  const ctx = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: () => {
      tx = 0;
      ty = 0;
    },
    translate: (x: number, y: number) => {
      tx = x;
      ty = y;
      points.push([Math.round(tx), Math.round(ty)]);
    },
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    globalAlpha: 1,
    fillStyle: '#fff',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points };
}

const BURST: Burst = { at: 1, x: 0.5, y: 0.5, count: 20, colors: ['#f00'], shape: 'spark', speed: 1, gravity: 0.5, life: 1, size: 0.01, seed: 4 };

describe('Частицы', () => {
  it('до начала вспышки ничего не рисуется, после — частицы на месте', () => {
    const before = fakeCtx();
    expect(drawBursts(before.ctx, 400, 800, [BURST], 0.5)).toBe(false);
    expect(before.points).toHaveLength(0);
    const during = fakeCtx();
    expect(drawBursts(during.ctx, 400, 800, [BURST], 1.4)).toBe(true);
    expect(during.points.length).toBeGreaterThan(5);
  });

  it('положение частиц — функция времени: одинаковое время даёт одинаковый кадр', () => {
    const a = fakeCtx();
    const b = fakeCtx();
    drawBursts(a.ctx, 400, 800, [BURST], 1.3);
    drawBursts(b.ctx, 400, 800, [BURST], 1.3);
    expect(a.points).toEqual(b.points);
  });

  it('зацикленная пыль жива всегда', () => {
    const dust: Burst = { ...BURST, at: 0, loop: true, life: 3 };
    for (const time of [0.1, 5, 37.2]) expect(drawBursts(fakeCtx().ctx, 400, 800, [dust], time)).toBe(true);
  });
});

describe('Часы сцен', () => {
  it('скорость, пауза, покадровый шаг, перемотка и пропуск', () => {
    const tl = gsap.timeline({ paused: true });
    const target = { x: 0 };
    tl.to(target, { x: 100, duration: 2, ease: 'none' });
    const skip = vi.fn();
    const off = sceneClock.register({ timeline: tl, skip });
    sceneClock.setSpeed(0.25);
    expect(tl.timeScale()).toBe(0.25);
    sceneClock.seek(0.5);
    expect(target.x).toBeCloseTo(50);
    expect(sceneClock.paused).toBe(true);
    sceneClock.step(1 / 60);
    expect(tl.time()).toBeCloseTo(1 + 1 / 60);
    sceneClock.seekTime(2);
    expect(target.x).toBeCloseTo(100);
    sceneClock.skip();
    expect(skip).toHaveBeenCalled();
    off();
    expect(sceneClock.current).toBeNull();
    sceneClock.reset();
  });
});

describe('Сцена «Колода»', () => {
  const props = (role: 'mafia' | 'civilian') => {
    const state = newGame(role === 'mafia' ? ['mafia', 'don', 'commissioner', 'civilian', 'doctor'] : ['civilian', 'don', 'commissioner', 'mafia', 'doctor']);
    const view = snapshot(state, 'm1', 'night').view;
    return {
      presentation: { id: 1, kind: 'roleReveal' as const },
      view,
      name: (id: string) => ({ m1: 'Аня', m2: 'Борис', m3: 'Вера', m4: 'Гоша', m5: 'Даша' })[id] ?? id,
      display: 'stealth' as const,
      prefs: getPrefs(),
      quality: 'full' as const,
      live: false,
    };
  };

  it('тапы: к колоде → взять карту → к концу; мафия видит напарника; «Спрятать» завершает сцену', async () => {
    const onComplete = vi.fn();
    render(<DeckScene {...props('mafia')} onComplete={onComplete} />);
    const tl = sceneClock.current!.timeline;
    act(() => sceneClock.skip());
    expect(tl.time()).toBeCloseTo(1.0, 1);
    act(() => sceneClock.skip());
    expect(tl.paused()).toBe(false);
    act(() => sceneClock.skip());
    expect(tl.progress()).toBe(1);
    expect(screen.getByTestId('revealed-role')).toHaveAttribute('aria-label', 'Мафия');
    expect(screen.getAllByTestId('teammate')).toHaveLength(1);
    expect(screen.getByText('Борис')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('role-ok'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('у мирного напарников нет', () => {
    render(<DeckScene {...props('civilian')} onComplete={() => {}} />);
    expect(screen.queryAllByTestId('teammate')).toHaveLength(0);
    expect(screen.getByTestId('revealed-role')).toHaveAttribute('aria-label', 'Мирный житель');
  });
});

describe('Блокнот вместо кнопки чата мафии', () => {
  const state = newGame(['mafia', 'don', 'commissioner', 'civilian', 'doctor']);

  it('кнопка одинакова у мафии и у мирного', () => {
    for (const id of ['m1', 'm4']) {
      const store = storeWith({ memberId: id, room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, id, 'night') });
      const { unmount } = renderWith(store, <GameScreen />);
      expect(screen.getByRole('button', { name: 'Блокнот' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Чат мафии' })).toBeNull();
      unmount();
    }
  });

  it('у мирного — личные заметки', async () => {
    const store = storeWith({ memberId: 'm4', room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, 'm4', 'night') });
    renderWith(store, <Notebook />);
    await userEvent.type(screen.getByLabelText('Написать…'), 'Аня подозрительна');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(screen.getByText('Аня подозрительна')).toBeInTheDocument();
    expect(store.getState().notes).toHaveLength(1);
  });

  it('у мафии — чат и голоса команды; на основной панели подписей голосов нет', async () => {
    const { submitNightAction } = await import('@mafia/engine');
    const voted = submitNightAction(state, 'm2', { kind: 'mafiaVote', target: 'm4' }).state;
    const store = storeWith({ memberId: 'm1', room: room(5, 'm1', { stage: 'game' }), game: snapshot(voted, 'm1', 'night') });
    const chat = vi.spyOn(store, 'chat').mockResolvedValue({ ok: true });
    const { unmount } = renderWith(store, <Notebook />);
    expect(screen.getByTestId('team-votes')).toHaveTextContent('Борис → Гоша');
    await userEvent.type(screen.getByLabelText('Написать…'), 'берём Гошу');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(chat).toHaveBeenCalledWith('берём Гошу');
    unmount();

    renderWith(store, <NightPanel />);
    expect(screen.queryByText(/← Борис/)).toBeNull();
  });
});
