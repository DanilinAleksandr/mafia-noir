/**
 * Главный таймлайн сцены: создаётся в gsap.context (всё убирается при размонтировании)
 * и регистрируется в часах сцен (пропуск, страница разработки, скриншоты).
 */
import { gsap } from 'gsap';
import { type RefObject, useLayoutEffect, useRef } from 'react';
import { sceneClock } from './clock';

// пустые выборки — нормально (например, напарников у мирного нет)
gsap.config({ nullTargetWarn: false });

export function useSceneTimeline(
  scope: RefObject<HTMLElement | null>,
  build: (tl: gsap.core.Timeline) => { skip?: () => void } | void,
  deps: readonly unknown[] = [],
): RefObject<gsap.core.Timeline | null> {
  const ref = useRef<gsap.core.Timeline | null>(null);
  useLayoutEffect(() => {
    let unregister = () => {};
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      ref.current = tl;
      const extra = build(tl) ?? {};
      unregister = sceneClock.register({ timeline: tl, skip: extra.skip });
    }, scope.current ?? undefined);
    return () => {
      unregister();
      ctx.revert();
      ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
