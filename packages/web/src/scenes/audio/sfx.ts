/**
 * Звуки сцен. Своих аудиофайлов нет: каждый звук синтезируется один раз через Web Audio
 * (OfflineAudioContext), кодируется в WAV и проигрывается через Howler. Так нет лицензионных
 * вопросов и лишних загрузок. Модуль грузится вместе со сценами (лениво).
 *
 * TODO(этап 5): заменить синтез записанными звуками (свои записи или CC0) — тот же интерфейс.
 */
import { Howl, Howler } from 'howler';
import { getPrefs } from '../../settings/prefs';

const RATE = 22050;

type Synth = (ctx: OfflineAudioContext) => void;

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buffer;
}

function envelope(param: AudioParam, at: number, attack: number, peak: number, release: number): void {
  param.setValueAtTime(0.0001, at);
  param.exponentialRampToValueAtTime(peak, at + attack);
  param.exponentialRampToValueAtTime(0.0001, at + attack + release);
}

function tone(ctx: OfflineAudioContext, type: OscillatorType, freq: number, at: number, attack: number, peak: number, release: number, endFreq?: number): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + attack + release);
  const gain = ctx.createGain();
  envelope(gain.gain, at, attack, peak, release);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + attack + release + 0.05);
}

function noise(
  ctx: OfflineAudioContext,
  at: number,
  duration: number,
  filter: BiquadFilterType,
  from: number,
  to: number,
  peak: number,
  attack = 0.01,
  q = 1,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, duration + 0.1);
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(from, at);
  bq.frequency.exponentialRampToValueAtTime(to, at + duration);
  const gain = ctx.createGain();
  envelope(gain.gain, at, attack, peak, Math.max(0.02, duration - attack));
  src.connect(bq).connect(gain).connect(ctx.destination);
  src.start(at);
  src.stop(at + duration + 0.05);
}

const SYNTHS = {
  /** Короткий щелчок интерфейса. */
  tap: { seconds: 0.08, synth: (c) => tone(c, 'sine', 1400, 0, 0.002, 0.25, 0.05, 900) },
  /** Карта срывается с колоды. */
  deal: { seconds: 0.3, synth: (c) => noise(c, 0, 0.22, 'lowpass', 2600, 700, 0.5, 0.005) },
  /** Полёт по дуге. */
  whoosh: { seconds: 0.6, synth: (c) => noise(c, 0, 0.5, 'bandpass', 350, 2600, 0.7, 0.18, 1.4) },
  /** Обратный полёт в колоду. */
  hide: { seconds: 0.55, synth: (c) => noise(c, 0, 0.45, 'bandpass', 2400, 380, 0.55, 0.06, 1.4) },
  /** Переворот карты: шлепок и низкий удар. */
  flip: {
    seconds: 0.3,
    synth: (c) => {
      noise(c, 0, 0.07, 'highpass', 3000, 1800, 0.6, 0.002);
      tone(c, 'sine', 140, 0, 0.004, 0.55, 0.18, 70);
    },
  },
  /** Раскрытие роли: звон с искрами. */
  reveal: {
    seconds: 1.8,
    synth: (c) => {
      [523.25, 783.99, 1046.5, 1567.98, 2093].forEach((f, i) => tone(c, 'sine', f, 0.02 * i, 0.01, 0.22 / (1 + i * 0.4), 1.4 - i * 0.15));
      tone(c, 'triangle', 261.63, 0, 0.02, 0.18, 1.2);
      noise(c, 0.02, 0.9, 'highpass', 6000, 9000, 0.12, 0.05);
    },
  },
  /** Тихий тик буквы. */
  tick: { seconds: 0.05, synth: (c) => tone(c, 'square', 2200, 0, 0.001, 0.05, 0.025) },
} satisfies Record<string, { seconds: number; synth: Synth }>;

export type SoundId = keyof typeof SYNTHS;

const cache = new Map<SoundId, Promise<Howl | null>>();

function encodeWav(buffer: AudioBuffer): Blob {
  const data = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i] as number));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

function load(id: SoundId): Promise<Howl | null> {
  let promise = cache.get(id);
  if (promise) return promise;
  promise = (async () => {
    if (typeof OfflineAudioContext === 'undefined') return null;
    const def = SYNTHS[id];
    const ctx = new OfflineAudioContext(1, Math.ceil(def.seconds * RATE), RATE);
    def.synth(ctx);
    const rendered = await ctx.startRendering();
    const url = URL.createObjectURL(encodeWav(rendered));
    return new Howl({ src: [url], format: ['wav'], volume: 0.8 });
  })().catch(() => null);
  cache.set(id, promise);
  return promise;
}

export const sfx = {
  /** Подготовить звуки заранее (при появлении сцены), чтобы первый звук не запаздывал. */
  preload(ids: SoundId[]): void {
    if (!getPrefs().sound) return;
    for (const id of ids) void load(id);
  },
  play(id: SoundId, options: { rate?: number; volume?: number } = {}): void {
    if (!getPrefs().sound) return;
    void load(id).then((howl) => {
      if (!howl) return;
      const sound = howl.play();
      if (options.rate) howl.rate(options.rate, sound);
      if (options.volume !== undefined) howl.volume(options.volume, sound);
    });
  },
  mute(muted: boolean): void {
    Howler.mute(muted);
  },
};
