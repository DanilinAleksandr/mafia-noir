/**
 * Утро: план сцены и приватность режимов показа.
 */
import { ROLE_IDS, type RoleId } from '@mafia/engine';
import type { DisplayMode, Scene } from '@mafia/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import type { Beat, Report } from '../../presenter/digest';
import { getPrefs } from '../../settings/prefs';
import { newGame, snapshot } from '../../test/fixtures';
import { sceneClock } from '../clock';
import MorningScene from './MorningScene';
import { DEATH_STYLES, deathStyle, morningPlan } from './plan';
import { schedule } from './schedule';

const ABILITIES: Scene['ability'][] = ['heal', 'potionHeal', 'guard', 'bless', 'block', 'link', 'cover', 'silence'];

/** Сцены так, как их присылает сервер в каждом режиме: в «Скрытном» — без роли. */
function serverScenes(display: DisplayMode, role: RoleId): Beat[] {
  return ABILITIES.map((ability, i) => ({
    kind: 'scene' as const,
    scene: { id: 100 + i, round: 1, ability, role: display === 'stealth' ? null : role, saved: i % 2 === 0 },
  }));
}

describe('План утра', () => {
  it('вид смерти зависит только от игрока и круга — не от убийцы и не от причины', () => {
    const report = (cause: 'mafiaKill' | 'maniacKill' | 'witchPoison'): Report => ({
      public: [{ kind: 'death', player: 'm3', cause, role: 'civilian', by: cause === 'mafiaKill' ? ['m1'] : [] }],
      private: [],
    });
    const styles = (['mafiaKill', 'maniacKill', 'witchPoison'] as const).map(
      (cause) => morningPlan(report(cause), 4, 'm2', 'stealth').public[0],
    );
    expect(new Set(styles.map((s) => (s && s.kind === 'death' ? s.style : null))).size).toBe(1);
    // и все виды действительно встречаются
    const seen = new Set<string>();
    for (let r = 1; r < 300; r++) seen.add(deathStyle('m1', r));
    expect([...seen].sort()).toEqual([...DEATH_STYLES].sort());
  });

  it('гибель самого игрока — первым личным эпизодом; убийца в плане не фигурирует', () => {
    const plan = morningPlan(
      { public: [{ kind: 'death', player: 'm2', cause: 'mafiaKill', role: 'doctor', by: ['m1'] }], private: [{ kind: 'mafiaTarget', target: 'm2', decidedBy: 'votes' }] },
      1,
      'm2',
      'cinema',
    );
    expect(plan.personal[0]).toMatchObject({ kind: 'death' });
    expect(JSON.stringify(plan)).not.toContain('"m1"');
  });

  it('режимы: «Скрытный» — без действующих лиц, «Открытый» — силуэт, «Кино» — карточка', () => {
    const report = (display: DisplayMode): Report => ({ public: [{ kind: 'quietNight' }], private: serverScenes(display, 'doctor').slice(0, 1) });
    expect(morningPlan(report('stealth'), 1, 'm2', 'stealth').personal[0]).toMatchObject({ kind: 'heal', actor: { kind: 'none' } });
    expect(morningPlan(report('open'), 1, 'm2', 'open').personal[0]).toMatchObject({ kind: 'heal', actor: { kind: 'silhouette', role: 'doctor' } });
    expect(morningPlan(report('cinema'), 1, 'm2', 'cinema').personal[0]).toMatchObject({ kind: 'heal', actor: { kind: 'card', role: 'doctor' } });
  });

  it('Бомж падает вместе с хозяином, только если хозяин однозначен; ночлег не попадает в личную часть', () => {
    const hobo: Beat = { kind: 'death', player: 'm5', cause: 'hoboWithHost', role: 'hobo', by: [] };
    const host: Beat = { kind: 'death', player: 'm4', cause: 'mafiaKill', role: 'doctor', by: [] };
    const other: Beat = { kind: 'death', player: 'm6', cause: 'maniacKill', role: 'civilian', by: [] };
    const paired = morningPlan({ public: [host, hobo], private: [] }, 1, 'm2', 'stealth');
    expect(paired.public).toEqual([expect.objectContaining({ kind: 'death', player: 'm4', with: { player: 'm5', role: 'hobo' } })]);
    const unclear = morningPlan({ public: [host, other, hobo], private: [] }, 1, 'm2', 'stealth');
    expect(unclear.public.filter((p) => p.kind === 'death')).toHaveLength(3);
    const stay = morningPlan(
      { public: [{ kind: 'quietNight' }], private: [{ kind: 'scene', scene: { id: 1, round: 1, ability: 'stay', role: 'hobo', saved: false } }] },
      1,
      'm2',
      'cinema',
    );
    expect(stay.personal).toEqual([]);
  });

  it('личная часть укладывается в 7 с, общая — в 8 с', () => {
    const many: Report = {
      public: [1, 3, 4, 5].map((n) => ({ kind: 'death' as const, player: `m${n}`, cause: 'mafiaKill' as const, role: 'civilian' as const, by: [] })),
      private: [...serverScenes('cinema', 'doctor'), { kind: 'checked', target: 'm3', isMafia: true }],
    };
    const plan = morningPlan(many, 1, 'm2', 'cinema');
    const s = schedule(plan, false);
    expect(s.publicAt - s.wake.duration).toBeLessThanOrEqual(7.5);
    expect(s.summaryAt - s.publicAt).toBeLessThanOrEqual(8);
  });
});

