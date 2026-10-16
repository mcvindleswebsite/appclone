"use client";

import type { CSSProperties } from "react";

import type { FavoriteSong } from "@/data/favorite-songs";

import styles from "./ipod.module.css";

/* eslint-disable @next/next/no-img-element -- remote cover art */

/** Cover edge length in px (the source uses 8em; scaled to leave room for captions). */
const COVER_SIZE = 112;
/** Distance from the center cover to its first neighbor's center. */
const FIRST_FLANK_OFFSET = 96;
/** Spacing between stacked covers further out. */
const FLANK_SPACING = 36;
const FLANK_ANGLE_DEG = 60;
const FLANK_DEPTH_PX = -80;

/**
 * Where a cover sits relative to the active one: centered and flat at
 * offset 0, otherwise angled toward the center and recessed into the scene.
 */
const getCoverTransform = (offset: number) => {
  if (offset === 0) return "translateX(-50%) translateZ(0px) rotateY(0deg)";
  const side = Math.sign(offset);
  const x = side * (FIRST_FLANK_OFFSET + (Math.abs(offset) - 1) * FLANK_SPACING);
  // Left covers turn right (+) and right covers turn left (−), facing inward.
  const angle = -side * FLANK_ANGLE_DEG;
  return `translateX(calc(-50% + ${x}px)) translateZ(${FLANK_DEPTH_PX}px) rotateY(${angle}deg)`;
};

type CoverFlowProps = {
  songs: FavoriteSong[];
  activeIndex: number;
};

/** Apple-style Cover Flow: 3D carousel with mirrored floor reflections. */
export const CoverFlow = ({ songs, activeIndex }: CoverFlowProps) => {
  const activeSong = songs[activeIndex];

  return (
    <div className={styles.coverFlow}>
      <div className={styles.coverFlowStage} style={{ "--cover-size": `${COVER_SIZE}px` } as CSSProperties}>
        {songs.map((song, index) => {
          const offset = index - activeIndex;
          return (
            <div
              key={song.id}
              className={styles.coverFlowItem}
              data-active={offset === 0}
              style={{ transform: getCoverTransform(offset), zIndex: 100 - Math.abs(offset) }}
            >
              <img className={styles.coverFlowArt} src={song.coverArt} alt={`${song.title} cover art`} />
              <img className={styles.coverFlowReflection} src={song.coverArt} alt="" aria-hidden="true" />
            </div>
          );
        })}
      </div>
      <div className={styles.coverFlowCaption} aria-live="polite">
        <h3 className={styles.coverFlowTitle}>{activeSong?.title}</h3>
        <h3 className={styles.coverFlowArtist}>{activeSong?.artist}</h3>
      </div>
    </div>
  );
};
