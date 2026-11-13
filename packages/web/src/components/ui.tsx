/**
 * Базовые элементы интерфейса. Все стили — через токены из styles.css.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';
import { t } from '../i18n';
import { IconMinus, IconPlus, IconX } from './icons';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
export { cx };

// ───────────────────────────── кнопки ─────────────────────────────

type ButtonTone = 'gold' | 'wine' | 'ghost' | 'quiet' | 'danger';

const TONES: Record<ButtonTone, string> = {
  gold: 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink shadow-[0_8px_24px_-10px_rgb(212_173_79/0.7)] hover:from-gold-200 hover:to-gold-400 disabled:from-ash disabled:to-ash disabled:text-faint disabled:shadow-none',
  wine: 'bg-gradient-to-b from-wine-400 to-wine-500 text-paper shadow-[0_8px_24px_-12px_rgb(156_34_54/0.9)] hover:from-wine-300 hover:to-wine-400 disabled:from-ash disabled:to-ash disabled:text-faint',
  ghost: 'border border-gold-400/40 text-gold-300 bg-black/20 hover:bg-gold-400/10 disabled:opacity-40',
  quiet: 'text-muted hover:text-paper bg-white/5 hover:bg-white/10 disabled:opacity-40',
  danger: 'border border-danger/50 text-danger bg-danger/10 hover:bg-danger/20 disabled:opacity-40',
};

export function Button({
  tone = 'gold',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: 'sm' | 'md' | 'lg'; block?: boolean }) {
  const sizes = { sm: 'h-9 px-3 text-sm rounded-xl', md: 'h-12 px-5 text-[15px] rounded-2xl', lg: 'h-14 px-6 text-base rounded-2xl' };
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-semibold tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        sizes[size],
        TONES[tone],
        block && 'w-full',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  badge,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'relative inline-flex h-10 w-10 items-center justify-center rounded-full text-paper/85 transition hover:bg-white/10 active:scale-95',
        className,
      )}
    >
      {children}
      {badge ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-4.5 rounded-full bg-wine-400 px-1 text-center text-[10px] leading-4.5 font-bold text-paper">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

// ───────────────────────────── поля ─────────────────────────────

export function Field({
  label,
  hint,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-[0.14em] text-muted uppercase">{label}</span>
      <input
        id={id}
        {...rest}
        className={cx(
          'h-13 w-full rounded-2xl border bg-black/35 px-4 text-[17px] text-paper placeholder:text-faint outline-none transition focus:border-gold-400/70 focus:bg-black/50',
          error ? 'border-danger/70' : 'border-white/10',
          rest.className,
        )}
      />
      {error ? (
        <span role="alert" className="mt-1.5 block text-sm text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 py-2.5 text-left disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-paper">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-snug text-muted">{description}</span> : null}
      </span>
      <span
        className={cx(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition',
          checked ? 'border-gold-400/70 bg-gold-500/80' : 'border-white/15 bg-white/8',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-[22px] w-[22px] rounded-full shadow transition-all',
            checked ? 'left-[22px] bg-ink' : 'left-0.5 bg-muted',
          )}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl border border-white/10 bg-black/30 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-10 flex-1 rounded-xl px-2 text-sm font-semibold transition disabled:opacity-50',
            value === option.value ? 'bg-gold-400/90 text-ink shadow' : 'text-muted hover:text-paper',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  format,
  disabled,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-0.5" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}: меньше`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-paper/80 hover:bg-white/10 disabled:opacity-30"
      >
        <IconMinus size={16} />
      </button>
      <span className="min-w-9 text-center text-sm font-semibold tabular-nums">{format ? format(value) : value}</span>
      <button
        type="button"
        aria-label={`${label}: больше`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-paper/80 hover:bg-white/10 disabled:opacity-30"
      >
        <IconPlus size={16} />
      </button>
    </div>
  );
}

// ───────────────────────────── оформление ─────────────────────────────

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('panel p-4', className)}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-xs font-bold tracking-[0.18em] text-gold-300/90 uppercase">{children}</h2>
      {aside}
    </div>
  );
}

export function Ornament({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 text-gold-400/70', className)} aria-hidden>
      <span className="hairline flex-1" />
      <svg width="14" height="14" viewBox="0 0 14 14">
        <path d="M7 0l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="currentColor" />
      </svg>
      <span className="hairline flex-1" />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label={t.common.loading}
      className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-gold-400/30 border-t-gold-300', className)}
    />
  );
}

/** Полоса прогресса «сходили X из Y». */
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted">
        <span>{label}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-phase-accent"
          initial={false}
          animate={{ width: `${share * 100}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

// ───────────────────────────── листы и диалоги ─────────────────────────────

/** Нижний лист на весь экран (мобильный паттерн). */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-40 flex flex-col" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            className="relative mt-auto flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border-t border-gold-400/25 bg-coal shadow-[0_-20px_60px_-20px_black] sm:mx-auto sm:max-w-lg"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />
            <header className="flex items-center justify-between gap-2 px-5 pt-3 pb-2">
              <h2 className="font-display text-2xl text-paper">{title}</h2>
              <IconButton label={t.common.close} onClick={onClose}>
                <IconX />
              </IconButton>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
            {footer ? <div className="safe-bottom border-t border-white/8 px-5 pt-3">{footer}</div> : <div className="safe-bottom" />}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Подтверждение действия. */
export function useConfirm(): [ReactNode, (text: string, action: () => void, tone?: 'danger' | 'gold') => void] {
  const [state, setState] = useState<{ text: string; action: () => void; tone: 'danger' | 'gold' } | null>(null);
  const node = (
    <AnimatePresence>
      {state ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            className="panel w-full max-w-sm bg-coal p-5"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
          >
            <p className="mb-5 text-[17px] leading-snug">{state.text}</p>
            <div className="flex gap-3">
              <Button tone="quiet" block onClick={() => setState(null)}>
                {t.common.cancel}
              </Button>
              <Button
                tone={state.tone === 'danger' ? 'wine' : 'gold'}
                block
                onClick={() => {
                  state.action();
                  setState(null);
                }}
              >
                {t.common.confirm}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
  return [node, (text, action, tone = 'danger') => setState({ text, action, tone })];
}

/** Всплывающее сообщение внизу экрана. */
export function ToastView({ toast }: { toast: { id: number; text: string; tone: 'info' | 'error' | 'success' } | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.id}
            role="status"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className={cx(
              'max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-xl backdrop-blur',
              toast.tone === 'error' && 'border-danger/40 bg-wine-900/90 text-paper',
              toast.tone === 'success' && 'border-ok/40 bg-black/85 text-paper',
              toast.tone === 'info' && 'border-white/15 bg-black/85 text-paper',
            )}
          >
            {toast.text}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
