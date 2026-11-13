/**
 * Личные настройки устройства: звук, вибрация, уменьшение анимации, мягкие эффекты.
 */
import { setPrefs, usePrefs, weakDevice } from '../settings/prefs';
import { Sheet, Toggle } from './ui';

export function PrefsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  return (
    <Sheet open={open} onClose={onClose} title="Эффекты и звук">
      <div className="divide-y divide-white/6 pb-2">
        <Toggle checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} label="Звук" description="Звуки сцен: карты, выстрелы, печати." />
        <Toggle checked={prefs.vibration} onChange={(vibration) => setPrefs({ vibration })} label="Вибрация" description="Отклик на ключевых моментах и о новых записях в блокноте." />
        <Toggle
          checked={prefs.reduceMotion}
          onChange={(reduceMotion) => setPrefs({ reduceMotion })}
          label="Уменьшить анимацию"
          description="Короткие простые переходы вместо полных сцен."
        />
        <Toggle
          checked={prefs.softEffects}
          onChange={(softEffects) => setPrefs({ softEffects })}
          label="Мягкие эффекты"
          description="Без крови: вместо неё чернила, дым и ткань."
        />
      </div>
      {weakDevice() ? <p className="pb-3 text-xs text-muted">На этом устройстве эффекты автоматически облегчены.</p> : null}
    </Sheet>
  );
}
