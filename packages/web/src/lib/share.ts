/**
 * «Поделиться ссылкой»: Web Share API, иначе копирование в буфер обмена.
 * По http в локальной сети (телефон открыл адрес компьютера) оба API браузер может не дать —
 * тогда работает старый способ через выделение текста.
 */
export type ShareResult = 'shared' | 'copied' | 'failed' | 'cancelled';

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export async function shareLink(data: { title: string; text: string; url: string }): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // не вышло — пробуем скопировать
    }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(data.url);
      return 'copied';
    } catch {
      // ниже — запасной способ
    }
  }
  return legacyCopy(data.url) ? 'copied' : 'failed';
}
