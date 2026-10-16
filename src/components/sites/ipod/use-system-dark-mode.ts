"use client";

import { useEffect, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Tracks the OS color scheme. `matchMedia` runs only in an effect after mount,
 * so the server render and first client render agree and never mismatch
 * during hydration. Returns null until the scheme is known.
 */
export const useSystemDarkMode = () => {
  const [prefersDark, setPrefersDark] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const update = () => setPrefersDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return prefersDark;
};
