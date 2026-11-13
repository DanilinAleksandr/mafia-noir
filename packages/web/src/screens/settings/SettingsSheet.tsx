/**
 * Настройки партии. Хост меняет, остальные смотрят.
 *
 * Изменения сразу видны на экране (черновик) и уходят на сервер пачкой через полсекунды —
 * сервер проверяет их и присылает итоговые настройки всем. Пока своих неотправленных правок нет,
 * черновик совпадает с тем, что прислал сервер.
 */
import { DEFAULT_RULES, ROLES, ROLE_LIST, categoryOf, teamOf } from '@mafia/engine';
import type { Category, Quota, QuotaKey, RoleId, Rules } from '@mafia/engine';
import { LIMITS, QUOTA_KEYS, applySettingsPatch } from '@mafia/protocol';
import type { DisplayMode, HostMode, RoomSettings, RoomSnapshot, SettingsPatch, TimerSettings } from '@mafia/protocol';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { RoleEmblem } from '../../components/RoleEmblem';
import { IconX } from '../../components/icons';
import { Button, Segmented, Sheet, Stepper, Toggle, cx } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { TEAM_CLASS } from '../../theme/tokens';
import { BUILT_IN_SETS, type RoleSet, loadSavedSets, patchFromSet, saveSets, setFromSettings } from './presets';

const CATEGORY_ORDER: Category[] = ['redInfo', 'redDefense', 'redActive', 'redPlain', 'black', 'neutral'];
const TIMER_STEPS = [null, 15, 30, 45, 60, 90, 120, 180, 300, 600] as const;
const TIMER_KEYS: (keyof TimerSettings)[] = ['night', 'discussion', 'day', 'decision'];

function mergePatch(a: SettingsPatch, b: SettingsPatch): SettingsPatch {
  return {
    ...a,
    ...b,
    timers: a.timers || b.timers ? { ...a.timers, ...b.timers } : undefined,
    rules: a.rules || b.rules ? { ...a.rules, ...b.rules } : undefined,
    composition: a.composition || b.composition ? { ...a.composition, ...b.composition } : undefined,
  };
}

function clean(patch: SettingsPatch): SettingsPatch {
  const out: SettingsPatch = {};
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  return out;
}

/** Черновик настроек с отложенной отправкой. */
function useSettingsDraft(server: RoomSettings, send: (patch: SettingsPatch) => void) {
  const [draft, setDraft] = useState(server);
  const pending = useRef<SettingsPatch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pending.current) setDraft(server);
  }, [server]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = null;
    if (patch) send(clean(patch));
  }, [send]);

  useEffect(() => () => flush(), [flush]);

  const change = useCallback(
    (patch: SettingsPatch) => {
      setDraft((current) => applySettingsPatch(current, patch));
      pending.current = pending.current ? mergePatch(pending.current, patch) : patch;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 450);
    },
    [flush],
  );
  return { draft, change, flush };
}

function roleEnabled(settings: RoomSettings, role: RoleId): boolean {
  return settings.composition.roles[role]?.enabled ?? true;
}

function roleMax(settings: RoomSettings, role: RoleId): number | null {
  const setting = settings.composition.roles[role];
  return setting && setting.max !== undefined ? setting.max : ROLES[role].maxCopies;
}

