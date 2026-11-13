import { LIMITS, normalizeRoomCode } from '@mafia/protocol';
import { type FormEvent, useState } from 'react';
import { Screen } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Field } from '../components/ui';
import { t } from '../i18n';
import { ApiError, roomInfo } from '../net/api';
import { setPendingJoin } from '../net/pending';
import { navigate } from '../router';

/** Форма входа: код (если он не известен из ссылки), имя и пароль. */
export function JoinForm({
  fixedCode,
  initialCode,
  initialError,
  onJoin,
}: {
  fixedCode?: string;
  initialCode?: string | null;
  initialError?: string | null;
  onJoin: (join: { code: string; name: string; password: string }) => void;
}) {
  const [code, setCode] = useState(fixedCode ?? initialCode ?? '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) return setError(t.entry.badCode);
    if (!name.trim()) return setError('Введите имя');
    if (!password) return setError('Введите пароль комнаты');
    setBusy(true);
    setError(null);
    try {
      // проверка, что комната есть и в неё можно войти: иначе WebSocket к ней не откроется вовсе
      const info = await roomInfo(normalized);
      if (!info.joinable) {
        setBusy(false);
        return setError(info.stage === 'lobby' ? 'В комнате нет свободных мест' : t.entry.roomStarted);
      }
    } catch (e) {
      setBusy(false);
      return setError(e instanceof ApiError ? e.message : t.errors.unknown);
    }
    onJoin({ code: normalized, name: name.trim(), password });
  };

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-5">
      {fixedCode ? (
        <div className="text-center">
          <span className="text-xs tracking-[0.2em] text-muted uppercase">{t.entry.code}</span>
          <div className="gold-text font-display text-5xl font-bold tracking-[0.18em]">{fixedCode}</div>
        </div>
      ) : (
        <Field
          label={t.entry.code}
          placeholder={t.entry.codePlaceholder}
          value={code}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={8}
          className="text-center font-display text-2xl tracking-[0.3em] uppercase"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      )}
      <Field
        label={t.entry.name}
        placeholder={t.entry.namePlaceholder}
        value={name}
        maxLength={LIMITS.nameMax}
        autoComplete="nickname"
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label={t.entry.password}
        value={password}
        maxLength={LIMITS.passwordMax}
        autoComplete="off"
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-auto pb-2">
        <Button type="submit" tone="wine" block size="lg" disabled={busy}>
          {busy ? t.common.loading : t.entry.submitJoin}
        </Button>
      </div>
    </form>
  );
}

export function JoinRoom({ initialCode }: { initialCode: string | null }) {
  return (
    <Screen className="safe-bottom">
      <TopBar title={t.entry.joinTitle} onBack={() => navigate('/')} />
      <div className="mt-4 flex flex-1 flex-col">
        <JoinForm
          initialCode={initialCode}
          onJoin={(join) => {
            setPendingJoin(join);
            navigate(`/r/${join.code}`);
          }}
        />
      </div>
    </Screen>
  );
}

export { ApiError };
