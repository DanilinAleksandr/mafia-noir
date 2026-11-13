/**
 * Полные партии через интерфейс: несколько «телефонов» (контекстов браузера) — игроки;
 * во второй партии к ним подсаживаются боты из `npm run bots`.
 */
import { expect, test } from '@playwright/test';
import { type Player, createRoom, joinByLink, newPlayer, playUntilEnd, startBots } from './helpers';

test('полная партия: пять телефонов от создания комнаты до финала и новой партии', async ({ browser }) => {
  const names = ['Аня', 'Борис', 'Вера', 'Гоша', 'Даша'];
  const players: Player[] = [];
  for (const name of names) players.push(await newPlayer(browser, name));
  const [host, ...guests] = players as [Player, ...Player[]];

  const code = await createRoom(host.page, host.name, 'тайна');
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  for (const guest of guests) await joinByLink(guest.page, code, guest.name, 'тайна');

  // все видят всех в лобби, в сети
  await expect(host.page.getByTestId('member')).toHaveCount(5);
  await expect(guests[0]!.page.getByText('Ждём, когда хост начнёт игру…')).toBeVisible();

  // хост включает «Кино» и таймер ночи — настройки видят все
  await host.page.getByRole('button', { name: 'Настройки игры' }).click();
  await host.page.getByRole('radio', { name: /Кино/ }).click();
  await host.page.getByRole('button', { name: 'Готово' }).click();
  await expect(guests[1]!.page.getByTestId('settings-summary')).toContainText('Кино');

  await host.page.getByRole('button', { name: 'Начать игру' }).click();
  // каждому — его карточка роли
  for (const p of players) await expect(p.page.getByTestId('role-reveal')).toBeVisible();

  // обновление страницы посреди партии — переподключение по токену
  await guests[2]!.page.reload();
  await expect(guests[2]!.page.locator('[data-stage]')).toBeVisible();

  await playUntilEnd(
    players.map((p) => p.page),
    host.page,
  );

  for (const p of players) {
    await expect(p.page.getByTestId('final')).toBeVisible();
    // в финале открыты все роли
    await expect(p.page.getByTestId('final').getByTestId('card-face')).toHaveCount(5);
  }

  // «Сыграть ещё раз» — все возвращаются в лобби
  await host.page.getByTestId('play-again').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(code);
  for (const p of players) await p.context.close();
});

test('ведущий, живой игрок и боты из npm run bots', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ведущий');
  const human = await newPlayer(browser, 'Игрок');
  const code = await createRoom(host.page, host.name, '1234', true);
  await joinByLink(human.page, code, human.name, '1234');

  const bots = startBots(code, '1234', 5);
  try {
    await expect(host.page.getByTestId('member')).toHaveCount(7, { timeout: 60_000 });
    await host.page.getByRole('button', { name: 'Начать игру' }).click();
    await expect(host.page.getByTestId('narrator')).toBeVisible();

    // ведущий видит все роли
    await expect(host.page.getByTestId('player-row').getByText(/Мафия|Дон|Шантажист|Адвокат|Консильери/).first()).toBeVisible();

    await playUntilEnd([human.page, host.page], host.page);
    await expect(human.page.getByTestId('final')).toBeVisible();
  } finally {
    bots.stop();
  }
  await host.context.close();
  await human.context.close();
});
