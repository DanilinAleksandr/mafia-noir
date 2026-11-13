/**
 * Частицы — чистая функция времени: положение каждой частицы вычисляется по времени таймлайна,
 * без накопленного состояния. Поэтому эффекты можно замедлять, останавливать и перематывать
 * вместе со сценой, а скриншоты воспроизводимы.
 */

export type ParticleShape = 'spark' | 'dot' | 'cross' | 'smoke' | 'shard' | 'heart' | 'star';

export interface Burst {
  /** Время начала (с) по таймлайну сцены. */
  at: number;
  /** Центр в долях холста (0…1). */
  x: number;
  y: number;
  count: number;
  colors: string[];
  shape: ParticleShape;
  /** Скорость разлёта, доли высоты холста в секунду. */
  speed: number;
  /** Разброс скорости 0…1. */
  jitter?: number;
  /** Направление (рад) и сектор разлёта; по умолчанию во все стороны. */
  angle?: number;
  spread?: number;
  /** Ускорение вниз, доли высоты в с². Отрицательное — вверх (дым). */
  gravity?: number;
  /** Сопротивление воздуха 0…1. */
  drag?: number;
  /** Жизнь частицы, с. */
  life: number;
  /** Размер, доли высоты холста. */
  size: number;
  seed?: number;
  /** Зациклить: частицы рождаются заново каждые `life` секунд (фоновая пыль). */
  loop?: boolean;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawShape(ctx: CanvasRenderingContext2D, shape: ParticleShape, size: number, vx: number, vy: number): void {
  switch (shape) {
    case 'spark': {
      // вытянутая искра по направлению движения
      const len = Math.max(size * 2, Math.hypot(vx, vy) * 0.035);
      const a = Math.atan2(vy, vx);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.quadraticCurveTo(0, -size * 0.45, len * 0.4, 0);
      ctx.quadraticCurveTo(0, size * 0.45, -len, 0);
      ctx.fill();
      return;
    }
    case 'dot':
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'smoke': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
      g.addColorStop(0, ctx.fillStyle as string);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'cross': {
      const w = size * 0.36;
      ctx.fillRect(-size, -w, size * 2, w * 2);
      ctx.fillRect(-w, -size, w * 2, size * 2);
      return;
    }
    case 'shard':
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.5, size * 0.3);
      ctx.lineTo(-size * 0.4, size * 0.8);
      ctx.closePath();
      ctx.fill();
      return;
    case 'heart': {
      const s = size;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s * 1.1, -s * 0.4, -s * 0.4, -s * 1.1, 0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.4, -s * 1.1, s * 1.1, -s * 0.4, 0, s * 0.35);
      ctx.fill();
      return;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? size : size * 0.28;
        const a = (i / 8) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
  }
}

/**
 * Нарисовать все вспышки на момент времени `time`. Возвращает, есть ли живые частицы
 * (чтобы не перерисовывать пустой холст).
 */
export function drawBursts(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bursts: readonly Burst[],
  time: number,
  density = 1,
): boolean {
  ctx.clearRect(0, 0, width, height);
  let alive = false;
  for (const [index, b] of bursts.entries()) {
    const dtBurst = time - b.at;
    if (dtBurst < 0 || (!b.loop && dtBurst > b.life * 1.6)) continue;
    const random = rng((b.seed ?? 7) * 7919 + index * 104729);
    const count = Math.max(1, Math.round(b.count * density));
    const ox = b.x * width;
    const oy = b.y * height;
    const drag = b.drag ?? 0.35;
    for (let i = 0; i < count; i++) {
      // у каждой частицы своё запаздывание, скорость, угол и жизнь — из зерна
      const delay = random() * 0.12 * b.life;
      const life = b.life * (0.6 + random() * 0.6);
      const angle = (b.angle ?? 0) + (b.spread === undefined ? random() * Math.PI * 2 : (random() - 0.5) * b.spread);
      const speed = b.speed * height * (1 - (b.jitter ?? 0.6) * random());
      const color = b.colors[Math.floor(random() * b.colors.length)] ?? '#fff';
      const sizeK = 0.5 + random();
      const spin = (random() - 0.5) * 8;
      // в цикле у каждой частицы своя фаза, чтобы пыль не «мигала» разом
      const dt = b.loop ? (dtBurst + random() * life) % life : dtBurst - delay;
      if (dt < 0 || dt > life) continue;
      alive = true;
      // путь с сопротивлением воздуха: x = v/k (1 − e^{−kt})
      const k = drag * 4 + 0.001;
      const travel = (1 - Math.exp(-k * dt)) / k;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const g = (b.gravity ?? 0) * height;
      const x = ox + vx * travel;
      const y = oy + vy * travel + 0.5 * g * dt * dt;
      const fade = b.loop ? Math.sin((Math.PI * dt) / life) : 1 - dt / life;
      const grow = b.shape === 'smoke' ? 1 + dt * 1.6 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, b.shape === 'smoke' ? fade * 0.55 : b.loop ? fade * 0.7 : fade * fade);
      ctx.fillStyle = color;
      ctx.translate(x, y);
      if (b.shape !== 'spark') ctx.rotate(spin * dt);
      drawShape(ctx, b.shape, b.size * height * sizeK * grow, vx * Math.exp(-k * dt), vy * Math.exp(-k * dt) + g * dt);
      ctx.restore();
    }
  }
  return alive;
}
