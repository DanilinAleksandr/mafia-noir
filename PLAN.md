# PLAN.md — «Мафия Online»

Живой план проекта. Обновляется в конце каждого этапа. Подробности по движку — в `packages/engine/README.md`.

## Этапы

| № | Этап | Статус |
|---|------|--------|
| 1 | `packages/engine`: игровой движок + тесты | **готов** |
| 2 | `packages/server`: Cloudflare Worker + Durable Objects, комнаты, пароли, переподключение | запланирован |
| 3 | `packages/web`: клиент (лобби, настройка состава, игровой экран), PWA | запланирован |
| 4 | Кинематографичный слой: сцены ночи и утра, круглый стол, анимации карточек | запланирован |
| 5 | Иллюстрации ролей, звук, полировка | запланирован |

## Этап 1: движок (готов)

Итог: 25 ролей, ночь и день, отложенные решения (Охотник, Подрывник, Судья), условия победы, генератор состава по квотам, `viewFor` без утечек, события с двухуровневой видимостью. 210 тестов в 10 файлах, `npm test` зелёный, `npm run typecheck` чистый. Принятые решения по спорным правилам и открытые вопросы — в `CLAUDE.md`.

### Структура папок

```
package.json            npm workspaces (packages/*), общие devDependencies
tsconfig.base.json
packages/
  engine/
    src/
      types.ts          все публичные типы (состояние, конфиг, события, представление)
      rng.ts            детерминированный ГСЧ (mulberry32 + хеш seed)
      roles.ts          каталог ролей — данные (команда, категория, способности, пассивки)
      config.ts         правила по умолчанию, нормализация конфига
      composition.ts    generateComposition, validateComposition
      state.ts          внутреннее: клонирование, контекст шага, emit, ошибки
      flow.ts           смерти и цепочки, отложенные решения, смена фаз, конец игры
      night.ts          nightOptions, submitNightAction, allNightActionsIn, resolveNight
      day.ts            castVote, allVotesIn, resolveVote
      win.ts            checkWin
      view.ts           viewFor, projectEvent
      game.ts           createGame
      index.ts          публичный API
    test/               vitest
  server/               каркас (README)
  web/                  каркас (README)
```

### Основные типы

- `GameState` — обычный JSON (без классов, Map, Infinity): `config`, `rng`, `phase` (`night | day | ended`), `round`, `players[]`, `night`, `day`, `pending[]` (отложенные решения), `lovers`, `log` (все события), `result`.
- `PlayerState` — `id`, `name`, `seat`, `role`, `team`, `alive`, `death`, счётчики способностей.
- `GameConfig` = `rules` (правила) + `composition` (роли, лимиты копий, квоты).
- `GameEvent` — см. ниже.
- `PlayerView` — то, что уходит клиенту.

### API движка

Все функции чистые: входное состояние не меняется, возвращается новое.

```
createGame(config, players, seed)            → { state, events }
generateComposition(playerCount, config, seed) → { ok: true, roles, counts, warnings } | { ok: false, errors }
validateComposition(roles, rules)            → { errors, warnings }

nightOptions(state, playerId)                → доступные способности и цели
submitNightAction(state, playerId, action)   → { state, events }
allNightActionsIn(state)                     → boolean
resolveNight(state)                          → { state, events }

castVote(state, voterId, targetId | null)    → { state, events }
allVotesIn(state)                            → boolean
resolveVote(state)                           → { state, events }

currentDecision(state)                       → отложенное решение (Охотник, Подрывник, Судья)
submitDecision(state, playerId, decision)    → { state, events }
resolvePendingDefault(state)                 → { state, events }   (таймаут)

checkWin(state)                              → GameResult | null
viewFor(state, playerId | null)              → PlayerView
```

Ошибки ввода — исключение `EngineError` с полем `code`.

### Формат событий

```ts
interface GameEvent {
  id: number;            // порядковый номер в игре
  round: number;
  phase: 'setup' | 'night' | 'day' | 'ended';
  type: EventType;       // death, saved, blocked, checked, ...
  actors: PlayerId[];    // кто сделал
  targets: PlayerId[];   // с кем сделали
  data: {...};           // зависит от типа
  visibility: { all, teams, players };   // кто видит событие целиком
  stealth: null | {      // «скрытный» вид для тех, кто не видит целиком
    visibility: { all, teams, players };
    actors: boolean;     // показывать ли actors
    targets: boolean;    // показывать ли targets
    data: string[];      // какие ключи data показывать
  };
}
```

Клиент получает `ViewEvent`: то же событие после проекции, с флагом `redacted`.

## Дальше (этап 2, набросок)

- Durable Object комнаты: лобби → игра → итог; хранение `GameState` в storage.
- Протокол WebSocket: `hello(token)`, `view`, `events`, `intent(nightAction | vote | decision)`.
- Таймеры фаз (alarms): по таймауту `resolveNight` / `resolveVote` / `resolvePendingDefault`; досрочно — по `allNightActionsIn` / `allVotesIn`.
- Рассылка после каждого шага: `viewFor(state, id)` и `projectEvents(state, step.events, id)` каждому игроку.
- Не выдавать роли паузами: «подтверждение» ночью от всех игроков, постоянная пауза после голосования (Судья).
- Пароль комнаты: PBKDF2 (WebCrypto) + соль; токен переподключения.
- Лимит кругов или таймауты против «вечной» партии.
- Перед началом этапа сверить актуальную документацию Cloudflare (Durable Objects, WebSocket Hibernation, лимиты бесплатного плана).
