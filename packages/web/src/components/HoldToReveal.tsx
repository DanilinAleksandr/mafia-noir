/**
 * Карточка роли, которая открывается только пока её удерживают — чтобы соседи не подсмотрели.
 */
import type { RoleId, Team } from '@mafia/engine';
import { type ReactNode, useEffect, useState } from 'react';
import { t } from '../i18n';
import { RoleCard } from './RoleCard';

export function HoldToReveal({
  role,
  team,
  width = 230,
  children,
}: {
  role: RoleId;
  team: Team;
  width?: number;
  /** Что показывать под карточкой, пока она открыта (описание, сообщники). */
  children?: ReactNode;
}) {
  const [held, setHeld] = useState(false);

  // палец может уйти с экрана где угодно — отпускаем по любому отпусканию
  useEffect(() => {
    if (!held) return;
    const release = () => setHeld(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [held]);

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={t.game.holdToView}
        aria-pressed={held}
        className="touch-none rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
        onPointerDown={(event) => {
          event.preventDefault();
          setHeld(true);
        }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            setHeld(true);
          }
        }}
        onKeyUp={() => setHeld(false)}
      >
        <RoleCard role={role} team={team} faceUp={held} width={width} detailed />
      </button>
      <div className="mt-4 min-h-24 w-full text-center" aria-live="polite">
        {held ? (
          children
        ) : (
          <>
            <p className="text-[15px] text-paper/90">{t.game.holdToView}</p>
            <p className="mt-1 text-xs text-muted">{t.game.holdHint}</p>
          </>
        )}
      </div>
    </div>
  );
}
