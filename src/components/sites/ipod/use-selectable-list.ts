"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAudioPlayer } from "./audio-context";
import { useWindowEvent, type ScrollEventDetail } from "./events";
import { useSettings, useViewContext } from "./ipod-context";
import type { ListOption } from "./types";

/**
 * Velocity (ticks/second) → items skipped per wheel tick, so fast spins
 * travel further, like Rockbox's wheel acceleration.
 */
const VELOCITY_SKIP_THRESHOLDS = [
  { minVelocity: 0, skip: 1 },
  { minVelocity: 6, skip: 3 },
  { minVelocity: 10, skip: 5 },
  { minVelocity: 14, skip: 8 },
];

const PREVIEW_DEBOUNCE_MS = 750;

const getSkipCount = (event: Event) => {
  const velocity =
    event instanceof CustomEvent
      ? ((event as CustomEvent<ScrollEventDetail>).detail?.velocity ?? 0)
      : 0;
  let skip = 1;
  for (const tier of VELOCITY_SKIP_THRESHOLDS) {
    if (velocity >= tier.minVelocity) skip = tier.skip;
  }
  return skip;
};

/** Keeps a wheel-driven index within the list's bounds. */
export const useScrollIndex = (id: string, options: ListOption[]) => {
  const { isTopView, setPreview } = useViewContext();
  const { triggerHaptics } = useSettings();
  const [index, setIndex] = useState(0);
  const isActive = isTopView(id);
  const clampedIndex = Math.min(index, Math.max(options.length - 1, 0));

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isActive) return;
    const preview = options[clampedIndex]?.preview;
    if (!preview) return;
    previewTimer.current = setTimeout(
      () => setPreview(preview),
      PREVIEW_DEBOUNCE_MS
    );
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [clampedIndex, isActive, options, setPreview]);

  const scroll = useCallback(
    (event: Event, direction: 1 | -1) => {
      if (!isActive) return;
      triggerHaptics();
      const skip = getSkipCount(event);
      setIndex((prev) => {
        const current = Math.min(prev, options.length - 1);
        return Math.min(Math.max(current + direction * skip, 0), options.length - 1);
      });
    },
    [isActive, options.length, triggerHaptics]
  );

  useWindowEvent("forwardscroll", (event) => scroll(event, 1));
  useWindowEvent("backwardscroll", (event) => scroll(event, -1));

  return clampedIndex;
};

/** Performs the selected option's action on a center click. */
export const useOptionSelect = (
  id: string,
  options: ListOption[],
  index: number
) => {
  const { isTopView, showView } = useViewContext();
  const { triggerHaptics } = useSettings();
  const { play, nowPlayingItem } = useAudioPlayer();

  useWindowEvent("centerclick", () => {
    const option = options[index];
    if (!isTopView(id) || !option) return;
    triggerHaptics();

    switch (option.type) {
      case "view":
        showView(option.viewId);
        break;
      case "link":
        window.open(option.url, "_blank", "noopener,noreferrer");
        break;
      case "song": {
        const song = option.queue[option.startIndex];
        if (nowPlayingItem?.id === song?.id) {
          showView("nowPlaying");
          break;
        }
        play(option.queue, option.startIndex);
        if (option.showNowPlayingView) showView("nowPlaying");
        break;
      }
    }
  });
};

/** Menu button pops the view when it's on top of the stack. */
export const useMenuHideView = (id: string) => {
  const { isTopView, hideView } = useViewContext();
  const { triggerHaptics } = useSettings();

  useWindowEvent("menuclick", () => {
    if (!isTopView(id)) return;
    triggerHaptics();
    hideView();
  });
};

export const useSelectableList = (id: string, options: ListOption[]) => {
  useMenuHideView(id);
  const activeIndex = useScrollIndex(id, options);
  useOptionSelect(id, options, activeIndex);
  return activeIndex;
};
