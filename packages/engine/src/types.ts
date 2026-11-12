/**
 * Публичные типы движка.
 *
 * Важно: GameState — обычный JSON (без классов, Map, Set, undefined-в-массивах, Infinity),
 * чтобы его можно было хранить в Durable Object storage и передавать как есть.
 */

export type PlayerId = string;

// ───────────────────────────── Роли и команды ─────────────────────────────

export const ROLE_IDS = [
  // красные, информационные
  'commissioner',
  'detective',
  'patrol',
  'journalist',
  'hobo',
  // красные, защитные
  'doctor',
  'bodyguard',
  'priest',
  'hero',
  'witch',
  // красные, активные
  'hunter',
  'mayor',
  'judge',
  'cupid',
  // красные, обычные
  'civilian',
  // чёрные
  'mafia',
  'don',
  'lawyer',
  'blackmailer',
  'consigliere',
  // нейтральные
  'maniac',
  'mistress',
  'jester',
  'survivor',
  'bomber',
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/** Команда: красные (мирные), чёрные (мафия), нейтральные (каждый сам за себя). */
export type Team = 'red' | 'black' | 'neutral';

/** Категория роли для квот состава. */
export type Category = 'redInfo' | 'redDefense' | 'redActive' | 'redPlain' | 'black' | 'neutral';

/** Ключ квоты: категория или все красные вместе. */
export type QuotaKey = Category | 'red';

export type AbilityId =
  | 'check' // Комиссар
  | 'investigate' // Следователь
  | 'watch' // Патрульный
  | 'compare' // Журналист
  | 'stay' // Бомж
  | 'heal' // Доктор
  | 'guard' // Телохранитель
  | 'bless' // Священник
  | 'potionHeal' // Ведьма: зелье спасения
  | 'potionKill' // Ведьма: зелье убийства
  | 'link' // Купидон
  | 'cover' // Адвокат
  | 'silence' // Шантажист
  | 'scout' // Консильери
  | 'kill' // Маньяк
  | 'block'; // Любовница

/** Шаг разрешения ночи, на котором срабатывает способность. */
export type NightStep = 'link' | 'block' | 'protect' | 'attack' | 'effect' | 'info';

export type Passive =
  | 'donTiebreak' // решающий голос при равенстве голосов мафии
  | 'armor' // переживает первое нападение
  | 'lastShot' // при смерти забирает одного
  | 'doubleVote' // голос считается за два
  | 'veto' // один раз отменяет итог голосования
  | 'blast'; // при казни забирает одного из голосовавших против

/** Условие победы роли. */
export type WinCondition =
  | 'team' // вместе со своей командой (красные / чёрные)
  | 'maniac' // остался один или вдвоём, мафии нет
  | 'executed' // казнён днём
  | 'survive'; // жив на момент конца игры

export interface AbilityDef {
  id: AbilityId;
  step: NightStep;
  /** Сколько целей нужно выбрать. */
  targets: 1 | 2;
  /** Можно ли выбрать себя. */
  self: boolean;
  /** Сколько раз за игру (null — без ограничений). */
  uses: number | null;
  /** Только в первую ночь. */
  firstNightOnly: boolean;
  /** Нельзя выбирать ту же цель две ночи подряд. */
  noRepeat: boolean;
  /** Считается ли применение «визитом» к цели (видят Патрульный и Бомж). */
  visit: boolean;
  /** Ограничение на цели. */
  filter: 'any' | 'blackOnly' | 'notBlack';
}

export interface RoleDef {
  id: RoleId;
  /** Название по-русски. */
  name: string;
  /** Короткое описание для интерфейса. */
  summary: string;
  team: Team;
  category: Category;
  /** Максимум копий по умолчанию (null — без ограничения). */
  maxCopies: number | null;
  abilities: AbilityDef[];
  passives: Passive[];
  win: WinCondition;
  /** Роли, без которых эта бесполезна (генератор не возьмёт её, если они выключены). */
  needs: RoleId[];
}

// ───────────────────────────── Конфигурация ─────────────────────────────

export type MistressMode = 'red' | 'neutral';

/**
 * Режим голосования:
 * - secret: никто не видит чужих голосов, после подсчёта объявляются только суммы;
 * - revealAfter: голосуют вслепую, после подсчёта видно, кто за кого голосовал;
 * - open: голоса видны сразу, по мере подачи.
 */
export type VotingMode = 'secret' | 'revealAfter' | 'open';

export interface Rules {
  /** Показывать ли роль умершего всем. */
  revealRoleOnDeath: boolean;
  /** Показывать ли всем причину смерти (выстрел мафии, нож маньяка, яд, ...). */
  revealDeathCause: boolean;
  /** Комиссар видит Дона как мафию. */
  commissionerSeesDonAsMafia: boolean;
  /** Комиссар видит Маньяка как мафию. */
  commissionerSeesManiacAsMafia: boolean;
  /** Любовница играет за красных или сама за себя. */
  mistressMode: MistressMode;
  /** Мёртвые видят все роли и полный журнал. */
  deadSeeAllRoles: boolean;
  votingMode: VotingMode;
  /** Казнь Шута сразу заканчивает игру его победой (иначе игра продолжается). */
  jesterWinEndsGame: boolean;
  /** Утром анонимно объявляется, что ночью кого-то спасли. */
  announceSaves: boolean;
  /** Доктор может лечить себя. */
  doctorSelfHeal: boolean;
}

export interface Quota {
  min?: number;
  max?: number;
  /** Ровно столько (эквивалент min = max). */
  exact?: number;
}

export interface RoleSetting {
  /** Включена ли роль (по умолчанию да). */
  enabled?: boolean;
  /** Максимум копий (null — без ограничения). По умолчанию берётся из каталога. */
  max?: number | null;
}

export interface CompositionConfig {
  roles: Partial<Record<RoleId, RoleSetting>>;
  quotas: Partial<Record<QuotaKey, Quota>>;
  /** Точный список ролей, заданный хостом вручную (длина = число игроков). */
  preset: RoleId[] | null;
  /**
   * Какую долю красных мест оставлять Мирным жителям (0..1), чтобы при многих включённых ролях
   * состав не превращался в сплошные особые роли.
   * null — автоматически: 0.3 при 8 и более игроках, 0 при меньшем числе.
   * Это ориентир, а не жёсткая квота: минимумы квот важнее.
   */
  minCiviliansShare: number | null;
}

export interface GameConfig {
  rules: Rules;
  composition: CompositionConfig;
}

/** Конфиг, который передаёт вызывающий: всё необязательно, пропуски заполняются значениями по умолчанию. */
export interface GameConfigInput {
  rules?: Partial<Rules>;
  composition?: Partial<CompositionConfig>;
}

export interface PlayerInit {
  id: PlayerId;
  name: string;
  /**
   * Явная роль (ручная раздача и тесты). Либо у всех игроков, либо ни у кого.
   * При явной раздаче проверки баланса не выполняются.
   */
  role?: RoleId;
}

// ───────────────────────────── Состояние ─────────────────────────────

export type Phase = 'night' | 'day' | 'ended';

export type DeathCause =
  | 'mafiaKill'
  | 'maniacKill'
  | 'witchPoison'
  | 'hunterShot'
  | 'bomberBlast'
  | 'execution'
  | 'loverGrief'
  | 'hoboWithHost';

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Место за столом (0..n-1). */
  seat: number;
  role: RoleId;
  team: Team;
  alive: boolean;
  death: { round: number; phase: Phase; cause: DeathCause } | null;
  /** Роль объявлена всем (после смерти или личной победы). */
  revealed: boolean;
  /** Сколько раз применена каждая способность. */
  uses: Partial<Record<AbilityId, number>>;
  /** Последнее применение каждой способности (для правила «не два раза подряд»). */
  last: Partial<Record<AbilityId, { round: number; targets: PlayerId[] }>>;
  /** Цел ли щит Героя. */
  armor: boolean;
  /** Использовал ли Судья отмену. */
  vetoUsed: boolean;
}

