/**
 * Помощники e2e: создать комнату, войти, «сыграть ход» за вкладку-игрока, запустить ботов.
 * Вкладка действует только через интерфейс — как живой игрок.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, type Page, devices, expect } from '@playwright/test';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const SERVER = 'http://127.0.0.1:8787';

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** Отдельный контекст браузера — отдельный «телефон» со своим хранилищем. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ru-RU', baseURL: 'http://127.0.0.1:5173' });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw new Error(`Ошибка на странице ${name}: ${error.message}`);
  });
  return { name, context, page };
}

export async function createRoom(page: Page, name: string, password: string, narrator = false): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Пароль комнаты').fill(password);
  if (narrator) await page.getByRole('radio', { name: 'Ведущий' }).click();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const code = page.getByTestId('room-code');
  await expect(code).toBeVisible();
  return (await code.textContent())?.trim() ?? '';
}

export async function joinByLink(page: Page, code: string, name: string, password: string): Promise<void> {
  await page.goto(`/r/${code}`);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Пароль комнаты').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function clickIfVisible(page: Page, selector: string): Promise<boolean> {
  const target = page.locator(selector).first();
  if (!(await target.isVisible().catch(() => false))) return false;
  await target.click({ timeout: 3000 }).catch(() => undefined);
  return true;
}

/** Выбрать в сетке первых доступных игроков и нажать главную кнопку панели. */
async function playPicker(scope: ReturnType<Page['locator']>, mainButton: RegExp): Promise<boolean> {
  try {
    return await playPickerUnsafe(scope, mainButton);
  } catch {
    // экран сменился посреди хода (пришёл новый снимок) — попробуем на следующем круге
    return false;
  }
}

async function playPickerUnsafe(scope: ReturnType<Page['locator']>, mainButton: RegExp): Promise<boolean> {
  const options = scope.locator('[role="option"][aria-disabled="false"]');
  const count = await options.count();
  const main = scope.getByRole('button', { name: mainButton });
  if (count === 0) {
    // выбрать некого — пропуск / воздержаться
    const skip = scope.getByRole('button', { name: /Пропустить|Воздержаться|Не стрелять/ });
    if (await skip.count()) {
      await skip.first().click({ timeout: 3000 });
      return true;
    }
    return false;
  }
  // случайная цель, чтобы партии отличались; двухцелевые способности — две цели
  const first = Math.floor(Math.random() * count);
  await options.nth(first).click({ timeout: 3000 });
  if ((await main.count()) === 0) return false;
  if (await main.isDisabled({ timeout: 2000 })) await options.nth((first + 1) % count).click({ timeout: 3000 });
  if (await main.isDisabled({ timeout: 2000 })) return false;
  await main.click({ timeout: 3000 });
  return true;
}

export type StepResult = 'acted' | 'idle' | 'final';

/**
 * Сцена «Колода»: тапы ведут её дальше (к колоде, взять карту, к концу), потом «Спрятать».
 * Возвращает название роли (из открытой карты).
 */
export async function takeRole(page: Page): Promise<string> {
  const scene = page.locator('[data-scene="deck"]');
  await expect(scene).toBeVisible();
  const ok = page.getByTestId('role-ok');
  for (let i = 0; i < 8 && !(await ok.isVisible()); i++) {
    await scene.click({ position: { x: 30, y: 120 } });
    await page.waitForTimeout(250);
  }
  await expect(ok).toBeVisible();
  return (await page.getByTestId('revealed-role').getAttribute('aria-label')) ?? '';
}