export function SettingsSheet({ open, onClose, editable }: { open: boolean; onClose: () => void; editable: boolean }) {
  const store = useStore();
  const { room } = useRoomState();
  const send = useCallback((patch: SettingsPatch) => void store.settings(patch), [store]);
  const { draft, change, flush } = useSettingsDraft(room?.settings ?? defaultish(), send);
  if (!room) return null;
  const playerCount = room.members.filter((m) => m.playing).length;
  const close = () => {
    flush();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={editable ? t.settings.title : t.lobby.viewSettings}
      footer={
        <div className="space-y-2 pb-1">
          <Issues room={room} />
          <Button block onClick={close}>
            {t.settings.done}
          </Button>
        </div>
      }
    >
      {!editable ? <p className="mb-3 text-sm text-muted">{t.settings.readOnly}</p> : null}
      <div className="space-y-7 pb-4">
        {editable ? <PresetsSection settings={draft} onApply={(patch) => change(patch)} /> : null}

        <Section title={t.settings.hostMode}>
          <Segmented<HostMode>
            label={t.settings.hostMode}
            value={draft.hostMode}
            disabled={!editable}
            onChange={(hostMode) => change({ hostMode })}
            options={[
              { value: 'player', label: t.hostModes.player.name },
              { value: 'narrator', label: t.hostModes.narrator.name },
            ]}
          />
          <p className="mt-2 text-xs text-muted">{t.hostModes[draft.hostMode].description}</p>
        </Section>

        <Section title={t.settings.display}>
          <div className="space-y-2" role="radiogroup" aria-label={t.settings.display}>
            {(['stealth', 'open', 'cinema'] as DisplayMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={draft.display === mode}
                disabled={!editable}
                onClick={() => change({ display: mode })}
                className={cx(
                  'w-full rounded-2xl border p-3 text-left transition disabled:cursor-default',
                  draft.display === mode ? 'border-gold-400/70 bg-gold-400/10' : 'border-white/8 bg-black/20',
                )}
              >
                <span className="block font-semibold">{t.displayModes[mode].name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{t.displayModes[mode].description}</span>
              </button>
            ))}
          </div>
        </Section>

        <RolesSection settings={draft} editable={editable} onChange={change} />
        <QuotasSection settings={draft} editable={editable} onChange={change} />
        <ManualSection settings={draft} editable={editable} onChange={change} playerCount={playerCount} presetHidden={room.presetHidden} />
        <RulesSection rules={draft.rules} editable={editable} onChange={(rules) => change({ rules })} />
        <TimersSection timers={draft.timers} editable={editable} onChange={(timers) => change({ timers })} />
      </div>
    </Sheet>
  );
}

/** Включённые роли набора совпадают с текущими (ручной состав не задан). */
function sameRoles(set: RoleSet, settings: RoomSettings): boolean {
  if (settings.composition.preset) return false;
  return ROLE_LIST.every(
    (r) => (set.composition.roles[r.id]?.enabled ?? true) === (settings.composition.roles[r.id]?.enabled ?? true),
  );
}