export interface NightEntry {
  /** Выбранная способность; null — игрок явно отказался; нет ключа — ещё не ответил. */
  ability?: { id: AbilityId; targets: PlayerId[] } | null;
  /** Голос мафии за жертву; null — воздержался; нет ключа — ещё не ответил. */
  mafiaVote?: PlayerId | null;
}

export interface NightState {
  actions: Record<PlayerId, NightEntry>;
  /** Заблокированные этой ночью (заполняется при разрешении). */
  blocked: PlayerId[];
  /** Кому Шантажист запретил говорить завтра. */
  silenced: PlayerId[];
  /** Кого Священник защитил от казни завтра. */
  blessed: PlayerId[];
}

export interface DayState {
  stage: 'vote' | 'revote';
  /** При переголосовании — за кого можно голосовать. */
  candidates: PlayerId[] | null;
  /** Голоса: null — воздержался. */
  votes: Record<PlayerId, PlayerId | null>;
  silenced: PlayerId[];
  /** Защищённые от казни сегодня. */
  protected: PlayerId[];
  /** Приговорённый, пока Судья решает. */
  condemned: PlayerId | null;
}

/** Отложенное решение игрока, без которого игра не идёт дальше. */
export type PendingDecision =
  | { kind: 'hunterShot'; playerId: PlayerId }
  | { kind: 'bomberBlast'; playerId: PlayerId; voters: PlayerId[] }
  | { kind: 'judgeVeto'; playerId: PlayerId; condemned: PlayerId };

