"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import { useAudioPlayer } from "./audio-context";
import { useWindowEvent } from "./events";
import { useViewContext } from "./ipod-context";
import styles from "./ipod.module.css";

/* eslint-disable @next/next/no-img-element -- remote cover art and static glyphs */

const formatTime = (seconds: number) => {
  const total = Math.max(Math.floor(seconds), 0);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const ProgressBar = ({ percent, isScrubber = false }: { percent: number; isScrubber?: boolean }) => (
  <div className={styles.progressBar}>
    <div className={styles.progressTrack}>
      <div className={styles.progressGloss} />
      <div
        className={styles.progressFill}
        data-transparent={isScrubber}
        style={{ width: `${percent || 0}%` }}
      >
        {isScrubber && <img className={styles.diamond} src="/sites/ipod/scrubber.svg" alt="" />}
      </div>
    </div>
  </div>
);

const TrackProgress = () => {
  const { playbackInfo, nowPlayingItem } = useAudioPlayer();
  const has = !!nowPlayingItem;
  return (
    <div className={styles.trackProgress}>
      <h3 className={styles.timeLabel} style={{ textAlign: "left" }}>
        {has ? formatTime(playbackInfo.currentTime) : "--:--"}
      </h3>
      <ProgressBar percent={playbackInfo.percent} />
      <h3 className={styles.timeLabel} style={{ textAlign: "right" }}>
        {has ? `-${formatTime(playbackInfo.timeRemaining)}` : "--:--"}
      </h3>
    </div>
  );
};

const VolumeBar = ({ percent }: { percent: number }) => (
  <div className={styles.volumeBar}>
    <img className={styles.volumeIcon} src="/sites/ipod/volume_mute.svg" alt="" />
    <ProgressBar percent={percent} />
    <img className={styles.volumeIcon} src="/sites/ipod/volume_full.svg" alt="" />
  </div>
);

const SEEK_DEBOUNCE_MS = 300;

const Scrubber = ({ isScrubbing }: { isScrubbing: boolean }) => {
  const { playbackInfo, seekToTime } = useAudioPlayer();
  const { duration, currentTime } = playbackInfo;
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const time = scrubTime ?? currentTime;

  const scrub = (delta: number) => {
    if (!isScrubbing || duration <= 0) return;
    const next = Math.min(Math.max(time + delta, 0), duration);
    setScrubTime(next);
    if (seekTimer.current) clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => {
      seekToTime(next);
      setScrubTime(null);
    }, SEEK_DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current);
    },
    []
  );

  useWindowEvent("forwardscroll", () => scrub(1));
  useWindowEvent("backwardscroll", () => scrub(-1));

  return (
    <div className={styles.scrubber}>
      <h3 className={styles.timeLabel} style={{ textAlign: "left" }}>
        {formatTime(time)}
      </h3>
      <ProgressBar percent={duration > 0 ? Math.round((time / duration) * 100) : 0} isScrubber />
      <h3 className={styles.timeLabel} style={{ textAlign: "right" }}>
        -{formatTime(duration - time)}
      </h3>
    </div>
  );
};

/** Volume change per wheel tick (20 ticks from mute to max). */
const VOLUME_STEP = 0.05;
const VOLUME_ACTIVE_MS = 3000;

/**
 * Center-button screen modes, cycled with `(mode + 1) % 4`:
 * 0 track view (wheel = volume) · 1 scrubber (wheel = seek) ·
 * 2 album art focus (wheel = volume) · 3 rating (wheel = stars).
 */
type ScreenMode = 0 | 1 | 2 | 3;
const MODE_COUNT = 4;
/** Modes 1–3 fall back to the track view after this long without input. */
const MODE_IDLE_RESET_MS = 6000;
const MAX_RATING = 5;

const RATINGS_KEY = "mcvindle-ipod:ratings";

/** Per-song star ratings, kept in this visitor's browser. */
const useRatings = () => {
  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(RATINGS_KEY) ?? "{}");
    } catch {
      return {};
    }
  });

  const setRating = (songId: string, rating: number) => {
    setRatings((prev) => {
      const next = { ...prev, [songId]: rating };
      try {
        window.localStorage.setItem(RATINGS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode); the rating lasts for this visit.
      }
      return next;
    });
  };

  return { ratings, setRating };
};

const Controls = ({ mode, volumeActive }: { mode: ScreenMode; volumeActive: boolean }) => {
  const { volume } = useAudioPlayer();
  const { isTopView } = useViewContext();
  const isScrubbing = mode === 1;
  const showVolume = volumeActive && !isScrubbing;

  return (
    <div className={styles.controls}>
      <div className={styles.controlsLayer} data-hidden={showVolume ? "false" : "right"}>
        <VolumeBar percent={volume * 100} />
      </div>
      <div className={styles.controlsLayer} data-hidden={isScrubbing || showVolume ? "left" : "false"}>
        <TrackProgress />
      </div>
      <div className={styles.controlsLayer} data-hidden={isScrubbing ? "false" : "right"}>
        <Scrubber isScrubbing={isScrubbing && isTopView("nowPlaying")} />
      </div>
    </div>
  );
};

