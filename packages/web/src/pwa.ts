/**
 * PWA: регистрация service worker (public/sw.js). Только в собранном клиенте и только в
 * защищённом контексте (https или localhost) — так требует браузер.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // без service worker игра работает, просто не офлайн-оболочкой
    });
  });
}
