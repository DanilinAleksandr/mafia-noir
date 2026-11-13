/**
 * Скриншоты сцен со страницы /dev/scenes: начало, середина и конец каждой сцены → docs/scene-shots/.
 *
 *   npm run scene-shots        (из корня; поднимет Vite сам)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT } from './helpers';

const OUT = join(ROOT, 'docs', 'scene-shots');
mkdirSync(OUT, { recursive: true });

interface Shot {
  file: string;
  query: string;
}

/** Ключевые моменты сцен (секунды таймлайна). */
const DECK: Shot[] = [];
for (const role of ['civilian', 'mafia', 'maniac', 'doctor'] as const) {
  DECK.push({ file: `deck-${role}-1-start`, query: `scene=roleReveal&role=${role}&t=1.0` });
  DECK.push({ file: `deck-${role}-2-flight`, query: `scene=roleReveal&role=${role}&t=1.6` });
  DECK.push({ file: `deck-${role}-3-flash`, query: `scene=roleReveal&role=${role}&t=2.5` });
  DECK.push({ file: `deck-${role}-4-end`, query: `scene=roleReveal&role=${role}&at=1` });
}
DECK.push({ file: 'deck-reduced-end', query: 'scene=roleReveal&role=detective&reduce=1&at=1' });

for (const shot of DECK) {
  test(`сцена: ${shot.file}`, async ({ page }) => {
    await page.goto(`/dev/scenes?${shot.query}&ui=0&sound=0`);
    await expect(page.locator('body[data-scene-ready="1"]')).toBeAttached({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `${shot.file}.png`), scale: 'css' });
  });
}
