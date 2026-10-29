"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { YTNamespace, YTPlayer } from "@/types/youtube";

/**
 * "youtube" plays the full track in an embedded video; "audio" plays a full-length file (a
 * BandLab recording); "preview" plays the 30s iTunes clip.
 */
export type Engine = "youtube" | "audio" | "preview";

const YT_PLAYING = 1;
let youTubePromise: Promise<YTNamespace> | null = null;

/** Loads the YouTube IFrame API once. */
const loadYouTube = () => {
  youTubePromise ??= new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      youTubePromise = null;
      reject(new Error("Couldn't load the YouTube player"));
    };
    document.head.appendChild(script);
  });
  return youTubePromise;
};

/**
 * What the player plays: a YouTube video or a full audio file (both seekable to any lyric) or,
 * without either, a 30s preview clip. `key` names the source, so switching sources resets the readout.
 */
export interface TrackSource {
  key: string;
  youtubeId: string | null;
  /** A full-length audio file, e.g. a BandLab mixdown. */
  audioUrl?: string | null;
  previewUrl: string | null;
  durationSec: number;
}

/**
 * Plays one source at a time. `mount` is a callback ref for the element the video goes in;
 * YouTube's terms require the player to stay visible, so it's shown on the page.
 */
export const useTrackPlayer = (source: TrackSource | null) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const video = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  /** A seek requested before the video finished loading. */
  const pending = useRef<number | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [notice, setNotice] = useState<string | null>(null);
  const volumeRef = useRef(0.8);

  const youtubeId = source?.youtubeId ?? null;
  const audioUrl = source?.audioUrl ?? null;
  const previewUrl = source?.previewUrl ?? null;
  const key = source?.key ?? null;
  const engine: Engine = youtubeId ? "youtube" : audioUrl ? "audio" : "preview";

  // The <audio> for full files and previews, made once on the client.
  useEffect(() => {
    const el = new Audio();
    el.preload = "metadata";
    const sync = () => {
      setTime(el.currentTime);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setPlaying(!el.paused);
    };
    const events = ["timeupdate", "play", "pause", "ended", "loadedmetadata"];
    for (const name of events) el.addEventListener(name, sync);
    audio.current = el;
    return () => {
      el.pause();
      for (const name of events) el.removeEventListener(name, sync);
    };
  }, []);

  // Reset the readout when the source changes (during render, so there's no stale frame).
  const [loaded, setLoaded] = useState(key);
  if (loaded !== key) {
    setLoaded(key);
    setTime(0);
    setPlaying(false);
    setNotice(null);
    setDuration(source?.durationSec ?? 0);
  }

  // The audio and preview engines load their file here.
  useEffect(() => {
    const el = audio.current;
    if (el) {
      el.pause();
      el.src = youtubeId ? "" : (audioUrl ?? previewUrl ?? "");
      el.volume = volumeRef.current;
    }
  }, [key, youtubeId, audioUrl, previewUrl]);

  // The YouTube player, rebuilt when the video changes.
  useEffect(() => {
    if (!host || !youtubeId) return;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const target = document.createElement("div");
    host.replaceChildren(target);
    ready.current = false;

    loadYouTube()
      .then((YT) => {
        if (cancelled) return;
        const player = new YT.Player(target, {
          videoId: youtubeId,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              ready.current = true;
              player.setVolume(Math.round(volumeRef.current * 100));
              setDuration(player.getDuration() || 0);
              if (pending.current !== null) {
                player.seekTo(pending.current, true);
                player.playVideo();
                pending.current = null;
              }
            },
            onStateChange: ({ data }) => setPlaying(data === YT_PLAYING),
            onError: () => setNotice("This YouTube video can't be played here — link a different one."),
          },
        });
        video.current = player;
        // The IFrame API has no time events, so the scrubber polls.
        poll = setInterval(() => {
          if (!ready.current) return;
          setTime(player.getCurrentTime() || 0);
          setDuration(player.getDuration() || 0);
        }, 250);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Couldn't load YouTube"));

    return () => {
      cancelled = true;
      clearInterval(poll);
      video.current?.destroy();
      video.current = null;
      ready.current = false;
    };
  }, [host, youtubeId]);

  const playAt = useCallback(
    async (seconds: number) => {
      if (!key) return;
      setNotice(null);
      if (youtubeId) {
        setTime(seconds);
        if (video.current && ready.current) {
          video.current.seekTo(seconds, true);
          video.current.playVideo();
        } else pending.current = seconds;
        return;
      }
      const el = audio.current;
      if (el && audioUrl) {
        setTime(seconds);
        el.currentTime = seconds;
        await el.play().catch(() => setNotice("Tap play to start."));
        return;
      }
      if (!el || !previewUrl) {
        setNotice("Nothing to play — this song has no video or preview yet.");
        return;
      }
      // A preview is a 30s clip from somewhere in the song, so lyric times can't be seeked.
      if (seconds > 0) setNotice("Only a 30-second preview is linked, so it can't jump to this part.");
      el.currentTime = 0;
      await el.play().catch(() => setNotice("Tap play to start the preview."));
    },
    [key, youtubeId, audioUrl, previewUrl]
  );

  const toggle = useCallback(async () => {
    if (!key) return;
    if (youtubeId) {
      if (!video.current || !ready.current) return;
      if (video.current.getPlayerState() === YT_PLAYING) video.current.pauseVideo();
      else video.current.playVideo();
      return;
    }
    const el = audio.current;
    if (!el?.src) {
      setNotice("Nothing to play — this song has no video or preview yet.");
      return;
    }
    if (el.paused) await el.play().catch(() => undefined);
    else el.pause();
  }, [key, youtubeId]);

  const seek = useCallback(
    (seconds: number) => {
      setTime(seconds);
      if (youtubeId) {
        if (video.current && ready.current) video.current.seekTo(seconds, true);
      } else if (audio.current) audio.current.currentTime = seconds;
    },
    [youtubeId]
  );

  const setVolume = useCallback((value: number) => {
    volumeRef.current = value;
    setVolumeState(value);
    if (audio.current) audio.current.volume = value;
    if (video.current && ready.current) video.current.setVolume(Math.round(value * 100));
  }, []);

  return { engine, playing, time, duration, volume, notice, mount: setHost, playAt, toggle, seek, setVolume };
};

export type TrackPlayer = ReturnType<typeof useTrackPlayer>;
