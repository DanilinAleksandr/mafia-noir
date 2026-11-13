import { LIMITS } from '@mafia/protocol';
import type { HostMode } from '@mafia/protocol';
import { type FormEvent, useState } from 'react';
import { Screen } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Field, Segmented } from '../components/ui';
import { t } from '../i18n';
import { ApiError, createRoom } from '../net/api';
import { storeSession } from '../net/session';
import { navigate } from '../router';

export function CreateRoom() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [hostMode, setHostMode] = useState<HostMode>('player');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return setError('Введите имя');
    if (!password) return setError('Придумайте пароль');
    setBusy(true);
    setError(null);
    try {
      const created = await createRoom({ name: cleanName, password, hostMode });
      storeSession({ code: created.code, memberId: created.memberId, name: cleanName, token: created.token });
      navigate(`/r/${created.code}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.errors.unknown);
      setBusy(false);
    }
  };

  return (
    <Screen className="safe-bottom">
      <TopBar title={t.entry.createTitle} onBack={() => navigate('/')} />
      <form onSubmit={submit} className="mt-4 flex flex-1 flex-col gap-5">
        <Field
          label={t.entry.name}
          placeholder={t.entry.namePlaceholder}
          value={name}
          maxLength={LIMITS.nameMax}
          autoComplete="nickname"
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={t.entry.password}
          placeholder={t.entry.passwordPlaceholder}
          hint={t.entry.passwordHint}
          value={password}
          maxLength={LIMITS.passwordMax}
          autoComplete="off"
          onChange={(e) => setPassword(e.target.value)}
        />
        <div>
          <span className="mb-1.5 block text-xs font-semibold tracking-[0.14em] text-muted uppercase">{t.entry.hostMode}</span>
          <Segmented
            label={t.entry.hostMode}
            value={hostMode}
            onChange={setHostMode}
            options={[
              { value: 'player', label: t.hostModes.player.name },
              { value: 'narrator', label: t.hostModes.narrator.name },
            ]}
          />
          <p className="mt-2 text-xs leading-snug text-muted">{t.hostModes[hostMode].description}</p>
        </div>
        {error ? (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-auto pb-2">
          <Button type="submit" block size="lg" disabled={busy}>
            {busy ? t.common.loading : t.entry.submitCreate}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
