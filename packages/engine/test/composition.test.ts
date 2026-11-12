import { describe, expect, it } from 'vitest';
import {
  type Category,
  type GameConfigInput,
  type RoleId,
  type RoleSetting,
  DEFAULT_RULES,
  EngineError,
  ROLES,
  ROLE_IDS,
  categoryOf,
  createGame,
  defaultBlackCount,
  generateComposition,
  validateComposition,
} from '../src/index';

const SEEDS = Array.from({ length: 40 }, (_, i) => `seed-${i}`);

function count(roles: RoleId[], cats: Category[]): number {
  return roles.filter((r) => cats.includes(categoryOf(r, DEFAULT_RULES))).length;
}

/** Выключить все роли, кроме перечисленных. */
function only(...enabled: RoleId[]): Partial<Record<RoleId, RoleSetting>> {
  const roles: Partial<Record<RoleId, RoleSetting>> = {};
  for (const id of ROLE_IDS) roles[id] = { enabled: enabled.includes(id) };
  return roles;
}

function expectOk(result: ReturnType<typeof generateComposition>) {
  if (!result.ok) throw new Error(`Ожидался состав, получены ошибки: ${result.errors.map((e) => e.message).join('; ')}`);
  return result;
}

function expectErrors(result: ReturnType<typeof generateComposition>) {
  if (result.ok) throw new Error(`Ожидалась ошибка, получен состав: ${result.roles.join(', ')}`);
  return result.errors;
}

