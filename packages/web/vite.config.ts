/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Клиент ходит к серверу по относительному адресу `/api/…`. В разработке Vite проксирует его
 * (вместе с WebSocket) на локальный `wrangler dev`. Так телефону в той же Wi-Fi сети достаточно
 * открыть адрес Vite — до сервера на 127.0.0.1 доберётся сам Vite.
 *
 * Переменные окружения:
 *   VITE_SERVER_URL   адрес сервера для собранного клиента (по умолчанию — тот же источник);
 *   MAFIA_DEV_SERVER  куда проксировать `/api` в разработке (по умолчанию http://127.0.0.1:8787).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.MAFIA_DEV_SERVER || 'http://127.0.0.1:8787';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target, ws: true, changeOrigin: true } },
    },
    preview: {
      host: true,
      port: 4173,
      proxy: { '/api': { target, ws: true, changeOrigin: true } },
    },
    // React + Framer Motion — около 160 КБ в gzip одним файлом; для игры по ссылке это приемлемо
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 700 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
