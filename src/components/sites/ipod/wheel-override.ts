"use client";

import { useSyncExternalStore } from "react";

import type { ViewId } from "./types";

export type WheelButtonLabel = { label: string; enabled: boolean };

/**
 * Text labels a view puts on the wheel in place of the ⏮ / ⏭ / ⏯ glyphs
 * (Menu always stays). While its view is on top, those buttons fire
 * `wheelleft` / `wheelright` / `wheelbottom` instead of the music controls.
 */
export type WheelOverride = {
  viewId: ViewId;
  center: WheelButtonLabel;
  left: WheelButtonLabel;
  right: WheelButtonLabel;
  bottom: WheelButtonLabel;
};

let current: WheelOverride | null = null;
const listeners = new Set<() => void>();

export const setWheelOverride = (next: WheelOverride | null) => {
  current = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useWheelOverride = () =>
  useSyncExternalStore(subscribe, () => current, () => null);