const Stars = ({ rating }: { rating: number }) => (
  <div className={styles.ratingStars} role="img" aria-label={`${rating} of ${MAX_RATING} stars`}>
    {Array.from({ length: MAX_RATING }, (_, i) => (
      <span key={i} className={styles.ratingStar} data-filled={i < rating}>
        {i < rating ? "★" : "☆"}
      </span>
    ))}
  </div>
);

export const NowPlaying = () => {
  const { nowPlayingItem, queue, changeVolume } = useAudioPlayer();
  const { isTopView, hideView } = useViewContext();
  const { ratings, setRating } = useRatings();
  const [mode, setMode] = useState<ScreenMode>(0);
  /** Bumped on every wheel input; restarts the idle-reset countdown. */
  const [lastInput, setLastInput] = useState(0);
  const [volumeActive, setVolumeActive] = useState(false);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = isTopView("nowPlaying");
  const position = nowPlayingItem ? queue.indexOf(nowPlayingItem) + 1 : 0;
  const rating = nowPlayingItem ? (ratings[nowPlayingItem.id] ?? 0) : 0;

  // Leave the view once the queue finishes.
  useEffect(() => {
    if (!nowPlayingItem && isTopView("nowPlaying")) hideView();
  }, [nowPlayingItem, isTopView, hideView]);

  // Modes 1–3 return to the track view after 6 seconds of no input.
  useEffect(() => {
    if (mode === 0) return;
    const timeout = setTimeout(() => setMode(0), MODE_IDLE_RESET_MS);
    return () => clearTimeout(timeout);
  }, [mode, lastInput]);

  useEffect(
    () => () => {
      if (volumeTimer.current) clearTimeout(volumeTimer.current);
    },
    []
  );

  const registerInput = () => setLastInput((n) => n + 1);

  const nudgeVolume = (delta: number) => {
    setVolumeActive(true);
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => setVolumeActive(false), VOLUME_ACTIVE_MS);
    changeVolume(delta);
  };

  /** Clockwise = +1, counter-clockwise = −1; meaning depends on the mode. */
  const handleWheel = (direction: 1 | -1) => {
    if (!isActive) return;
    registerInput();
    if (mode === 0 || mode === 2) nudgeVolume(direction * VOLUME_STEP);
    if (mode === 3 && nowPlayingItem) {
      setRating(nowPlayingItem.id, Math.min(Math.max(rating + direction, 0), MAX_RATING));
    }
    // Mode 1: the Scrubber listens for the wheel itself.
  };

  useWindowEvent("forwardscroll", () => handleWheel(1));
  useWindowEvent("backwardscroll", () => handleWheel(-1));
  useWindowEvent("centerclick", () => {
    if (!isActive) return;
    registerInput();
    setVolumeActive(false);
    setMode((current) => ((current + 1) % MODE_COUNT) as ScreenMode);
  });
  // Play/pause and skip still act directly (handled by the audio engine);
  // they just count as activity so the current mode stays open.
  useWindowEvent("playpauseclick", () => isActive && registerInput());
  useWindowEvent("forwardclick", () => isActive && registerInput());
  useWindowEvent("backwardclick", () => isActive && registerInput());

  const coverArt = nowPlayingItem?.coverArt ?? "/sites/ipod/default_album_artwork.png";

  return (
    <div className={styles.nowPlaying} data-mode={mode}>
      <div className={styles.nowPlayingMetadata}>
        <motion.div layout transition={{ duration: 0.4, ease: "easeInOut" }} className={styles.nowPlayingArtworkContainer}>
          <div className={styles.nowPlayingArtworkTilt}>
            <img
              className={styles.nowPlayingCover}
              src={coverArt}
              alt={nowPlayingItem ? `${nowPlayingItem.title} cover art` : "Album artwork"}
            />
          </div>
        </motion.div>
        <div className={styles.nowPlayingInfo} aria-hidden={mode === 2}>
          <div className={styles.nowPlayingTitle}>{nowPlayingItem?.title}</div>
          <div className={styles.nowPlayingSubtext}>{nowPlayingItem?.artist}</div>
          <div className={styles.nowPlayingSubtext}>{nowPlayingItem?.album}</div>
          {position > 0 && (
            <div className={styles.nowPlayingTrackCount}>
              {position} of {queue.length}
            </div>
          )}
        </div>
      </div>
      <div className={styles.controlsRow}>
        <Controls mode={mode} volumeActive={volumeActive} />
      </div>
      <div className={styles.ratingOverlay} data-visible={mode === 3} aria-hidden={mode !== 3}>
        <img className={styles.ratingBackdrop} src={coverArt} alt="" />
        <div className={styles.ratingContent}>
          <div className={styles.ratingTitle}>{nowPlayingItem?.title}</div>
          <div className={styles.ratingDetail}>{nowPlayingItem?.artist}</div>
          {nowPlayingItem?.album && <div className={styles.ratingDetail}>{nowPlayingItem.album}</div>}
          {position > 0 && (
            <div className={styles.ratingDetail}>
              Track {position} of {queue.length}
            </div>
          )}
          <Stars rating={rating} />
          <div className={styles.ratingHint}>Turn the wheel to rate</div>
        </div>
      </div>
    </div>
  );
};