describe('«Скрытный» режим: личная часть не знает чужих ролей', () => {
  it('ни для одной роли подействовавшего план и разметка личной части не содержат её идентификатора', () => {
    const state = newGame(['civilian', 'mafia', 'doctor', 'commissioner', 'civilian']);
    const view = snapshot(state, 'm1', 'morning').view;
    for (const actorRole of ROLE_IDS) {
      const report: Report = {
        public: [{ kind: 'quietNight' }],
        private: [...serverScenes('stealth', actorRole), { kind: 'blockedMe' }],
      };
      const plan = morningPlan(report, 1, 'm1', 'stealth');
      const json = JSON.stringify(plan.personal);
      for (const role of ROLE_IDS) expect(json).not.toContain(`"${role}"`);

      const { container, unmount } = render(
        <MorningScene
          presentation={{ id: 1, kind: 'nightReport', round: 1, step: 2, report }}
          view={view}
          name={(id) => id}
          display="stealth"
          prefs={getPrefs()}
          quality="full"
          live
          onComplete={() => {}}
        />,
      );
      sceneClock.seek(0.3);
      const personal = container.querySelector('.mo-personal') as HTMLElement;
      expect(personal.querySelectorAll('[data-role]')).toHaveLength(0);
      for (const role of ROLE_IDS) {
        if (role === 'civilian') continue; // своя роль зрителя (её он знает и так)
        expect(personal.textContent).not.toContain(t.roles[role].name);
      }
      unmount();
    }
  });

  it('в «Кино» та же сцена показывает карточку подействовавшей роли', () => {
    const state = newGame(['civilian', 'mafia', 'doctor', 'commissioner', 'civilian']);
    const report: Report = { public: [{ kind: 'quietNight' }], private: serverScenes('cinema', 'doctor').slice(0, 1) };
    render(
      <MorningScene
        presentation={{ id: 1, kind: 'nightReport', round: 1, step: 2, report }}
        view={snapshot(state, 'm1', 'morning').view}
        name={(id) => id}
        display="cinema"
        prefs={getPrefs()}
        quality="full"
        live
        onComplete={() => {}}
      />,
    );
    expect(document.querySelector('.mo-personal [data-role="doctor"]')).not.toBeNull();
    expect(screen.getByTestId('morning-episodes')).toHaveAttribute('data-count', '1');
  });
});
