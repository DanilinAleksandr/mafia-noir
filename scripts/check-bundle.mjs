// Проверка боевой сборки: Worker собирается так же, как при деплое (без загрузки), и в нём нет
// отладочной страницы; в собранном клиенте (packages/web/dist) нет витрины сцен /dev/scenes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../packages/server/', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'mafia-bundle-'));
try {
  execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', out], { cwd: server, stdio: 'inherit', shell: true });
  const files = readdirSync(out, { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  const text = files.map((f) => readFileSync(join(out, f), 'utf8')).join('\n');
  // строки, которые есть только в отладочной странице
  const markers = ['Изменение настроек (JSON)', 'data-act="settings"'];
  const found = markers.filter((m) => text.includes(m));
  if (files.length === 0) throw new Error('Бандл не собран');
  if (found.length > 0) throw new Error(`В боевом бандле осталась отладочная страница: ${found.join(', ')}`);
  console.log(`Бандл Worker в порядке: ${files.length} файл(ов), ${Math.round(text.length / 1024)} КБ, отладочной страницы нет.`);

  // собранный клиент: витрины сцен /dev/scenes в нём быть не должно
  const dist = fileURLToPath(new URL('../packages/web/dist/assets/', import.meta.url));
  const client = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
  if (!client) throw new Error('Клиент не собран: сначала npm run build');
  const labMarkers = ['Несколько погибших', 'ScenesLab', 'Положение в сцене'];
  const leaked = labMarkers.filter((m) => client.includes(m));
  if (leaked.length > 0) throw new Error(`В собранном клиенте осталась витрина сцен: ${leaked.join(', ')}`);
  console.log('Клиент в порядке: витрины сцен нет.');
} finally {
  rmSync(out, { recursive: true, force: true });
}
