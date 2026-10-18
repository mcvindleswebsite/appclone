"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { motion, type PanInfo } from "motion/react";

import { unlockTickAudio, wheelTick } from "./click-feedback";
import {
  dispatchIpodEvent,
  dispatchKeyboardEvent,
  dispatchScrollEvent,
  useWindowEvent,
  type ScrollDirection,
} from "./events";
import { useSettings, useViewContext } from "./ipod-context";
import {
  FastForwardIcon,
  MenuIcon,
  PlayPauseIcon,
  RewindIcon,
} from "./icons";
import { DEVICE_THEMES } from "./themes";
import { useWheelOverride, type WheelButtonLabel } from "./wheel-override";
import styles from "./ipod.module.css";

/** Degrees the finger must travel before the wheel registers a tick. */
const ANGLE_OFFSET_THRESHOLD = 15;
/** Touch wheels render smaller, so they need more travel (iPod nano feel). */
const TOUCH_ANGLE_OFFSET_THRESHOLD = 23;
/** Pixels of movement before a press becomes a pan. */
const PAN_THRESHOLD = 5;
const TOUCH_PAN_THRESHOLD = 15;
/** No tick within this window resets velocity (Rockbox WHEEL_FAST_OFF_TIMEOUT). */
const VELOCITY_TIMEOUT_MS = 250;
const LONG_PRESS_THRESHOLD_MS = 500;

type Point = { x: number; y: number };

const getCenterPoint = (rect: DOMRect): Point => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const getAngle = (point: Point, center: Point) =>
  Math.round((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI);

const isPointWithin = (point: Point, element: HTMLElement | null) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
};

const getScrollDirection = (angleDelta: number, threshold: number): ScrollDirection => {
  // Crossing the ±180° seam produces a huge delta; flip it for that one tick.
  if (Math.abs(angleDelta) > threshold * 2) {
    return angleDelta > 0 ? "counter-clockwise" : "clockwise";
  }
  return angleDelta > 0 ? "clockwise" : "counter-clockwise";
};

/** A text label in place of a ring glyph; dimmed while its action is unavailable. */
const WheelLabel = ({ button, color }: { button: WheelButtonLabel; color: string }) => (
  <span className={styles.wheelLabel} style={{ color }} data-enabled={button.enabled}>
    {button.label}
  </span>
);

const useLongPress = (onPress: () => void, onLongPress: () => void) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clear = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  return {
    onPointerDown: () => {
      firedRef.current = false;
      timeoutRef.current = setTimeout(() => {
        firedRef.current = true;
        onLongPress();
      }, LONG_PRESS_THRESHOLD_MS);
    },
    onPointerUp: () => {
      if (!firedRef.current) onPress();
      firedRef.current = false;
      clear();
    },
    onPointerCancel: clear,
  };
};

/**
 * Circular input: drag around the ring to scroll, press the ring's labels for
 * Menu / ⏮ / ⏭ / ⏯, and the center for select. Long-press Menu returns home.
 */
