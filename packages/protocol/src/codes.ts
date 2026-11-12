/**
 * Коды комнат: короткие, без символов, которые легко перепутать (0 и O, 1, I и L).
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

const VALID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{5,6}$`);

/**
 * Привести введённый код к каноническому виду (верхний регистр, без пробелов и дефисов).
 * Возвращает null, если это не код комнаты.
 */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  return VALID.test(code) ? code : null;
}

/**
 * Сгенерировать код комнаты из случайных байтов (по одному на символ).
 * Байты, не попадающие в ровный диапазон, отбрасываются, чтобы символы были равновероятны.
 */
export function roomCodeFromBytes(bytes: Uint8Array, length: number = ROOM_CODE_LENGTH): string | null {
  const size = ROOM_CODE_ALPHABET.length;
  const limit = 256 - (256 % size);
  let code = '';
  for (const byte of bytes) {
    if (byte >= limit) continue;
    code += ROOM_CODE_ALPHABET[byte % size];
    if (code.length === length) return code;
  }
  return null;
}

/** Сгенерировать код комнаты, используя переданный источник случайных байтов. */
export function generateRoomCode(randomBytes: (count: number) => Uint8Array, length: number = ROOM_CODE_LENGTH): string {
  for (;;) {
    const code = roomCodeFromBytes(randomBytes(length * 3), length);
    if (code) return code;
  }
}
