import type { ReactNode } from 'react';
import { t } from '../i18n';
import { IconBack } from './icons';
import { IconButton } from './ui';

export function TopBar({ title, onBack, aside }: { title: ReactNode; onBack?: () => void; aside?: ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-20 -mx-4 flex items-center gap-2 bg-gradient-to-b from-ink/95 to-ink/0 px-2 pb-3 backdrop-blur-[1px]">
      {onBack ? (
        <IconButton label={t.common.back} onClick={onBack}>
          <IconBack />
        </IconButton>
      ) : (
        <span className="w-2" />
      )}
      <h1 className="min-w-0 flex-1 truncate font-display text-2xl">{title}</h1>
      {aside}
    </header>
  );
}
