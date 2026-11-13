/**
 * «Привратник» — один Durable Object на весь сервис. Ограничивает создание комнат:
 * с одного адреса и всего. Счётчики — в хранилище объекта (фиксированные окна), поэтому
 * переживают выселение объекта из памяти. Одна запись на одну созданную комнату.
 *
 * Встроенный rate-limit Cloudflare сюда не подходит: он считает окнами 10 или 60 секунд
 * и отдельно в каждой локации, а нужны часы и сутки на всех вместе.
 */
import { DurableObject } from 'cloudflare:workers';
import { LIMITS_SERVER } from './state';

interface Window {
  start: number;
  count: number;
}

export interface GateVerdict {
  ok: boolean;
  /** Через сколько секунд можно попробовать снова. */
  retryAfter: number;
}

/** Окна и пределы: [ключ, длительность окна, предел]. */
function windows(ip: string | null): [string, number, number][] {
  const list: [string, number, number][] = [
    ['all:hour', 60 * 60_000, LIMITS_SERVER.roomsPerHour],
    ['all:day', 24 * 60 * 60_000, LIMITS_SERVER.roomsPerDay],
  ];
  if (ip) {
    list.push([`ip:${ip}:10m`, 10 * 60_000, LIMITS_SERVER.roomsPerIpPer10Min]);
    list.push([`ip:${ip}:day`, 24 * 60 * 60_000, LIMITS_SERVER.roomsPerIpPerDay]);
  }
  return list;
}

export class Gate extends DurableObject {
  /** Сдвиг часов для тестов. */
  skewMs = 0;

  /**
   * Можно ли создать ещё одну комнату. Если да — сразу засчитывает её.
   * @param ip адрес клиента; null — запрос не из интернета (локальная разработка, тесты):
   *           тогда действуют только общие пределы.
   */
  async allowRoom(ip: string | null): Promise<GateVerdict> {
    const now = Date.now() + this.skewMs;
    const plan = windows(ip);
    const stored = await this.ctx.storage.get<Window>(plan.map(([key]) => key));
    const next = new Map<string, Window>();
    let retryAfter = 0;
    for (const [key, length, limit] of plan) {
      const current = stored.get(key);
      const window = current && now - current.start < length ? current : { start: now, count: 0 };
      if (window.count >= limit) retryAfter = Math.max(retryAfter, Math.ceil((window.start + length - now) / 1000));
      next.set(key, window);
    }
    if (retryAfter > 0) return { ok: false, retryAfter };
    const update: Record<string, Window> = {};
    for (const [key, window] of next) update[key] = { start: window.start, count: window.count + 1 };
    await this.ctx.storage.put(update);
    // старые адреса со временем не нужны — будильник через сутки чистит всё
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60_000);
    return { ok: true, retryAfter: 0 };
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
