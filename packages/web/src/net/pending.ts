/**
 * Данные первого входа в комнату (имя и пароль) — только в памяти, между формой и экраном комнаты.
 * Пароль нигде не сохраняется.
 */
export interface PendingJoin {
  code: string;
  name: string;
  password: string;
}

let pending: PendingJoin | null = null;

export function setPendingJoin(join: PendingJoin | null): void {
  pending = join;
}

/** Забрать данные входа для комнаты (одноразово). */
export function takePendingJoin(code: string): PendingJoin | null {
  if (!pending || pending.code !== code) return null;
  const join = pending;
  pending = null;
  return join;
}
