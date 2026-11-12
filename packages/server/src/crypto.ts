/**
 * Криптография комнаты: хеш пароля (PBKDF2), токены переподключения, случайные значения.
 * Только WebCrypto — работает в Workers и локально без изменений.
 */

/** Число итераций PBKDF2. 100 000 — максимум, который допускает WebCrypto в Workers. */
export const PBKDF2_ITERATIONS = 100_000;

export interface PasswordHash {
  /** Соль, base64url. */
  salt: string;
  /** Хеш, base64url. */
  hash: string;
  iterations: number;
}

export function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Захешировать пароль с новой случайной солью. Сам пароль нигде не сохраняется. */
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { salt: toBase64Url(salt), hash: toBase64Url(hash), iterations: PBKDF2_ITERATIONS };
}

/** Сравнение за постоянное время: длительность не зависит от того, где различаются байты. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const hash = await pbkdf2(password, fromBase64Url(stored.salt), stored.iterations);
  return constantTimeEqual(hash, fromBase64Url(stored.hash));
}

/** Новый токен переподключения: 192 случайных бита. */
export function newToken(): string {
  return toBase64Url(randomBytes(24));
}

/** Хеш токена (SHA-256, hex): в хранилище лежит только он. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Случайный seed партии. */
export function newSeed(): string {
  return toBase64Url(randomBytes(12));
}