export const ClickWheel = () => {
  const { deviceTheme, triggerHaptics } = useSettings();
  const theme = DEVICE_THEMES[deviceTheme].clickwheel;
  const { isTopView } = useViewContext();
  const override = useWheelOverride();
  // Labels follow the top view, so they revert the instant it's left.
  const labels = override && isTopView(override.viewId) ? override : null;
  const labelsRef = useRef(labels);
  useEffect(() => {
    labelsRef.current = labels;
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const rewindRef = useRef<HTMLDivElement>(null);
  const forwardRef = useRef<HTMLDivElement>(null);
  const playPauseRef = useRef<HTMLDivElement>(null);

  const hasScrolledRef = useRef(false);
  const startPointRef = useRef<Point>({ x: 0, y: 0 });
  const isTouchRef = useRef(false);
  const lastTickRef = useRef(0);
  const velocityRef = useRef(0);
  const lastDirectionRef = useRef<ScrollDirection | null>(null);

  const handleWheelPress = useCallback((point: Point) => {
    // Menu has its own pointer handlers (for long press).
    // Relabeled buttons send their own events so the music controls stay put.
    const relabeled = labelsRef.current !== null;
    if (isPointWithin(point, rewindRef.current)) {
      dispatchIpodEvent(relabeled ? "wheelleft" : "backwardclick");
    } else if (isPointWithin(point, forwardRef.current)) {
      dispatchIpodEvent(relabeled ? "wheelright" : "forwardclick");
    } else if (isPointWithin(point, playPauseRef.current)) {
      dispatchIpodEvent(relabeled ? "wheelbottom" : "playpauseclick");
    }
  }, []);

  const handlePanStart = useCallback((event: PointerEvent) => {
    isTouchRef.current = event.pointerType === "touch";
    startPointRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handlePan = useCallback((_: PointerEvent, info: PanInfo) => {
    if (!rootRef.current) return;
    const center = getCenterPoint(rootRef.current.getBoundingClientRect());
    const angleDelta =
      getAngle(info.point, center) - getAngle(startPointRef.current, center);
    const threshold = isTouchRef.current
      ? TOUCH_ANGLE_OFFSET_THRESHOLD
      : ANGLE_OFFSET_THRESHOLD;

    if (Math.abs(angleDelta) <= threshold) return;

    const direction = getScrollDirection(angleDelta, threshold);
    hasScrolledRef.current = true;
    startPointRef.current = info.point;

    const now = performance.now();
    const sinceLastTick = now - lastTickRef.current;
    if (
      direction !== lastDirectionRef.current ||
      lastTickRef.current === 0 ||
      sinceLastTick > VELOCITY_TIMEOUT_MS
    ) {
      velocityRef.current = 0;
    } else {
      velocityRef.current = (15 * velocityRef.current + 1000 / sinceLastTick) / 16;
    }
    lastTickRef.current = now;
    lastDirectionRef.current = direction;

    wheelTick();
    dispatchScrollEvent(direction, velocityRef.current);
  }, []);

  const handlePanEnd = useCallback(
    (event: PointerEvent, info: PanInfo) => {
      const distance = Math.hypot(info.offset.x, info.offset.y);
      const panThreshold = isTouchRef.current ? TOUCH_PAN_THRESHOLD : PAN_THRESHOLD;
      if (!hasScrolledRef.current && distance < panThreshold) {
        handleWheelPress({ x: event.clientX, y: event.clientY });
      }
      velocityRef.current = 0;
      lastTickRef.current = 0;
      lastDirectionRef.current = null;
      setTimeout(() => {
        hasScrolledRef.current = false;
      }, 50);
    },
    [handleWheelPress]
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (hasScrolledRef.current) return;
      handleWheelPress({ x: event.clientX, y: event.clientY });
    },
    [handleWheelPress]
  );

  useWindowEvent<KeyboardEvent>("keydown", (event) => {
    if (event.key.startsWith("Arrow")) wheelTick();
    dispatchKeyboardEvent(event.key);
  });

  // The tick's AudioContext can only start from a gesture; pan moves don't
  // count on iOS, so unlock on the press that begins each spin.
  useEffect(() => {
    const events = ["pointerdown", "keydown", "touchend"] as const;
    events.forEach((name) => window.addEventListener(name, unlockTickAudio, { capture: true }));
    return () => {
      events.forEach((name) =>
        window.removeEventListener(name, unlockTickAudio, { capture: true })
      );
    };
  }, []);

  // touch-action: none (CSS) covers modern browsers; this non-passive guard
  // also stops older iOS Safari from scrolling the page mid-spin.
  useEffect(() => {
    const wheel = rootRef.current;
    if (!wheel) return;
    const preventScroll = (event: TouchEvent) => event.preventDefault();
    wheel.addEventListener("touchmove", preventScroll, { passive: false });
    return () => wheel.removeEventListener("touchmove", preventScroll);
  }, []);

  const centerHandlers = useLongPress(
    () => {
      if (!hasScrolledRef.current) dispatchIpodEvent("centerclick");
    },
    () => {
      triggerHaptics();
      dispatchIpodEvent("centerlongclick");
    }
  );

  const menuHandlers = useLongPress(
    () => {
      if (!hasScrolledRef.current) dispatchIpodEvent("menuclick");
    },
    () => {
      if (hasScrolledRef.current) return;
      triggerHaptics();
      dispatchIpodEvent("menulongpress");
    }
  );

  const style = {
    "--wheel-bg": theme.background,
    "--wheel-outline": theme.outline,
    "--wheel-center-bg": theme.centerBackground,
    "--wheel-center-shadow": theme.centerShadow,
  } as CSSProperties;

  return (
    <motion.div
      ref={rootRef}
      className={styles.wheel}
      style={style}
      onClick={handleClick}
      onPanStart={handlePanStart}
      onPan={handlePan}
      onPanEnd={handlePanEnd}
      role="group"
      aria-label="Click wheel. Drag around the wheel or use the arrow keys to scroll; Enter selects; Escape goes back."
    >
      <div className={`${styles.wheelButton} ${styles.placeTop}`} {...menuHandlers}>
        <MenuIcon color={theme.button} />
      </div>
      <div ref={rewindRef} className={`${styles.wheelButton} ${styles.placeLeft}`}>
        {labels ? <WheelLabel button={labels.left} color={theme.button} /> : <RewindIcon color={theme.button} />}
      </div>
      <div className={`${styles.wheelButton} ${styles.placeCenter}`}>
        <div className={styles.centerButton} {...centerHandlers}>
          {labels && <WheelLabel button={labels.center} color={theme.button} />}
        </div>
      </div>
      <div ref={forwardRef} className={`${styles.wheelButton} ${styles.placeRight}`}>
        {labels ? <WheelLabel button={labels.right} color={theme.button} /> : <FastForwardIcon color={theme.button} />}
      </div>
      <div ref={playPauseRef} className={`${styles.wheelButton} ${styles.placeBottom}`}>
        {labels ? <WheelLabel button={labels.bottom} color={theme.button} /> : <PlayPauseIcon color={theme.button} />}
      </div>
    </motion.div>
  );
};
