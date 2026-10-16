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

type AudioPlayerContextValue = {
  nowPlayingItem?: FavoriteSong;
  queue: FavoriteSong[];
  playbackInfo: PlaybackInfo;
  /** 0.0 (muted) – 1.0 (max), mirrored onto the audio element. */
  volume: number;
  /** Nudges volume by `delta`, clamped to [0, 1]. */
  changeVolume: (delta: number) => void;
  play: (queue: FavoriteSong[], startIndex: number) => void;
  togglePlayPause: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
  seekToTime: (time: number) => void;
};

const VOLUME_STORAGE_KEY = "mcvindle_ipod_volume";
const DEFAULT_VOLUME = 0.8;
/** Short ramp so gain changes never click or "zipper" while spinning. */
const GAIN_RAMP_SECONDS = 0.015;

const clampVolume = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 100) / 100;

const readStoredVolume = () => {
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(VOLUME_STORAGE_KEY) ?? "");
    return Number.isFinite(stored) ? clampVolume(stored) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
};

const storeVolume = (value: number) => {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable (private mode); volume lasts for this visit only.
  }
};

type VolumeGraph = { context: AudioContext; gain: GainNode };

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

const IDLE_PLAYBACK: PlaybackInfo = {
  isPlaying: false,
  isPaused: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  percent: 0,
  timeRemaining: 0,
};

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

/** Plays the local favorites list through a single HTMLAudioElement. */
export const AudioProvider = ({ children }: { children: ReactNode }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<FavoriteSong[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo>(IDLE_PLAYBACK);
  // Provider mounts client-side only, so localStorage is available here.
  const [volume, setVolumeState] = useState(readStoredVolume);
  // Source of truth for the wheel: fast spins fire several ticks per frame,
  // so steps accumulate here instead of on a possibly stale render value.
  const volumeRef = useRef(volume);
  /** element → GainNode → speakers; created on the first user gesture. */
  const graphRef = useRef<VolumeGraph | null>(null);

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
    // Required to route remote audio through Web Audio (Apple's preview CDN
    // sends Access-Control-Allow-Origin: *). Must be set before `src`.
    audio.crossOrigin = "anonymous";
    // Fallback until the gain graph exists (and where Web Audio is missing).
    audio.volume = volumeRef.current;
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

  /**
   * Volume is applied with a GainNode rather than `audio.volume`, which iOS
   * Safari ignores. Browsers only allow audio routing after a user gesture,
   * so the graph is built (and resumed) on the first tap/click/keypress.
   */
  useEffect(() => {
    const unlock = () => {
      const graph = graphRef.current;
      if (graph) {
        if (graph.context.state === "suspended") void graph.context.resume();
        return;
      }
      const audio = audioRef.current;
      const AudioContextCtor =
        window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!audio || !AudioContextCtor) return;
      try {
        const context = new AudioContextCtor();
        const gain = context.createGain();
        gain.gain.value = volumeRef.current;
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
        // The gain node now owns loudness; keep the element at full scale.
        audio.volume = 1;
        graphRef.current = { context, gain };
        void context.resume();
      } catch {
        // Web Audio unavailable: audio.volume keeps working as the fallback.
      }
    };
    const events = ["pointerdown", "keydown", "touchend"] as const;
    events.forEach((name) => window.addEventListener(name, unlock, { capture: true }));
    return () => {
      events.forEach((name) => window.removeEventListener(name, unlock, { capture: true }));
      void graphRef.current?.context.close();
      graphRef.current = null;
    };
  }, []);

  const changeVolume = useCallback((delta: number) => {
    // Rounded to hundredths so repeated ±0.05 steps land exactly on 0 and 1.
    const next = clampVolume(volumeRef.current + delta);
    if (next === volumeRef.current) return;
    volumeRef.current = next;
    // Apply immediately so the sound follows the wheel on the same tick.
    const graph = graphRef.current;
    if (graph) {
      graph.gain.gain.setTargetAtTime(next, graph.context.currentTime, GAIN_RAMP_SECONDS);
    } else if (audioRef.current) {
      audioRef.current.volume = next;
    }
    setVolumeState(next);
    storeVolume(next);
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
      changeVolume,
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
      changeVolume,
      play,
      togglePlayPause,
      skipNext,
      skipPrevious,
      seekToTime,
    ]
  );

  return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>;
};

export const useAudioPlayer = () => {
  const value = useContext(AudioPlayerContext);
  if (!value) throw new Error("useAudioPlayer must be used within AudioProvider");
  return value;
};
