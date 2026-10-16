"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { FavoriteSong } from "@/data/favorite-songs";
import { profile } from "@/data/profile";

import { useWindowEvent } from "./events";

export type PlaybackInfo = {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  percent: number;
  timeRemaining: number;
};

type AudioContextValue = {
  nowPlayingItem?: FavoriteSong;
  queue: FavoriteSong[];
  playbackInfo: PlaybackInfo;
  volume: number;
  setVolume: (volume: number) => void;
  play: (queue: FavoriteSong[], startIndex: number) => void;
  togglePlayPause: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
  seekToTime: (time: number) => void;
};

const IDLE_PLAYBACK: PlaybackInfo = {
  isPlaying: false,
  isPaused: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  percent: 0,
  timeRemaining: 0,
};

const AudioContext = createContext<AudioContextValue | null>(null);

/** Plays the local favorites list through a single HTMLAudioElement. */
export const AudioProvider = ({ children }: { children: ReactNode }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<FavoriteSong[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo>(IDLE_PLAYBACK);
  const [volume, setVolumeState] = useState(0.5);

  const nowPlayingItem = queue[queueIndex];

  const syncPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const currentTime = audio.currentTime;
    setPlaybackInfo({
      isPlaying: !audio.paused,
      isPaused: audio.paused && !!audio.currentSrc && !audio.ended,
      isLoading: !audio.paused && audio.readyState < 3,
      currentTime,
      duration,
      percent: duration > 0 ? (currentTime / duration) * 100 : 0,
      timeRemaining: Math.max(duration - currentTime, 0),
    });
  }, []);

  const loadAndPlay = useCallback((song: FavoriteSong | undefined) => {
    const audio = audioRef.current;
    if (!audio || !song) return;
    audio.src = song.previewUrl;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay can be blocked until the visitor interacts; state stays paused.
    });
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    const events = [
      "play",
      "pause",
      "timeupdate",
      "loadedmetadata",
      "waiting",
      "playing",
      "canplay",
    ];
    events.forEach((name) => audio.addEventListener(name, syncPlayback));
    return () => {
      events.forEach((name) => audio.removeEventListener(name, syncPlayback));
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [syncPlayback]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const play = useCallback(
    (nextQueue: FavoriteSong[], startIndex: number) => {
      setQueue(nextQueue);
      setQueueIndex(startIndex);
      loadAndPlay(nextQueue[startIndex]);
    },
    [loadAndPlay]
  );

  const skipTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      setQueueIndex(index);
      loadAndPlay(queue[index]);
    },
    [queue, loadAndPlay]
  );

  const skipNext = useCallback(() => skipTo(queueIndex + 1), [skipTo, queueIndex]);

  const skipPrevious = useCallback(() => {
    const audio = audioRef.current;
    // Like the real iPod: restart the track unless we're near its start.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    skipTo(queueIndex - 1);
  }, [skipTo, queueIndex]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !nowPlayingItem) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [nowPlayingItem]);

  const seekToTime = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
  }, []);

  const setVolume = useCallback((next: number) => {
    setVolumeState(Math.min(Math.max(next, 0), 1));
  }, []);

  /** Advance through the queue; clear "now playing" after the last track. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => {
      if (queueIndex < queue.length - 1) {
        skipTo(queueIndex + 1);
      } else {
        setQueue([]);
        setQueueIndex(-1);
        setPlaybackInfo(IDLE_PLAYBACK);
      }
    };
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [queue.length, queueIndex, skipTo]);

  useEffect(() => {
    document.title = nowPlayingItem
      ? `${nowPlayingItem.title} – ${profile.name}`
      : `${profile.name} (@${profile.handle})`;
  }, [nowPlayingItem]);

  useWindowEvent("playpauseclick", togglePlayPause);
  useWindowEvent("forwardclick", skipNext);
  useWindowEvent("backwardclick", skipPrevious);

  const value = useMemo(
    () => ({
      nowPlayingItem,
      queue,
      playbackInfo,
      volume,
      setVolume,
      play,
      togglePlayPause,
      skipNext,
      skipPrevious,
      seekToTime,
    }),
    [
      nowPlayingItem,
      queue,
      playbackInfo,
      volume,
      setVolume,
      play,
      togglePlayPause,
      skipNext,
      skipPrevious,
      seekToTime,
    ]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
};

export const useAudioPlayer = () => {
  const value = useContext(AudioContext);
  if (!value) throw new Error("useAudioPlayer must be used within AudioProvider");
  return value;
};
