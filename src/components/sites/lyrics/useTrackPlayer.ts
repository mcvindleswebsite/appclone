"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MusicKitInstance } from "@/types/musickit";
import type { SongMeta } from "@/types/lyrics";

const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const CONNECTED_STORAGE = "vindle_lyrics_apple";

/** "preview" plays the 30s clip in an <audio>; "apple" plays the full track through MusicKit. */
export type Engine = "preview" | "apple";

let musicKitPromise: Promise<MusicKitInstance> | null = null;

/** Loads MusicKit JS once and configures it with the server's developer token. */
const loadMusicKit = () => {
  musicKitPromise ??= (async () => {
    const tokenResponse = await fetch("/api/lyrics/token");
    const { token, error } = (await tokenResponse.json()) as { token?: string; error?: string };
    if (!token) throw new Error(error ?? "Apple Music not configured");

    if (!window.MusicKit) {
      await new Promise<void>((resolve, reject) => {
        document.addEventListener("musickitloaded", () => resolve(), { once: true });
        const script = document.createElement("script");
        script.src = MUSICKIT_SRC;
        script.async = true;
        script.onerror = () => reject(new Error("Couldn't load MusicKit"));
        document.head.appendChild(script);
      });
    }
    return window.MusicKit!.configure({ developerToken: token, app: { name: "Vindle Parody Studio", build: "1.0.0" } });
  })().catch((error: unknown) => {
    musicKitPromise = null;
    throw error;
  });
  return musicKitPromise;
};

export const useTrackPlayer = (song: SongMeta | null) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const music = useRef<MusicKitInstance | null>(null);
  const queued = useRef<string | null>(null);
  const [engine, setEngine] = useState<Engine>("preview");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // The preview <audio>, made once on the client.
  useEffect(() => {
    const el = new Audio();
    el.preload = "metadata";
    el.volume = 0.8;
    const sync = () => {
      setTime(el.currentTime);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setPlaying(!el.paused);
    };
    for (const name of ["timeupdate", "play", "pause", "ended", "loadedmetadata"]) el.addEventListener(name, sync);
    audio.current = el;
    return () => {
      el.pause();
      for (const name of ["timeupdate", "play", "pause", "ended", "loadedmetadata"]) el.removeEventListener(name, sync);
    };
  }, []);

  const attachMusicKit = useCallback((instance: MusicKitInstance) => {
    music.current = instance;
    const sync = () => {
      setTime(instance.currentPlaybackTime || 0);
      setDuration(instance.currentPlaybackDuration || 0);
      setPlaying(instance.isPlaying);
    };
    instance.addEventListener("playbackTimeDidChange", sync);
    instance.addEventListener("playbackStateDidChange", sync);
    instance.addEventListener("playbackDurationDidChange", sync);
    audio.current?.pause();
    setEngine("apple");
  }, []);

  // Reconnect silently if this browser signed in to Apple Music before.
  useEffect(() => {
    if (localStorage.getItem(CONNECTED_STORAGE) !== "1") return;
    loadMusicKit()
      .then((instance) => {
        if (instance.isAuthorized) attachMusicKit(instance);
      })
      .catch(() => localStorage.removeItem(CONNECTED_STORAGE));
  }, [attachMusicKit]);

  // Load the new song into whichever engine is active.
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setNotice(null);
    queued.current = null;
    setDuration(song ? song.durationMs / 1000 : 0);
    const el = audio.current;
    if (el) {
      el.pause();
      el.src = engine === "preview" && song?.previewUrl ? song.previewUrl : "";
    }
    if (engine === "apple") music.current?.stop();
  }, [song, engine]);

  /** Makes sure MusicKit's queue holds the current song before playing or seeking. */
  const ensureQueued = useCallback(async () => {
    const instance = music.current;
    if (!instance || !song) return null;
    if (queued.current !== song.id) {
      await instance.setQueue({ song: song.id, startPlaying: false });
      queued.current = song.id;
    }
    return instance;
  }, [song]);

  const playAt = useCallback(
    async (seconds: number) => {
      if (!song) return;
      setNotice(null);
      if (engine === "apple") {
        try {
          const instance = await ensureQueued();
          if (!instance) return;
          await instance.play();
          await instance.seekToTime(seconds);
        } catch {
          setNotice("Apple Music couldn't play this track.");
        }
        return;
      }
      const el = audio.current;
      if (!el || !song.previewUrl) {
        setNotice("No preview for this song — connect Apple Music to play it.");
        return;
      }
      // Previews are a 30s clip from somewhere in the song, so song timestamps can't be seeked.
      if (seconds > 0) setNotice("Previews are 30 seconds — connect Apple Music to jump to this part.");
      el.currentTime = 0;
      await el.play().catch(() => setNotice("Tap play to start the preview."));
    },
    [engine, ensureQueued, song]
  );

  const toggle = useCallback(async () => {
    if (!song) return;
    if (engine === "apple") {
      const instance = await ensureQueued().catch(() => null);
      if (!instance) return;
      if (instance.isPlaying) instance.pause();
      else await instance.play().catch(() => setNotice("Apple Music couldn't play this track."));
      return;
    }
    const el = audio.current;
    if (!el?.src) {
      setNotice("No preview for this song — connect Apple Music to play it.");
      return;
    }
    if (el.paused) await el.play().catch(() => undefined);
    else el.pause();
  }, [engine, ensureQueued, song]);

  const seek = useCallback(
    async (seconds: number) => {
      setTime(seconds);
      if (engine === "apple") {
        const instance = await ensureQueued().catch(() => null);
        await instance?.seekToTime(seconds).catch(() => undefined);
      } else if (audio.current) {
        audio.current.currentTime = seconds;
      }
    },
    [engine, ensureQueued]
  );

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    if (audio.current) audio.current.volume = value;
    if (music.current) music.current.volume = value;
  }, []);

  const connectApple = useCallback(async () => {
    setConnecting(true);
    setNotice(null);
    try {
      const instance = await loadMusicKit();
      if (!instance.isAuthorized) await instance.authorize();
      instance.volume = volume;
      localStorage.setItem(CONNECTED_STORAGE, "1");
      attachMusicKit(instance);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't connect Apple Music");
    } finally {
      setConnecting(false);
    }
  }, [attachMusicKit, volume]);

  const disconnectApple = useCallback(async () => {
    await music.current?.unauthorize().catch(() => undefined);
    music.current?.stop();
    localStorage.removeItem(CONNECTED_STORAGE);
    setEngine("preview");
  }, []);

  return { engine, playing, time, duration, volume, notice, connecting, playAt, toggle, seek, setVolume, connectApple, disconnectApple };
};

export type TrackPlayer = ReturnType<typeof useTrackPlayer>;
