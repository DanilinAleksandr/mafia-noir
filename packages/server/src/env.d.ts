// Типы привязок для тестов (`env` из `cloudflare:test`).
declare namespace Cloudflare {
  interface Env {
    ROOM: DurableObjectNamespace<import('./room').Room>;
  }
}
