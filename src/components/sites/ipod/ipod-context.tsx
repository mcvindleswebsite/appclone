"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getSystemDeviceTheme, type DeviceThemeName } from "./themes";
import type { PreviewId, ViewId, ViewInstance } from "./types";
import { VIEW_CONFIG } from "./view-config";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

type SettingsContextValue = {
  /** Shell theme, derived from the OS color scheme. */
  deviceTheme: DeviceThemeName;
  triggerHaptics: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const triggerHaptics = () => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }
};

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

type ViewContextValue = {
  viewStack: ViewInstance[];
  preview: PreviewId;
  headerTitle: string;
  showView: (viewId: ViewId) => void;
  hideView: () => void;
  resetViews: () => void;
  setPreview: (preview: PreviewId) => void;
  isTopView: (id: string) => boolean;
};

const ViewContext = createContext<ViewContextValue | null>(null);

const HOME_VIEW: ViewInstance = { id: "home" };

export const IpodProvider = ({
  children,
  prefersDark,
}: {
  children: ReactNode;
  prefersDark: boolean;
}) => {
  const [viewStack, setViewStack] = useState<ViewInstance[]>([HOME_VIEW]);
  const [preview, setPreview] = useState<PreviewId>("music");

  const showView = useCallback((viewId: ViewId) => {
    setViewStack((stack) => [...stack, { id: viewId }]);
  }, []);

  const hideView = useCallback(() => {
    setViewStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }, []);

  const resetViews = useCallback(() => {
    setViewStack((stack) => stack.slice(0, 1));
  }, []);

  const isTopView = useCallback(
    (id: string) => viewStack[viewStack.length - 1]?.id === id,
    [viewStack]
  );

  const settingsValue = useMemo(
    () => ({ deviceTheme: getSystemDeviceTheme(prefersDark), triggerHaptics }),
    [prefersDark]
  );

  const viewValue = useMemo(
    () => ({
      viewStack,
      preview,
      headerTitle: VIEW_CONFIG[viewStack[viewStack.length - 1].id].title,
      showView,
      hideView,
      resetViews,
      setPreview,
      isTopView,
    }),
    [viewStack, preview, showView, hideView, resetViews, isTopView]
  );

  return (
    <SettingsContext.Provider value={settingsValue}>
      <ViewContext.Provider value={viewValue}>{children}</ViewContext.Provider>
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used within IpodProvider");
  return value;
};

export const useViewContext = () => {
  const value = useContext(ViewContext);
  if (!value) throw new Error("useViewContext must be used within IpodProvider");
  return value;
};