export type Decision =
  | { kind: 'hunterShot'; target: PlayerId | null }
  | { kind: 'bomberBlast'; target: PlayerId }
  | { kind: 'judgeVeto'; veto: boolean };

export type Outcome = 'red' | 'black' | 'maniac' | 'jester' | 'draw';

export type WinReason =
  | 'threatsEliminated' // мафия и маньяк мертвы
  | 'mafiaParity' // мафии не меньше остальных
  | 'maniacLastStanding' // маньяк один или вдвоём, мафии нет
  | 'jesterExecuted'
  | 'everyoneDead'
  | 'mafiaManiacStandoff'; // один мафиози против маньяка

export interface GameResult {
  outcome: Outcome;
  reason: WinReason;
  /** Все победители: команда + личные победы (Шут, Подрывник) + выжившие нейтралы. */
  winners: PlayerId[];
}

export interface GameState {
  version: 1;
  config: GameConfig;
  /** Состояние генератора случайных чисел. */
  rng: number;
  phase: Phase;
  /** Номер круга: ночь N, затем день N. Начинается с 1. */
  round: number;
  players: PlayerState[];
  night: NightState | null;
  day: DayState | null;
  /** Очередь отложенных решений; активно первое. */
  pending: PendingDecision[];
  /** Куда перейти, когда очередь решений опустеет. null — фаза идёт обычным ходом. */
  transition: 'toDay' | 'toNight' | null;
  /** Пары, связанные Купидоном. */
  lovers: [PlayerId, PlayerId][];
  /** Личные победы (казнённые Шут и Подрывник). */
  personalWinners: PlayerId[];
  /** Полный журнал событий с начала игры. */
  log: GameEvent[];
  result: GameResult | null;
}

// ───────────────────────────── Действия ─────────────────────────────

export type NightAction =
  /** Применить способность. */
  | { kind: 'ability'; ability: AbilityId; targets: PlayerId[] }
  /** Голос мафии за жертву (null — воздержаться). */
  | { kind: 'mafiaVote'; target: PlayerId | null }
  /** Отказаться от способности этой ночью. */
  | { kind: 'pass' };

export interface AbilityOption {
  id: AbilityId;
  targets: 1 | 2;
  /** Кого можно выбрать. */
  candidates: PlayerId[];
  /** Сколько применений осталось (null — без ограничений). */
  usesLeft: number | null;
}

export interface NightOptions {
  /** Доступные этой ночью способности (за ночь можно применить одну). */
  abilities: AbilityOption[];
  /** Голосование мафии, если игрок чёрный. */
  mafiaVote: { candidates: PlayerId[] } | null;
}

// ───────────────────────────── События ─────────────────────────────

/** Кому показывать. Условия объединяются по «или». */
export interface Visibility {
  all: boolean;
  teams: Team[];
  players: PlayerId[];
}

/**
 * «Скрытный» вид события: что можно показать тем, кто не видит событие целиком,
 * не раскрывая, кто какую роль играет.
 */
