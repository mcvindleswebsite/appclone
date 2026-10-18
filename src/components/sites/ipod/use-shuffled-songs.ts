"use client";

import { useSyncExternalStore } from "react";

import { favoriteSongs, type FavoriteSong } from "@/data/favorite-songs";

/** Fisher–Yates shuffle into a new array. */
const shuffle = <T>(items: readonly T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Shuffled once per page load and shared, so every view sees the same order. */
let shuffledSongs: FavoriteSong[] | null = null;

const getSnapshot = () => (shuffledSongs ??= shuffle(favoriteSongs));
const getServerSnapshot = () => favoriteSongs;
const subscribe = () => () => undefined;

/** Favorites in this page load's random order (authored order on the server). */
export const useShuffledSongs = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
