"use client";

import { useEffect, useRef, useState } from "react";

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

const VOLUME_STEP = 0.04;
const VOLUME_ACTIVE_MS = 3000;

/** Wheel adjusts volume; center toggles the scrubber, as on the real iPod. */
const Controls = () => {
  const { volume, setVolume } = useAudioPlayer();
  const { isTopView } = useViewContext();
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [volumeActive, setVolumeActive] = useState(false);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = isTopView("nowPlaying");

  useEffect(
    () => () => {
      if (volumeTimer.current) clearTimeout(volumeTimer.current);
    },
    []
  );

  const changeVolume = (delta: number) => {
    if (!isActive || isScrubbing) return;
    setVolumeActive(true);
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => setVolumeActive(false), VOLUME_ACTIVE_MS);
    setVolume(Math.max(volume + delta, delta < 0 ? 0.01 : 0));
  };

  useWindowEvent("centerclick", () => {
    if (!isActive) return;
    setVolumeActive(false);
    setIsScrubbing((value) => !value);
  });
  useWindowEvent("forwardscroll", () => changeVolume(VOLUME_STEP));
  useWindowEvent("backwardscroll", () => changeVolume(-VOLUME_STEP));

  return (
    <div className={styles.controls}>
      <div className={styles.controlsLayer} data-hidden={isScrubbing || !volumeActive ? "right" : "false"}>
        <VolumeBar percent={volume * 100} />
      </div>
      <div className={styles.controlsLayer} data-hidden={isScrubbing || volumeActive ? "left" : "false"}>
        <TrackProgress />
      </div>
      <div className={styles.controlsLayer} data-hidden={isScrubbing ? "false" : "right"}>
        <Scrubber isScrubbing={isScrubbing && isActive} />
      </div>
    </div>
  );
};

export const NowPlaying = () => {
  const { nowPlayingItem, queue } = useAudioPlayer();
  const { isTopView, hideView } = useViewContext();
  const position = nowPlayingItem ? queue.indexOf(nowPlayingItem) + 1 : 0;

  // Leave the view once the queue finishes.
  useEffect(() => {
    if (!nowPlayingItem && isTopView("nowPlaying")) hideView();
  }, [nowPlayingItem, isTopView, hideView]);

  return (
    <div className={styles.nowPlaying}>
      <div className={styles.nowPlayingMetadata}>
        <div className={styles.nowPlayingArtworkContainer}>
          <img
            className={styles.nowPlayingCover}
            src={nowPlayingItem?.coverArt ?? "/sites/ipod/default_album_artwork.png"}
            alt={nowPlayingItem ? `${nowPlayingItem.title} cover art` : "Album artwork"}
          />
        </div>
        <div className={styles.nowPlayingInfo}>
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
        <Controls />
      </div>
    </div>
  );
};