export interface StealthView {
  /** Кому показывать скрытный вид. */
  visibility: Visibility;
  /** Показывать ли, кто действовал. */
  actors: boolean;
  /** Показывать ли, на кого действовали. */
  targets: boolean;
  /** Какие ключи data можно показать. */
  data: string[];
}

export type EventPhase = 'setup' | Phase;

/** Чем спасли: лечение Доктора, зелье Ведьмы, Телохранитель, щит Героя. */
export type SaveKind = 'heal' | 'potion' | 'guard' | 'armor';

export type NoData = Record<string, never>;

export interface EventDataMap {
  // подготовка
  gameStarted: { playerCount: number };
  /** targets: [игрок]. Видит только он. */
  roleAssigned: { role: RoleId };
  /** targets: вся чёрная команда. Видят только чёрные. */
  teamRevealed: { roles: Record<PlayerId, RoleId> };
  // смена фаз
  nightStarted: NoData;
  dayStarted: NoData;
  // ночь
  /**
   * Способность применена (не заблокирована). actors: [кто], targets: [на кого].
   * Видит только применивший. Убийства мафии сюда не попадают: это не способность, а решение команды.
   */
  abilityUsed: { ability: AbilityId };
  /** actors: [Купидон], targets: [a, b]. Влюблённые видят скрытный вид (без Купидона). */
  loversLinked: NoData;
  /** actors: [Любовница], targets: [цель]. Цель видит скрытный вид. */
  blocked: NoData;
  /** actors: [Священник], targets: [цель]. */
  blessed: NoData;
  /** actors: [исполнитель], targets: [жертва]. Видят чёрные. */
  mafiaTargetChosen: {
    votes: Record<PlayerId, PlayerId | null>;
    decidedBy: 'votes' | 'don' | 'random';
  };
  /** actors: [спаситель], targets: [спасённый]. */
  saved: { by: SaveKind; attack: DeathCause };
  /** actors: [убийца] (если есть), targets: [погибший]. */
  death: { cause: DeathCause };
  /** targets: [игрок]. */
  roleRevealed: { role: RoleId };
  /** actors: [Адвокат], targets: [прикрытый]. */
  covered: NoData;
  /** actors: [Шантажист], targets: [цель]. Все видят скрытный вид. */
  silenced: NoData;
  /** actors: [Комиссар], targets: [проверенный]. */
  checked: { isMafia: boolean };
  /** actors: [Следователь или Консильери], targets: [цель]. */
  roleLearned: { role: RoleId };
  /** actors: [Патрульный или Бомж], targets: [за кем следил]. */
  visitorsSeen: { visitors: PlayerId[] };
  /** actors: [Журналист], targets: [a, b]. */
  teamsCompared: { sameTeam: boolean };
  // день
  /** targets: приговорённый или набравшие поровну. */
  voteResult: {
    stage: 'vote' | 'revote';
    /** Сумма голосов по кандидатам (с учётом двойного голоса Мэра). */
    tally: Record<PlayerId, number>;
    abstained: number;
    outcome: 'condemned' | 'tie' | 'noVotes';
  };
  /** Кто за кого голосовал. В режиме secret не виден никому до конца игры. */
  ballotsRevealed: { ballots: Record<PlayerId, PlayerId | null> };
  /** targets: кандидаты переголосования. */
  revoteStarted: NoData;
  noExecution: { reason: 'noVotes' | 'tie' };
  /** actors: [Священник], targets: [приговорённый]. Все видят скрытный вид. */
  executionPrevented: { reason: 'blessing' };
  /** actors: [Судья], targets: [приговорённый]. Все видят скрытный вид. */
  voteCancelled: NoData;
  /** targets: [игрок]. Личная победа Шута или Подрывника. */
  personalWin: { role: RoleId };
  // конец
  gameEnded: {
    outcome: Outcome;
    reason: WinReason;
    winners: PlayerId[];
    roles: Record<PlayerId, RoleId>;
  };
}

export type EventType = keyof EventDataMap;