/** Один ход вкладки-игрока: досмотреть сцену, сходить ночью, проголосовать, решить. */
export async function playStep(page: Page, options: { host?: boolean } = {}): Promise<StepResult> {
  if (await clickIfVisible(page, '[data-testid="role-ok"]')) return 'acted';
  if (await visible(page, '[data-scene="deck"]')) {
    // тап по сцене: к колоде → взять карту → к концу
    await page.locator('[data-scene="deck"]').click({ position: { x: 30, y: 120 }, timeout: 3000 }).catch(() => undefined);
    return 'acted';
  }
  if (await clickIfVisible(page, '[data-testid="report-ready"]')) return 'acted';
  if (await clickIfVisible(page, '[data-testid="finale-ok"]')) return 'acted';
  if (await visible(page, '[data-testid="final"]')) return 'final';
  if (await visible(page, '[role="dialog"]')) {
    await page.keyboard.press('Escape');
    return 'acted';
  }

  const narrator = await visible(page, '[data-testid="narrator"]');
  const staged = page.locator('[data-stage]');
  const stage = (await staged.count()) > 0 ? await staged.first().getAttribute('data-stage', { timeout: 2000 }).catch(() => null) : null;
  if (narrator) {
    const stageText = await page.locator('header').first().textContent();
    if (stageText?.includes('Обсуждение')) return (await clickIfVisible(page, '[data-testid="narrator-advance"]')) ? 'acted' : 'idle';
    return 'idle';
  }

  if (stage === 'night' || stage === 'day') {
    const panel = page.locator('section.panel').filter({ has: page.getByRole('listbox') }).first();
    if (await panel.isVisible().catch(() => false)) {
      return (await playPicker(panel, /Сделать ход|Проголосовать/)) ? 'acted' : 'idle';
    }
    return 'idle';
  }
  if (stage === 'decision') {
    const decision = page.getByTestId('decision');
    if (!(await decision.isVisible().catch(() => false))) return 'idle';
    const judge = decision.getByRole('button', { name: 'Пусть свершится' });
    if (await judge.count()) {
      await judge.click();
      return 'acted';
    }
    return (await playPicker(decision, /Выстрелить|Взорвать/)) ? 'acted' : 'idle';
  }
  if (stage === 'discussion' && options.host) {
    return (await clickIfVisible(page, '[data-testid="start-vote"]')) ? 'acted' : 'idle';
  }
  return 'idle';
}

/** Играть, пока у всех вкладок не будет финала. */
export async function playUntilEnd(pages: Page[], hostPage: Page, limitMs = 200_000): Promise<void> {
  const started = Date.now();
  let idleRounds = 0;
  for (;;) {
    let acted = false;
    let finals = 0;
    for (const page of pages) {
      const result = await playStep(page, { host: page === hostPage });
      if (result === 'acted') acted = true;
      if (result === 'final') finals++;
    }
    if (finals === pages.length) return;
    if (Date.now() - started > limitMs) {
      const dump: string[] = [];
      for (const [i, page] of pages.entries()) {
        await page.screenshot({ path: `test-results/stuck-${i}.png` }).catch(() => undefined);
        const deck = await page
          .evaluate(() => {
            const el = document.querySelector('[data-scene="deck"]');
            if (!el) return 'нет колоды';
            const cs = getComputedStyle(el);
            return `колода: visibility=${cs.visibility} opacity=${cs.opacity} parentOpacity=${getComputedStyle(el.parentElement!.parentElement!).opacity}`;
          })
          .catch(() => '?');
        dump.push(`${deck}
${(await page.locator('body').innerText().catch(() => '')).slice(0, 800)}`);
      }
      throw new Error(`Партия не закончилась вовремя. Экраны:\n${dump.join('\n──────\n')}`);
    }
    idleRounds = acted ? 0 : idleRounds + 1;
    await pages[0]!.waitForTimeout(acted ? 150 : 400);
    if (idleRounds === 25) {
      // все ждут — например, решения игрока, который вышел: хост жмёт «дальше»
      await hostAdvance(hostPage);
      idleRounds = 0;
    }
  }
}

export async function hostAdvance(page: Page): Promise<void> {
  if (await clickIfVisible(page, '[data-testid="narrator-advance"]')) return;
  const menu = page.getByRole('button', { name: 'Хост' });
  if (!(await menu.isVisible().catch(() => false))) return;
  await menu.click();
  const dialog = page.getByRole('dialog');
  const advance = dialog.getByRole('button').filter({ hasNotText: /лобби|Закрыть/ }).first();
  if (await advance.isVisible().catch(() => false)) await advance.click();
  else await page.keyboard.press('Escape');
}

/** Боты из `npm run bots` подсаживаются в комнату. */
export function startBots(code: string, password: string, count: number): { stop: () => void; output: () => string } {
  let log = '';
  const child: ChildProcess = spawn(
    'npm',
    ['run', 'bots', '--', '--url', SERVER, '--join', code, '--password', password, '--count', String(count), '--quiet'],
    { cwd: ROOT, shell: true, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' } },
  );
  child.stdout?.on('data', (chunk) => (log += String(chunk)));
  child.stderr?.on('data', (chunk) => (log += String(chunk)));
  return {
    stop: () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill();
    },
    output: () => log,
  };
}
