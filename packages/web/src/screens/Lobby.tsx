/**
 * Лобби: код комнаты и приглашение, участники с онлайн-статусом, действия хоста, старт.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Screen } from '../App';
import { PrefsSheet } from '../components/PrefsSheet';
import { RoleReference } from '../components/RoleReference';
import { Avatar } from '../components/players';
import { IconBook, IconCog, IconCrown, IconDoor, IconEye, IconShare } from '../components/icons';
import { Button, IconButton, Panel, SectionTitle, Sheet, cx, useConfirm } from '../components/ui';
import { t } from '../i18n';
import { inviteUrl } from '../net/config';
import { navigate } from '../router';
import { shareLink } from '../lib/share';
import { useRoomState, useStore } from '../store/context';
import { SettingsSheet, SettingsSummary } from './settings/SettingsSheet';

export function Lobby() {
  const store = useStore();
  const { room, memberId } = useRoomState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  if (!room) return null;

  const isHost = room.hostId === memberId;
  const players = room.members.filter((m) => m.playing);
  const narrator = room.settings.hostMode === 'narrator';

  const share = async () => {
    const result = await shareLink({ title: t.appName, text: t.lobby.shareText(room.code), url: inviteUrl(room.code) });
    if (result === 'copied') store.toast(t.lobby.copied, 'success');
    if (result === 'failed') store.toast(t.lobby.copyFailed, 'error');
  };

  return (
    <Screen className="safe-top pb-36">
      <header className="flex items-center justify-between pt-2">
        <IconButton label={t.connection.home} onClick={() => navigate('/')}>
          <IconDoor className="rotate-180" />
        </IconButton>
        <span className="text-xs font-bold tracking-[0.3em] text-muted uppercase">{t.lobby.title}</span>
        <span className="flex">
          <IconButton label="Эффекты и звук" onClick={() => setPrefsOpen(true)}>
            <IconCog />
          </IconButton>
          <IconButton label={t.home.rules} onClick={() => setRolesOpen(true)}>
            <IconBook />
          </IconButton>
        </span>
      </header>

      <section className="mt-2 text-center">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">{t.lobby.code}</p>
        <p data-testid="room-code" className="gold-text font-display text-[56px] leading-tight font-bold tracking-[0.16em]">
          {room.code}
        </p>
        <Button tone="ghost" size="sm" className="mt-1" onClick={share}>
          <IconShare size={16} /> {t.lobby.share}
        </Button>
      </section>

      <Panel className="mt-6">
        <SectionTitle aside={<span className="text-xs text-muted">{t.lobby.playersCount(players.length)}</span>}>
          {t.lobby.members}
        </SectionTitle>
        <ul className="divide-y divide-white/6">
          <AnimatePresence initial={false}>
            {room.members.map((m) => {
              const open = selected === m.id && isHost && m.id !== memberId;
              return (
                <motion.li
                  key={m.id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  data-testid="member"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                    onClick={() => setSelected(open ? null : m.id)}
                    disabled={!isHost || m.id === memberId}
                  >
                    <Avatar name={m.name} id={m.id} online={m.online} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[15px] font-semibold">{m.name}</span>
                        {m.id === memberId ? <span className="text-xs text-gold-300">({t.common.you})</span> : null}
                      </span>
                      <span className={cx('text-xs', m.online ? 'text-ok' : 'text-faint')}>
                        {m.online ? t.common.online : t.common.offline}
                        {!m.playing ? ` · ${t.common.narrator}` : ''}
                      </span>
                    </span>
                    {m.isHost ? (
                      <span className="flex items-center gap-1 text-xs text-gold-300">
                        <IconCrown size={16} /> {t.common.host}
                      </span>
                    ) : null}
                  </button>
                  <AnimatePresence>
                    {open ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="flex gap-2 overflow-hidden pb-3"
                      >
                        <Button
                          tone="ghost"
                          size="sm"
                          onClick={() => {
                            setSelected(null);
                            void store.transferHost(m.id);
                          }}
                        >
                          <IconCrown size={14} /> {t.lobby.makeHost}
                        </Button>
                        <Button
                          tone="danger"
                          size="sm"
                          onClick={() =>
                            confirm(t.lobby.confirmKick(m.name), () => {
                              setSelected(null);
                              void store.kick(m.id);
                            })
                          }
                        >
                          {t.lobby.kick}
                        </Button>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle
          aside={
            <Button tone="quiet" size="sm" onClick={() => setSettingsOpen(true)}>
              {isHost ? <IconCog size={16} /> : <IconEye size={16} />}
              {isHost ? t.lobby.settings : t.lobby.viewSettings}
            </Button>
          }
        >
          {t.lobby.viewSettings}
        </SectionTitle>
        <SettingsSummary room={room} />
      </Panel>

      {isHost && narrator ? <p className="mt-4 text-center text-sm text-gold-200/80">{t.lobby.narratorNote}</p> : null}

      {room.startIssues.length > 0 || room.startWarnings.length > 0 ? (
        <div className="mt-4 space-y-2 text-sm" data-testid="start-issues">
          {room.startIssues.length > 0 ? (
            <div className="rounded-2xl border border-danger/30 bg-danger/8 p-3">
              <p className="mb-1 font-semibold text-danger">{t.lobby.cannotStart}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-paper/85">
                {room.startIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {room.startWarnings.length > 0 ? (
            <div className="rounded-2xl border border-warn/30 bg-warn/8 p-3">
              <p className="mb-1 font-semibold text-warn">{t.lobby.warnings}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-paper/80">
                {room.startWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="safe-bottom fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pt-8">
        <div className="mx-auto max-w-md space-y-2">
          {isHost ? (
            <Button block size="lg" disabled={room.startIssues.length > 0} onClick={() => void store.start()}>
              {t.lobby.start}
            </Button>
          ) : (
            <p className="py-3 text-center text-[15px] text-paper/80">{t.lobby.waitHost}…</p>
          )}
          <button
            type="button"
            className="w-full py-1.5 text-center text-sm text-muted hover:text-paper"
            onClick={() =>
              confirm(t.lobby.confirmLeave, async () => {
                const reply = await store.leave();
                if (reply.ok) navigate('/');
              })
            }
          >
            {t.lobby.leave}
          </button>
        </div>
      </footer>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} editable={isHost} />
      <Sheet open={rolesOpen} onClose={() => setRolesOpen(false)} title={t.home.rules}>
        <RoleReference rules={room.settings.rules} />
      </Sheet>
      <PrefsSheet open={prefsOpen} onClose={() => setPrefsOpen(false)} />
      {confirmNode}
    </Screen>
  );
}
