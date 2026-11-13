/**
 * Скриншоты основных экранов в размере телефона (Pixel 7) → docs/screens/.
 * Партия идёт по сценарию: состав задан вручную, каждый узнаёт свою роль удержанием карточки,
 * дальше ходы выбираются по ролям — так в кадр попадают решение Охотника, проверка Комиссара,
 * сцена «Кино», приговор и финал.
 *
 *   npm run screens        (из корня; серверы поднимутся сами)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { ROOT, type Player, createRoom, joinByLink, newPlayer, startBots, takeRole } from './helpers';

const OUT = join(ROOT, 'docs', 'screens');
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string, options: { top?: boolean } = {}): Promise<void> {
  if (options.top) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700); // анимации появления
  await page.screenshot({ path: join(OUT, `${name}.png`), scale: 'css' });
}

async function pick(page: Page, scopeText: RegExp | null, target: string, button: RegExp): Promise<void> {
  const scope = scopeText ? page.locator('section.panel').filter({ hasText: scopeText }) : page.locator('section.panel').filter({ has: page.getByRole('listbox') }).first();
  await scope.getByRole('option', { name: target, exact: true }).click();
  await scope.getByRole('button', { name: button }).click();
  // после ночного хода у всех открывается «Блокнот» — закрываем
  const dialog = page.getByRole('dialog');
  if (await dialog.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined);
  }
}

async function ready(page: Page): Promise<void> {
  const scene = page.locator('[data-scene="morning"]');
  if (await scene.isVisible().catch(() => false)) await scene.click({ position: { x: 20, y: 60 } }).catch(() => undefined);
  await page.getByTestId('report-ready').click();
}

test('скриншоты экранов', async ({ browser }) => {
  test.setTimeout(300_000);
  const names = ['Аня', 'Борис', 'Вера', 'Гоша', 'Даша', 'Егор'];
  const players: Player[] = [];
  for (const name of names) players.push(await newPlayer(browser, name));
  const host = players[0]!;

  // главная, создание, вход по ссылке
  await host.page.goto('/');
  await shot(host.page, '01-home');
  await host.page.getByRole('button', { name: 'Создать комнату' }).click();
  await host.page.getByLabel('Ваше имя').fill('Аня');
  await host.page.getByLabel('Пароль комнаты').fill('тайна');
  await shot(host.page, '02-create');
  const code = await createRoom(host.page, 'Аня', 'тайна');
  await players[1]!.page.goto(`/r/${code}`);
  await players[1]!.page.getByLabel('Ваше имя').fill('Борис');
  await shot(players[1]!.page, '03-join-link');
  for (const p of players.slice(1)) await joinByLink(p.page, code, p.name, 'тайна');

  // настройки: «Кино» и ручной состав с Охотником
  await host.page.getByRole('button', { name: 'Настройки игры' }).click();
  await host.page.getByRole('radio', { name: /Кино/ }).click();
  await host.page.getByRole('button', { name: 'Городская' }).click();
  await shot(host.page, '05-settings');
  await host.page.getByRole('switch', { name: 'Задать состав вручную' }).click();
  const manual = async (role: string, n: number) => {
    for (let i = 0; i < n; i++) await host.page.getByRole('button', { name: `Ручной состав: ${role}: больше` }).click();
  };
  // по умолчанию: Комиссар, Доктор, 1 Мафия, Мирные — добавим Дона и Охотника вместо двух Мирных
  await host.page.getByRole('button', { name: 'Ручной состав: Мирный житель: меньше' }).click();
  await host.page.getByRole('button', { name: 'Ручной состав: Мирный житель: меньше' }).click();
  await manual('Дон', 1);
  await manual('Охотник', 1);
  await host.page.getByRole('button', { name: 'Готово' }).click();
  await expect(host.page.getByTestId('start-issues')).toHaveCount(0);
  await shot(host.page, '04-lobby-host', { top: true });
  await shot(players[2]!.page, '04b-lobby-guest', { top: true });
  await host.page.getByRole('button', { name: 'Справочник ролей' }).click().catch(async () => {
    await host.page.getByRole('button', { name: 'Справочник ролей' }).first().click();
  });
  await shot(host.page, '06-roles');
  await host.page.keyboard.press('Escape');

  await host.page.getByRole('button', { name: 'Начать игру' }).click();
  for (const p of players) await expect(p.page.getByTestId('role-reveal')).toBeVisible();
  await shot(host.page, '07-role-hidden');

  // роли по удержанию карточки
  const roleOf = new Map<string, Player>();
  for (const p of players) roleOf.set(await takeRole(p.page), p);
  const by = (role: string) => {
    const p = roleOf.get(role);
    if (!p) throw new Error(`Нет роли ${role}: ${[...roleOf.keys()].join(', ')}`);
    return p;
  };
  const mafia = by('Мафия');
  const don = by('Дон');
  const comm = by('Комиссар');
  const doctor = by('Доктор');
  const hunter = by('Охотник');
  const civ = by('Мирный житель');

  // кадр с открытой картой мафии (сообщник виден внизу)
  await shot(mafia.page, '08-role-mafia');
  for (const p of players) await p.page.getByTestId('role-ok').click();
  for (const p of players) await expect(p.page.locator('[data-scene="deck"]')).toHaveCount(0);

  // ── ночь 1 ──
  await shot(civ.page, '09-night-civilian');
  await pick(comm.page, null, don.name, /Сделать ход/);
  await pick(doctor.page, null, comm.name, /Сделать ход/);
  await pick(civ.page, null, mafia.name, /Сделать ход/);
  await pick(hunter.page, null, don.name, /Сделать ход/);
  await mafia.page.getByRole('button', { name: 'Блокнот' }).click();
  await mafia.page.getByLabel('Написать…').fill(`Берём ${hunter.name}?`);
  await mafia.page.getByRole('button', { name: 'Отправить' }).click();
  await don.page.getByRole('button', { name: 'Блокнот' }).click();
  await don.page.getByLabel('Написать…').fill('Согласен. Тихо.');
  await don.page.getByRole('button', { name: 'Отправить' }).click();
  await shot(don.page, '11-notebook-mafia');
  // у мирного та же кнопка и тот же вид — только это личные заметки
  await civ.page.getByRole('button', { name: 'Блокнот' }).click();
  await civ.page.getByLabel('Написать…').fill(`${mafia.name} слишком спокоен`);
  await civ.page.getByRole('button', { name: 'Отправить' }).click();
  await shot(civ.page, '11b-notebook-civilian');
  await civ.page.keyboard.press('Escape');
  await don.page.keyboard.press('Escape');
  await mafia.page.keyboard.press('Escape');
  await pick(mafia.page, null, hunter.name, /Сделать ход/);
  await shot(don.page, '10-night-mafia');
  await shot(comm.page, '12-night-done');
  await pick(don.page, null, hunter.name, /Сделать ход/);

  // Охотник убит — решение только у него, остальные ждут
  await expect(hunter.page.getByTestId('decision')).toBeVisible();
  await shot(hunter.page, '13-decision-hunter');
  await shot(civ.page, '14-decision-waiting');
  await hunter.page.getByRole('button', { name: 'Не стрелять' }).click();

  // утро: итоги ночи, личная карточка Комиссара (проверка + сцена «Кино»)
  for (const p of players) await expect(p.page.getByTestId('night-report')).toBeVisible();
  await comm.page.waitForTimeout(2600);
  await shot(comm.page, '15a-morning-scene');
  await comm.page.locator('[data-scene="morning"]').click({ position: { x: 20, y: 60 } });
  await comm.page.getByTestId('private-card').click();
  await shot(comm.page, '15-morning-private');
  await shot(civ.page, '15b-morning');
  for (const p of players) await ready(p.page);

  // день: обсуждение и голосование
  await expect(host.page.locator('[data-stage="discussion"]')).toBeVisible();
  await shot(host.page, '16-discussion');
  await host.page.getByTestId('start-vote').click();
  await expect(civ.page.locator('[data-stage="day"]')).toBeVisible();
  for (const p of [comm, doctor, civ, mafia]) {
    await pick(p.page, null, p === mafia ? civ.name : don.name, /Проголосовать/);
  }
  await shot(don.page, '17-vote');
  await pick(don.page, null, civ.name, /Проголосовать/);

  // вечер: приговор
  for (const p of players) await expect(p.page.getByTestId('verdict')).toBeVisible();
  await shot(civ.page, '18-evening-verdict');
  for (const p of players) await ready(p.page);

  // ночь 2: выбывший Охотник — зритель
  await expect(hunter.page.getByTestId('spectator')).toBeVisible();
  await shot(hunter.page, '19-spectator');
  await pick(comm.page, null, mafia.name, /Сделать ход/);
  await pick(doctor.page, null, civ.name, /Сделать ход/);
  await pick(civ.page, null, mafia.name, /Сделать ход/);
  await pick(mafia.page, null, comm.name, /Сделать ход/);
  for (const p of players) await expect(p.page.getByTestId('night-report')).toBeVisible();
  for (const p of players) await ready(p.page);

  // день 2: город казнит мафию — финал
  await host.page.getByTestId('start-vote').click();
  const voters = [comm, doctor, civ, mafia].filter((p) => p.page.url() && true);
  for (const p of voters) {
    const alive = await p.page.getByTestId('spectator').count();
    if (alive) continue;
    await pick(p.page, null, p === mafia ? civ.name : mafia.name, /Проголосовать/).catch(() => undefined);
  }
  // партия кончилась казнью: сначала приговор последнего дня, затем финал
  for (const p of players) await expect(p.page.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
  for (const p of players) await ready(p.page);
  for (const p of players) await expect(p.page.getByTestId('finale')).toBeVisible();
  await shot(civ.page, '20-finale');
  for (const p of players) await p.page.getByTestId('finale-ok').click();
  await shot(host.page, '21-final');
  for (const p of players) await p.context.close();

  // ведущий с ботами: «закулисье»
  const narrator = await newPlayer(browser, 'Ведущий');
  const narratorCode = await createRoom(narrator.page, 'Ведущий', '1234', true);
  const bots = startBots(narratorCode, '1234', 7);
  try {
    await expect(narrator.page.getByTestId('member')).toHaveCount(8, { timeout: 60_000 });
    await narrator.page.getByRole('button', { name: 'Начать игру' }).click();
    await expect(narrator.page.getByTestId('narrator')).toBeVisible();
    await narrator.page.waitForTimeout(4000);
    await shot(narrator.page, '22-narrator');
  } finally {
    bots.stop();
  }
  await narrator.context.close();
});
