// wrangler (dev и тесты) требует, чтобы каталог статики существовал. Если клиент ещё не собран,
// создаём пустой каталог с заглушкой: в разработке клиент всё равно открывают через Vite (:5173).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../packages/web/dist/', import.meta.url));
if (!existsSync(dist)) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    `${dist}index.html`,
    '<!doctype html><meta charset="utf-8"><title>Мафия</title><p>Клиент не собран: npm run build (или откройте Vite на :5173).</p>',
  );
}