describe('generateComposition: квоты', () => {
  it('пример из задания: 6 игроков — 1 чёрный, 1 нейтральный, 4 красных, из них минимум 1 информационный и 1 защитный', () => {
    const config: GameConfigInput = {
      composition: {
        quotas: {
          black: { exact: 1 },
          neutral: { exact: 1 },
          red: { exact: 4 },
          redInfo: { min: 1 },
          redDefense: { min: 1 },
        },
      },
    };
    for (const seed of SEEDS) {
      const { roles, counts } = expectOk(generateComposition(6, config, seed));
      expect(roles).toHaveLength(6);
      expect(count(roles, ['black'])).toBe(1);
      expect(count(roles, ['neutral'])).toBe(1);
      expect(count(roles, ['redInfo', 'redDefense', 'redActive', 'redPlain'])).toBe(4);
      expect(count(roles, ['redInfo'])).toBeGreaterThanOrEqual(1);
      expect(count(roles, ['redDefense'])).toBeGreaterThanOrEqual(1);
      expect(counts.black).toBe(1);
      expect(counts.neutral).toBe(1);
    }
  });

  it('минимум, максимум и «ровно» соблюдаются одновременно', () => {
    const config: GameConfigInput = {
      composition: {
        quotas: {
          black: { min: 2, max: 3 },
          neutral: { max: 1 },
          redInfo: { exact: 2 },
          redDefense: { min: 1, max: 2 },
          redActive: { max: 1 },
          redPlain: { min: 2 },
        },
      },
    };
    for (const seed of SEEDS) {
      const { roles } = expectOk(generateComposition(12, config, seed));
      expect(roles).toHaveLength(12);
      expect(count(roles, ['black'])).toBeGreaterThanOrEqual(2);
      expect(count(roles, ['black'])).toBeLessThanOrEqual(3);
      expect(count(roles, ['neutral'])).toBeLessThanOrEqual(1);
      expect(count(roles, ['redInfo'])).toBe(2);
      expect(count(roles, ['redDefense'])).toBeGreaterThanOrEqual(1);
      expect(count(roles, ['redDefense'])).toBeLessThanOrEqual(2);
      expect(count(roles, ['redActive'])).toBeLessThanOrEqual(1);
      expect(count(roles, ['redPlain'])).toBeGreaterThanOrEqual(2);
    }
  });

  it('без квот: чёрных по умолчанию, они в меньшинстве, лимиты копий соблюдены', () => {
    for (let n = 4; n <= 20; n++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const { roles } = expectOk(generateComposition(n, {}, seed));
        expect(roles).toHaveLength(n);
        const black = count(roles, ['black']);
        expect(black).toBe(defaultBlackCount(n));
        expect(black).toBeLessThan(n - black);
        expect(count(roles, ['neutral'])).toBeLessThanOrEqual(Math.floor(n / 5));
        for (const id of ROLE_IDS) {
          const max = ROLES[id].maxCopies;
          if (max !== null) expect(roles.filter((r) => r === id).length, id).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('рекомендованное число чёрных', () => {
    expect([4, 5, 6, 7, 9, 10, 12, 13, 16].map(defaultBlackCount)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 5]);
  });
});

describe('generateComposition: включение ролей и лимиты', () => {
  it('выключенные роли в состав не попадают', () => {
    const config: GameConfigInput = {
      composition: { roles: { maniac: { enabled: false }, witch: { enabled: false }, don: { max: 0 } } },
    };
    for (const seed of SEEDS) {
      const { roles } = expectOk(generateComposition(14, config, seed));
      expect(roles).not.toContain('maniac');
      expect(roles).not.toContain('witch');
      expect(roles).not.toContain('don');
    }
  });

  it('сначала добираются особые роли, а когда они кончаются — Мирные жители', () => {
    const config: GameConfigInput = {
      composition: { roles: only('mafia', 'commissioner', 'doctor', 'civilian') },
    };
    const { roles } = expectOk(generateComposition(8, config, 'x'));
    expect(roles).toEqual(['commissioner', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian', 'mafia', 'mafia']);
  });

  it('лимит копий можно поднять', () => {
    const config: GameConfigInput = {
      composition: {
        roles: { ...only('mafia', 'doctor', 'civilian'), doctor: { enabled: true, max: 2 } },
      },
    };
    const { roles } = expectOk(generateComposition(7, config, 'x'));
    expect(roles.filter((r) => r === 'doctor')).toHaveLength(2);
    expect(roles.filter((r) => r === 'civilian')).toHaveLength(3);
  });

  it('лимит можно задать и безлимитным ролям', () => {
    const config: GameConfigInput = {
      composition: {
        roles: { ...only('mafia', 'don', 'civilian'), mafia: { enabled: true, max: 1 } },
        quotas: { black: { exact: 2 } },
      },
    };
    const { roles } = expectOk(generateComposition(7, config, 'x'));
    expect(roles.filter((r) => r === 'mafia')).toHaveLength(1);
    expect(roles.filter((r) => r === 'don')).toHaveLength(1);
  });

  it('Адвокат не берётся, если Комиссар выключен', () => {
    const config: GameConfigInput = { composition: { roles: { commissioner: { enabled: false } } } };
    for (const seed of SEEDS) {
      const result = expectOk(generateComposition(13, config, seed));
      expect(result.roles).not.toContain('lawyer');
      expect(result.warnings.some((w) => w.code === 'ROLE_SKIPPED' && w.role === 'lawyer')).toBe(true);
    }
  });

  it('Любовница в красном режиме считается красной активной, в нейтральном — нейтральной', () => {
    const composition = {
      roles: only('mafia', 'mistress', 'civilian'),
      quotas: { redActive: { exact: 1 }, neutral: { exact: 0 } },
    };
    const red = expectOk(generateComposition(6, { composition, rules: { mistressMode: 'red' } }, 'x'));
    expect(red.roles).toContain('mistress');
    expect(red.counts.redActive).toBe(1);

    const errors = expectErrors(generateComposition(6, { composition }, 'x'));
    expect(errors[0]?.code).toBe('QUOTA_UNSATISFIABLE');
    expect(errors[0]?.key).toBe('redActive');
  });
});

describe('generateComposition: невыполнимые квоты', () => {
  it('минимум категории больше, чем в ней есть ролей', () => {
    const errors = expectErrors(
      generateComposition(8, {
        composition: {
          roles: { detective: { enabled: false }, patrol: { enabled: false }, journalist: { enabled: false }, hobo: { enabled: false } },
          quotas: { redInfo: { min: 2 } },
        },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'QUOTA_UNSATISFIABLE', key: 'redInfo' });
    expect(errors[0]?.message).toBe(
      'Красные информационные: по квоте нужно минимум 2, а включённые роли и их лимиты копий дают максимум 1',
    );
  });

  it('в категории не включено ни одной роли', () => {
    const errors = expectErrors(
      generateComposition(8, {
        composition: { roles: only('mafia', 'civilian', 'doctor'), quotas: { neutral: { min: 1 } } },
      }),
    );
    expect(errors[0]).toMatchObject({ code: 'QUOTA_UNSATISFIABLE', key: 'neutral' });
    expect(errors[0]?.message).toContain('не включено ни одной роли');
  });

  it('минимумы в сумме требуют больше игроков, чем есть', () => {
    const errors = expectErrors(
      generateComposition(6, {
        composition: { quotas: { black: { exact: 2 }, neutral: { exact: 2 }, red: { min: 5 } } },
      }),
    );
    expect(errors[0]?.code).toBe('TOO_MANY_REQUIRED');
    expect(errors[0]?.message).toBe(
      'Квоты требуют минимум 9 игроков (чёрные 2 + нейтральные 2 + красные 5), а игроков 6',
    );
  });

  it('ролей не хватает на всех игроков', () => {
    const errors = expectErrors(
      generateComposition(8, { composition: { roles: only('mafia', 'commissioner', 'doctor', 'hunter') } }),
    );
    expect(errors[0]?.code).toBe('NOT_ENOUGH_ROLES');
    expect(errors[0]?.message).toContain('максимум 5 ролей');
    expect(errors[0]?.message).toContain('Включите Мирного жителя');
  });

  it('максимумы квот не дают заполнить все места', () => {
    const errors = expectErrors(
      generateComposition(10, { composition: { quotas: { red: { max: 4 }, neutral: { max: 1 }, black: { exact: 2 } } } }),
    );
    expect(errors[0]?.code).toBe('NOT_ENOUGH_ROLES');
  });

  it('минимум больше максимума', () => {
    const errors = expectErrors(generateComposition(8, { composition: { quotas: { redDefense: { min: 3, max: 1 } } } }));
    expect(errors[0]).toMatchObject({ code: 'QUOTA_INVALID', key: 'redDefense' });
  });

  it('минимумы красных категорий больше максимума красных', () => {
    const errors = expectErrors(
      generateComposition(10, {
        composition: { quotas: { red: { max: 3 }, redInfo: { min: 2 }, redDefense: { min: 2 } } },
      }),
    );
    expect(errors[0]).toMatchObject({ code: 'RED_QUOTA_CONFLICT', key: 'red' });
    expect(errors[0]?.message).toContain('в сумме дают 4');
  });

  it('сообщает сразу обо всех несходящихся категориях', () => {
    const errors = expectErrors(
      generateComposition(10, {
        composition: {
          roles: only('mafia', 'civilian', 'commissioner', 'doctor'),
          quotas: { redInfo: { min: 2 }, redDefense: { min: 2 } },
        },
      }),
    );
    expect(errors.map((e) => e.key)).toEqual(['redInfo', 'redDefense']);
  });
});

describe('generateComposition: баланс', () => {
  it('чёрных должно быть меньше остальных', () => {
    const errors = expectErrors(generateComposition(6, { composition: { quotas: { black: { exact: 3 } } } }));
    expect(errors[0]).toMatchObject({ code: 'BLACK_NOT_MINORITY', key: 'black' });
  });

  it('максимум чёрных автоматически ограничен балансом', () => {
    for (const seed of SEEDS) {
      const { roles } = expectOk(generateComposition(7, { composition: { quotas: { black: { min: 1, max: 6 } } } }, seed));
      expect(count(roles, ['black'])).toBeLessThanOrEqual(3);
    }
  });

  it('нужен хотя бы один чёрный', () => {
    const noRoles = expectErrors(generateComposition(6, { composition: { roles: only('civilian', 'doctor') } }));
    expect(noRoles[0]?.code).toBe('NO_BLACK');
    const zeroQuota = expectErrors(generateComposition(6, { composition: { quotas: { black: { exact: 0 } } } }));
    expect(zeroQuota[0]?.code).toBe('NO_BLACK');
  });

  it('нужно минимум четыре игрока', () => {
    expect(expectErrors(generateComposition(3))[0]?.code).toBe('TOO_FEW_PLAYERS');
  });

  it('validateComposition предупреждает о бесполезных ролях и отсутствии информационных', () => {
    const { errors, warnings } = validateComposition(
      ['mafia', 'lawyer', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian'],
      DEFAULT_RULES,
    );
    expect(errors).toEqual([]);
    expect(warnings.map((w) => w.code).sort()).toEqual(['NO_INFO_ROLES', 'ROLE_USELESS']);
  });
});

describe('generateComposition: ручной состав', () => {
  it('принимает корректный список', () => {
    const preset: RoleId[] = ['civilian', 'mafia', 'doctor', 'commissioner', 'civilian'];
    const result = expectOk(generateComposition(5, { composition: { preset } }));
    expect(result.roles).toEqual(['commissioner', 'doctor', 'civilian', 'civilian', 'mafia']);
  });

  it('отклоняет список неверной длины и несбалансированный', () => {
    expect(expectErrors(generateComposition(6, { composition: { preset: ['mafia', 'civilian'] } }))[0]?.code).toBe(
      'PRESET_INVALID',
    );
    const noBlack = expectErrors(
      generateComposition(4, { composition: { preset: ['civilian', 'civilian', 'doctor', 'civilian'] } }),
    );
    expect(noBlack[0]?.code).toBe('NO_BLACK');
    const tooBlack = expectErrors(
      generateComposition(4, { composition: { preset: ['mafia', 'mafia', 'doctor', 'civilian'] } }),
    );
    expect(tooBlack[0]?.code).toBe('BLACK_NOT_MINORITY');
  });
});

describe('generateComposition: детерминированность', () => {
  it('один seed — один состав, разные seed — разные составы', () => {
    const a = expectOk(generateComposition(12, {}, 'same'));
    const b = expectOk(generateComposition(12, {}, 'same'));
    expect(a.roles).toEqual(b.roles);
    const variants = new Set(SEEDS.map((seed) => expectOk(generateComposition(12, {}, seed)).roles.join(',')));
    expect(variants.size).toBeGreaterThan(10);
  });
});

describe('createGame и состав', () => {
  const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}` }));

  it('раздаёт сгенерированный состав игрокам', () => {
    const config: GameConfigInput = { composition: { quotas: { black: { exact: 2 }, neutral: { exact: 1 } } } };
    const { state } = createGame(config, players(9), 'deal');
    expect(state.players).toHaveLength(9);
    expect(state.players.filter((p) => p.team === 'black')).toHaveLength(2);
    expect(state.players.filter((p) => p.team === 'neutral')).toHaveLength(1);
    expect(state.players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('раздаёт ручной состав, перемешивая его', () => {
    const preset: RoleId[] = ['mafia', 'commissioner', 'doctor', 'civilian', 'civilian', 'civilian'];
    const deals = new Set<string>();
    for (const seed of SEEDS) {
      const { state } = createGame({ composition: { preset } }, players(6), seed);
      expect(state.players.map((p) => p.role).sort()).toEqual([...preset].sort());
      deals.add(state.players.map((p) => p.role).join(','));
    }
    expect(deals.size).toBeGreaterThan(5);
  });

  it('бросает понятную ошибку, если состав собрать нельзя', () => {
    const config: GameConfigInput = { composition: { quotas: { black: { exact: 4 } } } };
    expect(() => createGame(config, players(6), 'x')).toThrow(EngineError);
    expect(() => createGame(config, players(6), 'x')).toThrow(/Не удалось собрать состав: Чёрные/);
  });

  it('проверяет список игроков', () => {
    expect(() => createGame({}, [], 'x')).toThrow(EngineError);
    expect(() => createGame({}, [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], 'x')).toThrow(/Повторяющийся id/);
    expect(() =>
      createGame({}, [{ id: 'a', name: 'A', role: 'mafia' }, { id: 'b', name: 'B' }], 'x'),
    ).toThrow(/либо у всех игроков, либо ни у кого/);
  });
});
