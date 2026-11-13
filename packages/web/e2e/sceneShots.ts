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

/** Утро: каждый случай — в трёх моментах (личная часть, общая часть, сводка); режимы показа — для сцен ролей. */
const MORNING: Shot[] = [{ file: 'morning-wake', query: 'scene=nightReport&case=heal&t=0.55' }];
const CASES = ['death-shot', 'death-knife', 'death-truck', 'death-piano', 'death-brick', 'death-poison', 'death-explosion', 'heal', 'guard', 'bless', 'block', 'link', 'silenced', 'dossier', 'newspaper', 'footprints', 'quiet', 'hobo', 'many'];
const MOMENT: Record<string, [string, string, string]> = {
  'death-shot': ['t=2.25', 't=3.3', 'at=1'],
  'death-knife': ['t=2.1', 't=3.3', 'at=1'],
  'death-truck': ['t=2.0', 't=2.4', 'at=1'],
  'death-piano': ['t=1.95', 't=3.2', 'at=1'],
  'death-brick': ['t=1.95', 't=3.2', 'at=1'],
  'death-poison': ['t=2.4', 't=3.3', 'at=1'],
  'death-explosion': ['t=1.95', 't=2.3', 'at=1'],
};
for (const c of CASES) {
  const [a, b, end] = MOMENT[c] ?? ['t=2.7', 'at=0.8', 'at=1'];
  MORNING.push({ file: `morning-${c}-1`, query: `scene=nightReport&case=${c}&${a}` });
  MORNING.push({ file: `morning-${c}-2`, query: `scene=nightReport&case=${c}&${b}` });
  MORNING.push({ file: `morning-${c}-3-end`, query: `scene=nightReport&case=${c}&${end}` });
}
for (const display of ['open', 'cinema'] as const) {
  for (const c of ['heal', 'guard', 'block']) MORNING.push({ file: `morning-${c}-${display}`, query: `scene=nightReport&case=${c}&display=${display}&t=2.7` });
}
MORNING.push({ file: 'morning-death-shot-soft', query: 'scene=nightReport&case=death-shot&soft=1&t=3.3' });

for (const shot of [...DECK, ...MORNING]) {
  test(`сцена: ${shot.file}`, async ({ page }) => {
    await page.goto(`/dev/scenes?${shot.query}&ui=0&sound=0`);
    await expect(page.locator('body[data-scene-ready="1"]')).toBeAttached({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `${shot.file}.png`), scale: 'css' });
  });
}