function defaultish(): RoomSettings {
  return {
    hostMode: 'player',
    display: 'stealth',
    timers: { night: null, discussion: null, day: null, decision: null },
    rules: { ...DEFAULT_RULES },
    composition: { roles: {}, quotas: {}, preset: null, minCiviliansShare: null },
  };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-bold tracking-[0.18em] text-gold-300/90 uppercase">{title}</h3>
      {hint ? <p className="mb-2 text-xs leading-snug text-muted">{hint}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function Issues({ room }: { room: RoomSnapshot }) {
  if (room.startIssues.length === 0 && room.startWarnings.length === 0) return null;
  return (
    <div className="max-h-28 overflow-y-auto text-xs leading-snug">
      {room.startIssues.map((issue) => (
        <p key={issue} className="text-danger">
          • {issue}
        </p>
      ))}
      {room.startWarnings.map((warning) => (
        <p key={warning} className="text-warn">
          • {warning}
        </p>
      ))}
    </div>
  );
}

// ───────────────────────────── наборы ─────────────────────────────

function PresetsSection({ settings, onApply }: { settings: RoomSettings; onApply: (patch: SettingsPatch) => void }) {
  const [saved, setSaved] = useState<RoleSet[]>(() => loadSavedSets());
  const [name, setName] = useState('');
  const store = useStore();
  const save = () => {
    const clean = name.trim();
    if (!clean) return;
    const next = [...saved.filter((s) => s.name !== clean), setFromSettings(clean, settings)];
    setSaved(next);
    saveSets(next);
    setName('');
    store.toast(`Набор «${clean}» сохранён`, 'success');
  };
  return (
    <Section title={t.settings.presets}>
      <div className="grid grid-cols-2 gap-2">
        {BUILT_IN_SETS.map((set) => (
          <button
            key={set.name}
            type="button"
            aria-pressed={sameRoles(set, settings)}
            onClick={() => onApply(patchFromSet(set))}
            className={cx(
              'rounded-2xl border p-3 text-left transition hover:border-gold-400/50 active:scale-[0.98]',
              sameRoles(set, settings) ? 'border-gold-400/70 bg-gold-400/10' : 'border-white/10 bg-black/25',
            )}
          >
            <span className="block font-display text-[17px]">{set.name}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{set.description}</span>
          </button>
        ))}
      </div>
      <h4 className="mt-4 mb-2 text-xs font-semibold text-muted">{t.settings.saved}</h4>
      {saved.length === 0 ? <p className="text-xs text-faint">{t.settings.noSaved}</p> : null}
      <ul className="space-y-1.5">
        {saved.map((set) => (
          <li key={set.name} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onApply(patchFromSet(set))}
              className="flex-1 truncate rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-left text-sm hover:border-gold-400/50"
            >
              {set.name}
            </button>
            <button
              type="button"
              aria-label={`${t.settings.deleteSet}: ${set.name}`}
              onClick={() => {
                const next = saved.filter((s) => s.name !== set.name);
                setSaved(next);
                saveSets(next);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-white/10"
            >
              <IconX size={16} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={name}
          maxLength={30}
          placeholder={t.settings.saveName}
          aria-label={t.settings.saveName}
          onChange={(e) => setName(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/35 px-4 text-[15px] outline-none placeholder:text-faint focus:border-gold-400/70"
        />
        <Button tone="ghost" onClick={save} disabled={!name.trim()}>
          {t.settings.saveCurrent}
        </Button>
      </div>
    </Section>
  );
}

// ───────────────────────────── роли ─────────────────────────────

function RolesSection({
  settings,
  editable,
  onChange,
}: {
  settings: RoomSettings;
  editable: boolean;
  onChange: (patch: SettingsPatch) => void;
}) {
  const rules = settings.rules;
  const setRole = (role: RoleId, next: { enabled?: boolean; max?: number | null }) => {
    const roles = { ...settings.composition.roles };
    const current = { ...(roles[role] ?? {}) };
    if (next.enabled !== undefined) {
      if (next.enabled) delete current.enabled;
      else current.enabled = false;
    }
    if (next.max !== undefined) {
      if (next.max === ROLES[role].maxCopies) delete current.max;
      else current.max = next.max;
    }
    if (Object.keys(current).length === 0) delete roles[role];
    else roles[role] = current;
    onChange({ composition: { roles } });
  };
  const enabledCount = ROLE_LIST.filter((r) => roleEnabled(settings, r.id)).length;
  return (
    <Section title={`${t.settings.roles} · ${enabledCount}/${ROLE_LIST.length}`}>
      <div className="space-y-5">
        {CATEGORY_ORDER.map((category) => {
          const roles = ROLE_LIST.filter((r) => categoryOf(r.id, rules) === category);
          if (roles.length === 0) return null;
          return (
            <div key={category}>
              <h4 className="mb-1 text-xs text-muted">{t.categories[category]}</h4>
              <ul className="divide-y divide-white/6 rounded-2xl border border-white/8 bg-black/20 px-3">
                {roles.map((r) => {
                  const enabled = roleEnabled(settings, r.id);
                  const max = roleMax(settings, r.id);
                  const team = teamOf(r.id, rules);
                  return (
                    <li key={r.id} className="py-1" data-testid={`role-${r.id}`}>
                      <div className="flex items-start gap-2.5">
                        <span className={cx('mt-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', TEAM_CLASS[team])}>
                          <RoleEmblem role={r.id} size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <Toggle
                            checked={enabled}
                            disabled={!editable}
                            onChange={(value) => setRole(r.id, { enabled: value })}
                            label={t.roles[r.id].name}
                            description={t.roles[r.id].short}
                          />
                        </div>
                      </div>
                      {enabled ? (
                        <div className="mb-1.5 ml-[42px] flex items-center justify-between text-xs text-muted">
                          <span>{t.settings.copies}</span>
                          <Stepper
                            label={`${t.settings.copies}: ${t.roles[r.id].name}`}
                            value={max ?? LIMITS.countMax + 1}
                            min={1}
                            max={LIMITS.countMax + 1}
                            disabled={!editable}
                            format={(v) => (v > LIMITS.countMax ? '∞' : String(v))}
                            onChange={(v) => setRole(r.id, { max: v > LIMITS.countMax ? null : v })}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ───────────────────────────── квоты ─────────────────────────────

type QuotaMode = 'auto' | 'exact' | 'range';

function quotaMode(quota: Quota | undefined): QuotaMode {
  if (!quota || (quota.exact === undefined && quota.min === undefined && quota.max === undefined)) return 'auto';
  return quota.exact !== undefined ? 'exact' : 'range';
}

function QuotasSection({
  settings,
  editable,
  onChange,
}: {
  settings: RoomSettings;
  editable: boolean;
  onChange: (patch: SettingsPatch) => void;
}) {
  const quotas = settings.composition.quotas;
  const setQuota = (key: QuotaKey, quota: Quota | null) => {
    const next = { ...quotas };
    if (quota) next[key] = quota;
    else delete next[key];
    onChange({ composition: { quotas: next } });
  };
  const share = settings.composition.minCiviliansShare;
  return (
    <Section title={t.settings.quotas} hint={t.settings.quotasHint}>
      <ul className="space-y-3">
        {QUOTA_KEYS.map((key) => {
          const quota = quotas[key];
          const mode = quotaMode(quota);
          return (
            <li key={key} className="rounded-2xl border border-white/8 bg-black/20 p-3">
              <div className="mb-2 text-sm font-semibold">{t.categories[key]}</div>
              <Segmented<QuotaMode>
                label={t.categories[key]}
                value={mode}
                disabled={!editable}
                onChange={(m) =>
                  setQuota(key, m === 'auto' ? null : m === 'exact' ? { exact: quota?.exact ?? quota?.min ?? 1 } : { min: quota?.exact ?? quota?.min ?? 0, max: quota?.exact ?? quota?.max ?? 2 })
                }
                options={[
                  { value: 'auto', label: t.settings.quotaAuto },
                  { value: 'exact', label: t.settings.quotaExact },
                  { value: 'range', label: t.settings.quotaRange },
                ]}
              />
              {mode === 'exact' ? (
                <div className="mt-2 flex justify-end">
                  <Stepper
                    label={`${t.categories[key]}: ровно`}
                    value={quota?.exact ?? 0}
                    min={0}
                    max={LIMITS.countMax}
                    disabled={!editable}
                    onChange={(v) => setQuota(key, { exact: v })}
                  />
                </div>
              ) : null}
              {mode === 'range' ? (
                <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
                  от
                  <Stepper
                    label={`${t.categories[key]}: от`}
                    value={quota?.min ?? 0}
                    min={0}
                    max={quota?.max ?? LIMITS.countMax}
                    disabled={!editable}
                    onChange={(v) => setQuota(key, { ...quota, min: v })}
                  />
                  до
                  <Stepper
                    label={`${t.categories[key]}: до`}
                    value={quota?.max ?? LIMITS.countMax}
                    min={quota?.min ?? 0}
                    max={LIMITS.countMax}
                    disabled={!editable}
                    onChange={(v) => setQuota(key, { ...quota, max: v })}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
        <li className="rounded-2xl border border-white/8 bg-black/20 p-3">
          <div className="mb-1 text-sm font-semibold">{t.settings.civilianShare}</div>
          <p className="mb-2 text-xs text-muted">{t.settings.civilianShareHint}</p>
          <div className="flex items-center justify-between gap-2">
            <Toggle
              checked={share === null}
              disabled={!editable}
              onChange={(auto) => onChange({ composition: { minCiviliansShare: auto ? null : 0.3 } })}
              label={t.common.auto}
            />
            {share !== null ? (
              <Stepper
                label={t.settings.civilianShare}
                value={Math.round(share * 10)}
                min={0}
                max={10}
                disabled={!editable}
                format={(v) => `${v * 10}%`}
                onChange={(v) => onChange({ composition: { minCiviliansShare: v / 10 } })}
              />
            ) : null}
          </div>
        </li>
      </ul>
    </Section>
  );
}

// ───────────────────────────── ручной состав ─────────────────────────────

function ManualSection({
  settings,
  editable,
  onChange,
  playerCount,
  presetHidden,
}: {
  settings: RoomSettings;
  editable: boolean;
  onChange: (patch: SettingsPatch) => void;
  playerCount: number;
  presetHidden: boolean;
}) {
  const preset = settings.composition.preset;
  if (!editable && presetHidden) {
    return (
      <Section title={t.settings.manual}>
        <p className="text-sm text-muted">{t.settings.presetHidden}</p>
      </Section>
    );
  }
  if (!editable && !preset) return null;
  const counts = new Map<RoleId, number>();
  for (const role of preset ?? []) counts.set(role, (counts.get(role) ?? 0) + 1);
  const setCount = (role: RoleId, n: number) => {
    counts.set(role, n);
    const next: RoleId[] = [];
    for (const r of ROLE_LIST) for (let i = 0; i < (counts.get(r.id) ?? 0); i++) next.push(r.id);
    onChange({ composition: { preset: next } });
  };
  return (
    <Section title={t.settings.manual} hint={t.settings.manualHint}>
      <Toggle
        checked={preset !== null}
        disabled={!editable}
        onChange={(on) => onChange({ composition: { preset: on ? defaultPreset(playerCount) : null } })}
        label={t.settings.manualOn}
      />
      {preset ? (
        <>
          <p className={cx('mt-1 mb-2 text-sm', preset.length === playerCount ? 'text-ok' : 'text-warn')}>
            {t.settings.manualSum(preset.length, playerCount)}
          </p>
          <ul className="divide-y divide-white/6 rounded-2xl border border-white/8 bg-black/20 px-3">
            {ROLE_LIST.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className={cx((counts.get(r.id) ?? 0) === 0 && 'text-muted')}>{t.roles[r.id].name}</span>
                <Stepper
                  label={`${t.settings.manual}: ${t.roles[r.id].name}`}
                  value={counts.get(r.id) ?? 0}
                  min={0}
                  max={LIMITS.maxMembers}
                  disabled={!editable}
                  onChange={(v) => setCount(r.id, v)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

function defaultPreset(playerCount: number): RoleId[] {
  const n = Math.max(4, playerCount);
  const black = Math.max(1, Math.floor((n - 1) / 3));
  const out: RoleId[] = ['commissioner', 'doctor'];
  for (let i = 0; i < black; i++) out.push('mafia');
  while (out.length < n) out.push('civilian');
  return out;
}

// ───────────────────────────── правила ─────────────────────────────

const BOOLEAN_RULES = [
  'revealRoleOnDeath',
  'revealDeathCause',
  'announceSaves',
  'deadSeeAllRoles',
  'doctorSelfHeal',
  'commissionerSeesDonAsMafia',
  'commissionerSeesManiacAsMafia',
  'jesterWinEndsGame',
] as const;

function RulesSection({
  rules,
  editable,
  onChange,
}: {
  rules: Rules;
  editable: boolean;
  onChange: (rules: Partial<Rules>) => void;
}) {
  return (
    <Section title={t.settings.rules}>
      <div className="mb-3">
        <div className="mb-1.5 text-sm">{t.rules.votingMode.name}</div>
        <Segmented
          label={t.rules.votingMode.name}
          value={rules.votingMode}
          disabled={!editable}
          onChange={(votingMode) => onChange({ votingMode })}
          options={(['secret', 'revealAfter', 'open'] as const).map((v) => ({ value: v, label: t.votingModes[v].name }))}
        />
        <p className="mt-1.5 text-xs text-muted">{t.votingModes[rules.votingMode].description}</p>
      </div>
      <div className="mb-2">
        <div className="mb-1.5 text-sm">{t.rules.mistressMode.name}</div>
        <Segmented
          label={t.rules.mistressMode.name}
          value={rules.mistressMode}
          disabled={!editable}
          onChange={(mistressMode) => onChange({ mistressMode })}
          options={[
            { value: 'neutral', label: 'Сама за себя' },
            { value: 'red', label: 'За красных' },
          ]}
        />
      </div>
      <div className="divide-y divide-white/6">
        {BOOLEAN_RULES.map((key) => (
          <Toggle
            key={key}
            checked={rules[key]}
            disabled={!editable}
            onChange={(value) => onChange({ [key]: value })}
            label={t.rules[key].name}
            description={t.rules[key].description}
          />
        ))}
      </div>
    </Section>
  );
}

// ───────────────────────────── таймеры ─────────────────────────────

function TimersSection({
  timers,
  editable,
  onChange,
}: {
  timers: TimerSettings;
  editable: boolean;
  onChange: (timers: Partial<TimerSettings>) => void;
}) {
  return (
    <Section title={t.settings.timers} hint={t.settings.timersHint}>
      <ul className="space-y-2">
        {TIMER_KEYS.map((key) => {
          const value = timers[key] ?? null;
          const index = Math.max(0, TIMER_STEPS.findIndex((s) => s === value));
          return (
            <li key={key} className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
              <span className="text-sm">{t.settings.timerNames[key]}</span>
              <Stepper
                label={t.settings.timerNames[key]}
                value={index}
                min={0}
                max={TIMER_STEPS.length - 1}
                disabled={!editable}
                format={(i) => {
                  const s = TIMER_STEPS[i] ?? null;
                  return s === null ? t.common.off : t.common.seconds(s);
                }}
                onChange={(i) => onChange({ [key]: TIMER_STEPS[i] ?? null })}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ───────────────────────────── краткая сводка для лобби ─────────────────────────────

export function SettingsSummary({ room }: { room: RoomSnapshot }) {
  const s = room.settings;
  const enabled = ROLE_LIST.filter((r) => roleEnabled(s, r.id));
  const timers = TIMER_KEYS.filter((k) => s.timers[k] !== null && s.timers[k] !== undefined);
  return (
    <div className="space-y-2.5 text-sm" data-testid="settings-summary">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        <span>
          <span className="text-paper">{t.displayModes[s.display].name}</span> · показ
        </span>
        <span>
          <span className="text-paper">{t.hostModes[s.hostMode].name}</span>
        </span>
        <span>
          <span className="text-paper">{t.votingModes[s.rules.votingMode].name}</span> голосование
        </span>
      </div>
      {room.presetHidden ? (
        <p className="text-muted">{t.settings.presetHidden}</p>
      ) : s.composition.preset ? (
        <p className="text-muted">
          {t.settings.manual}: {s.composition.preset.map((r) => t.roles[r].name).join(', ')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {enabled.map((r) => (
            <span
              key={r.id}
              className={cx('rounded-full border px-2 py-0.5 text-xs', TEAM_CLASS[teamOf(r.id, s.rules)])}
            >
              {t.roles[r.id].name}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        {t.settings.timers}:{' '}
        {timers.length === 0
          ? t.common.off.toLowerCase()
          : timers.map((k) => `${t.settings.timerNames[k].toLowerCase()} ${t.common.seconds(s.timers[k] as number)}`).join(', ')}
      </p>
    </div>
  );
}
