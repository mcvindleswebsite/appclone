"use client";

import { useEffect, useMemo, useRef, type ComponentType } from "react";

import type { FavoriteSong } from "@/data/favorite-songs";
import { profile } from "@/data/profile";

import { useAudioPlayer } from "./audio-context";
import { CoverFlow } from "./CoverFlow";
import { BrickGameView, SolitaireGameView } from "./games/GameCanvas";
import { useViewContext } from "./ipod-context";
import { NowPlaying } from "./NowPlaying";
import { SelectableList } from "./screen-parts";
import type { ListOption, ViewId } from "./types";
import { useMenuHideView, useSelectableList } from "./use-selectable-list";
import { useShuffledSongs } from "./use-shuffled-songs";
import styles from "./ipod.module.css";

/* eslint-disable @next/next/no-img-element -- remote cover art */

const ListView = ({ viewId, options }: { viewId: ViewId; options: ListOption[] }) => {
  const activeIndex = useSelectableList(viewId, options);
  return <SelectableList options={options} activeIndex={activeIndex} />;
};

const linkOptions: ListOption[] = profile.links.map((link, index) => ({
  type: "link",
  label: link.label,
  url: link.url,
  avatarUrl: link.avatarUrl,
  preview: `link-${index}`,
}));

/** Root menu: Music, Instagram, TikTok, Games, About (+ Now Playing while a song plays). */
const HomeView = () => {
  const { nowPlayingItem } = useAudioPlayer();
  const options = useMemo<ListOption[]>(
    () => [
      { type: "view", label: "Music", viewId: "music", preview: "music" },
      ...linkOptions,
      { type: "view", label: "Games", viewId: "games", preview: "games" },
      { type: "view", label: "About", viewId: "about" },
      ...(nowPlayingItem
        ? [
            {
              type: "view",
              label: "Now Playing",
              viewId: "nowPlaying",
              preview: "nowPlaying",
            } satisfies ListOption,
          ]
        : []),
    ],
    [nowPlayingItem]
  );
  return <ListView viewId="home" options={options} />;
};

const toSongOptions = (songs: FavoriteSong[]): ListOption[] =>
  songs.map((song, index) => ({
    type: "song",
    label: song.title,
    sublabel: song.artist,
    queue: songs,
    startIndex: index,
    showNowPlayingView: true,
  }));

/** Wait for the wheel to settle so fast spins don't thrash the audio. */
const SNIPPET_DELAY_MS = 400;

/**
 * Plays the focused song's 30-second `previewUrl` clip whenever the
 * highlight moves (or the list opens). Reads playback state through a ref so
 * it fires on focus changes only, not when the queue advances on its own.
 */
const useFocusSnippet = (viewId: ViewId, songs: FavoriteSong[], focusedSong?: FavoriteSong) => {
  const { isTopView } = useViewContext();
  const { play, nowPlayingItem } = useAudioPlayer();

  const latest = useRef({ isActive: false, nowPlayingId: "", play });
  useEffect(() => {
    latest.current = {
      isActive: isTopView(viewId),
      nowPlayingId: nowPlayingItem?.id ?? "",
      play,
    };
  });

  useEffect(() => {
    if (!focusedSong) return;
    const timeout = setTimeout(() => {
      const { isActive, nowPlayingId, play: playSnippet } = latest.current;
      if (!isActive || nowPlayingId === focusedSong.id) return;
      playSnippet(songs, songs.indexOf(focusedSong));
    }, SNIPPET_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [focusedSong, songs]);
};

/**
 * The Music screen: Cover Flow over a blurred, darkened copy of the centered
 * song's cover, which cross-fades as albums land in the middle. The wheel
 * slides through covers; center opens Now Playing; Menu goes back. Songs
 * appear in this page load's shuffled order, which the play queue follows too.
 */
const MusicView = () => {
  const songs = useShuffledSongs();
  const songOptions = useMemo(() => toSongOptions(songs), [songs]);
  const activeIndex = useSelectableList("music", songOptions);
  const focusedSong = songs[activeIndex];
  useFocusSnippet("music", songs, focusedSong);

  if (!songs.length) {
    return <SelectableList options={[]} activeIndex={0} emptyMessage="Add tracks in src/data/favorite-songs.ts" />;
  }

  return (
    <div className={styles.musicView}>
      <div className={styles.coverBackdrop} aria-hidden="true">
        {songs.map((song) => (
          <img
            key={song.id}
            className={styles.coverBackdropImage}
            src={song.coverArt}
            alt=""
            data-visible={song.id === focusedSong?.id}
          />
        ))}
      </div>
      <CoverFlow songs={songs} activeIndex={activeIndex} />
    </div>
  );
};

const gameOptions: ListOption[] = [
  { type: "view", label: "Brick", viewId: "brickGame", preview: "games" },
  { type: "view", label: "Solitaire", viewId: "solitaireGame", preview: "games" },
];

const GamesView = () => <ListView viewId="games" options={gameOptions} />;

const NowPlayingView = () => {
  useMenuHideView("nowPlaying");
  return <NowPlaying />;
};

const aboutOptions: ListOption[] = [
  { type: "link", label: "Email", sublabel: "vincent@mcvindle.com", url: "mailto:vincent@mcvindle.com" },
  { type: "link", label: "Phone", sublabel: "(909) 771-9891", url: "tel:9097719891" },
];

/** System info: tappable contact lines with the version pinned to the bottom. */
const AboutView = () => {
  const activeIndex = useSelectableList("about", aboutOptions);
  return (
    <div className={styles.aboutView}>
      <SelectableList options={aboutOptions} activeIndex={activeIndex} />
      <p className={styles.aboutVersion}>Version 1.0.0</p>
    </div>
  );
};

export const VIEW_COMPONENTS: Record<ViewId, ComponentType> = {
  home: HomeView,
  music: MusicView,
  games: GamesView,
  nowPlaying: NowPlayingView,
  brickGame: BrickGameView,
  solitaireGame: SolitaireGameView,
  about: AboutView,
};
