/**
 * Чат мафии: только ночью и только живым чёрным. Ведущий читает, но не пишет.
 */
import { LIMITS } from '@mafia/protocol';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button, cx } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';

export function MafiaChat({ onOpenChange, readOnly = false }: { onOpenChange?: (open: boolean) => void; readOnly?: boolean }) {
  const store = useStore();
  const { chat, memberId, game } = useRoomState();
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const canWrite = !readOnly && game?.stage === 'night' && Boolean(game.view.you?.alive && game.view.you.team === 'black');

  useEffect(() => {
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [onOpenChange]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    const reply = await store.chat(clean);
    if (reply.ok) setText('');
  };

  return (
    <div className="flex flex-col gap-3">
      {readOnly ? <p className="text-xs text-muted">{t.game.night.chatReadOnly}</p> : null}
      <div className="min-h-40 space-y-2" data-testid="mafia-chat">
        {chat.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t.game.night.chatEmpty}</p> : null}
        {chat.map((m) => {
          const mine = m.from === memberId;
          return (
            <div key={m.id} className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
              <span className="mb-0.5 text-[11px] text-muted">{m.name}</span>
              <span
                className={cx(
                  'max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug',
                  mine ? 'rounded-br-md bg-wine-500/70' : 'rounded-bl-md bg-white/8',
                )}
              >
                {m.text}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {canWrite ? (
        <form onSubmit={submit} className="sticky bottom-0 flex gap-2 bg-coal pt-1">
          <input
            value={text}
            maxLength={LIMITS.chatMax}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.game.night.chatPlaceholder}
            aria-label={t.game.night.chatPlaceholder}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none focus:border-wine-300/70"
          />
          <Button type="submit" tone="wine" disabled={!text.trim()}>
            {t.game.night.chatSend}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