export interface EventBase {
  /** Порядковый номер события в игре, с 1. */
  id: number;
  round: number;
  phase: EventPhase;
  /** Кто действовал. */
  actors: PlayerId[];
  /** На кого действовали. */
  targets: PlayerId[];
  /** Кто видит событие целиком. */
  visibility: Visibility;
  /** Скрытный вид для остальных; null — остальным не показывать вовсе. */
  stealth: StealthView | null;
}

export type GameEvent = {
  [K in EventType]: EventBase & { type: K; data: EventDataMap[K] };
}[EventType];

/** Событие после проекции для конкретного зрителя. */
export type ViewEvent = {
  [K in EventType]: {
    id: number;
    round: number;
    phase: EventPhase;
    type: K;
    actors: PlayerId[];
    targets: PlayerId[];
    data: Partial<EventDataMap[K]>;
    /** true — это скрытный вид: часть полей вырезана. */
    redacted: boolean;
  };
}[EventType];

/** Результат любого шага: новое состояние и события, случившиеся на этом шаге. */
export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

// ───────────────────────────── Представление игрока ─────────────────────────────

export interface ViewPlayer {
  id: PlayerId;
  name: string;
  seat: number;
  alive: boolean;
  /** Роль, если зритель вправе её знать; иначе null. */
  role: RoleId | null;
  team: Team | null;
  /** Причина смерти, если она объявлена всем. */
  deathCause: DeathCause | null;
  /** Молчит сегодня (Шантажист). */
  silenced: boolean;
  /** Связан с вами Купидоном. */
  lover: boolean;
}

export interface ViewDecision {
  kind: PendingDecision['kind'];
  /** Кого можно выбрать (для Судьи пусто). */
  options: PlayerId[];
  /** Для Судьи: кого собираются казнить. */
  condemned: PlayerId | null;
}

export interface PlayerView {
  /** Чьё это представление; null — общий экран / зритель. */
  viewer: PlayerId | null;
  phase: Phase;
  round: number;
  rules: Rules;
  you: {
    id: PlayerId;
    name: string;
    role: RoleId;
    team: Team;
    alive: boolean;
    uses: Partial<Record<AbilityId, number>>;
    armor: boolean;
    vetoUsed: boolean;
    lovers: PlayerId[];
    silenced: boolean;
  } | null;
  players: ViewPlayer[];
  night: {
    /** Что вы можете сделать этой ночью; null — ничего. */
    options: NightOptions | null;
    /** Что вы уже отправили. */
    submitted: NightEntry;
    /** Всё ли от вас получено. */
    ready: boolean;
    /** Голоса вашей чёрной команды (только для чёрных). */
    teamVotes: Record<PlayerId, PlayerId | null> | null;
  } | null;
  day: {
    stage: 'vote' | 'revote';
    candidates: PlayerId[] | null;
    /** Кто уже проголосовал (без содержания голоса). */
    voted: PlayerId[];
    /** Ваш голос: null — воздержались; undefined — ещё не голосовали. */
    myVote?: PlayerId | null;
    /** Все голоса — только в режиме open. */
    ballots: Record<PlayerId, PlayerId | null> | null;
    canVote: boolean;
  } | null;
  /** Игра ждёт чьего-то решения (чьего именно — не раскрывается). */
  waitingForDecision: boolean;
  /** Решение, которого ждут от вас. */
  decision: ViewDecision | null;
  /**
   * «Закулисье» — только в представлении с `seeAll` (ведущий-наблюдатель): чужие ходы и голоса
   * в реальном времени. У игроков всегда null.
   */
  backstage: {
    /** Ночные ходы всех игроков на текущий момент (ночью). */
    nightMoves: Record<PlayerId, NightEntry>;
    /** Голоса всех игроков на текущий момент (днём). */
    votes: Record<PlayerId, PlayerId | null>;
    /** От кого и какого решения ждёт игра. */
    decision: (ViewDecision & { playerId: PlayerId }) | null;
    /** Пары, связанные Купидоном. */
    lovers: [PlayerId, PlayerId][];
  } | null;
  events: ViewEvent[];
  result: GameResult | null;
}

/** Параметры представления. */
export interface ViewOptions {
  /**
   * Видеть всё: все роли, журнал целиком и «закулисье». Для ведущего-наблюдателя,
   * который сам не играет. Игрокам этот режим давать нельзя.
   */
  seeAll?: boolean;
}
