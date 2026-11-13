/**
 * Точка входа i18n. Сейчас язык один — русский; другой язык добавляется файлом того же типа
 * и выбором в `messages`.
 */
import type { RoleId } from '@mafia/engine';
import { type Messages, plural, ru } from './ru';

export const messages: Messages = ru;
export const t = messages;
export { plural };
export type { Messages };

export function roleName(role: RoleId): string {
  return t.roles[role].name;
}
