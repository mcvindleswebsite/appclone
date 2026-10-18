"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import styles from "./ipod.module.css";

/** Matches the `showcaseSpin` keyframes in ipod.module.css. */
const SPIN_DURATION_MS = 3000;
/** The backdrop starts fading back as the device scales up (78% keyframe). */
const BACKDROP_RELEASE_MS = SPIN_DURATION_MS * 0.78;
/** How far two fingers must spread, relative to where they started. */
const PINCH_OUT_RATIO = 1.3;

const touchDistance = (touches: TouchList) =>
  Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );

/**
 * Drives the showcase: the device recedes, turns a full circle to reveal its
 * engraved back, and settles flat again. The page darkens meanwhile.
 */
export const useShowcase = () => {
  const [isSpinning, setIsSpinning] = useState(false);
  const [isBackdropDark, setIsBackdropDark] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const start = useCallback(() => {
    if (timers.current.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setIsSpinning(true);
    setIsBackdropDark(true);
    timers.current = [
      setTimeout(() => setIsBackdropDark(false), BACKDROP_RELEASE_MS),
      setTimeout(() => {
        setIsSpinning(false);
        timers.current = [];
      }, SPIN_DURATION_MS),
    ];
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { isSpinning, isBackdropDark, start };
};

type ShowcaseDeviceProps = {
  isSpinning: boolean;
  onShowcase: () => void;
  children: ReactNode;
};

/**
 * 3D wrapper around the shell (the front face) and the steel back. Pinch out
 * with two fingers, or double-click anywhere but the click wheel, to spin it.
 */
export const ShowcaseDevice = ({ isSpinning, onShowcase, children }: ShowcaseDeviceProps) => {
  const deviceRef = useRef<HTMLDivElement>(null);
  const onShowcaseRef = useRef(onShowcase);
  useEffect(() => {
    onShowcaseRef.current = onShowcase;
  });

  // Non-passive listeners so the pinch spins the device instead of zooming the page.
  useEffect(() => {
    const device = deviceRef.current;
    if (!device) return;
    let startDistance: number | null = null;

    const onTouchStart = (event: TouchEvent) => {
      startDistance = event.touches.length === 2 ? touchDistance(event.touches) : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startDistance === null || event.touches.length !== 2) return;
      event.preventDefault();
      if (touchDistance(event.touches) / startDistance >= PINCH_OUT_RATIO) {
        startDistance = null;
        onShowcaseRef.current();
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) startDistance = null;
    };
    // iOS Safari's own pinch-zoom gesture.
    const preventGesture = (event: Event) => event.preventDefault();

    device.addEventListener("touchstart", onTouchStart, { passive: true });
    device.addEventListener("touchmove", onTouchMove, { passive: false });
    device.addEventListener("touchend", onTouchEnd, { passive: true });
    device.addEventListener("touchcancel", onTouchEnd, { passive: true });
    device.addEventListener("gesturestart", preventGesture, { passive: false });
    return () => {
      device.removeEventListener("touchstart", onTouchStart);
      device.removeEventListener("touchmove", onTouchMove);
      device.removeEventListener("touchend", onTouchEnd);
      device.removeEventListener("touchcancel", onTouchEnd);
      device.removeEventListener("gesturestart", preventGesture);
    };
  }, []);

  // Rapid center-button presses must not count, so the wheel is excluded.
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-showcase-ignore]")) return;
    window.getSelection()?.removeAllRanges();
    onShowcase();
  };

  return (
    <div
      ref={deviceRef}
      className={styles.device}
      data-spinning={isSpinning}
      onDoubleClick={handleDoubleClick}
    >
      {children}
      <div className={styles.backFace} aria-hidden="true">
        <div className={styles.engraving}>
          <p>Designed by Vincent Velasco in Fontana</p>
          <p>mcvindle.com</p>
        </div>
      </div>
    </div>
  );
};
