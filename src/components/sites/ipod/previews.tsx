"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { profile, type ProfileLink } from "@/data/profile";

import { useAudioPlayer } from "./audio-context";
import { useViewContext } from "./ipod-context";
import { Avatar } from "./screen-parts";
import type { PreviewId } from "./types";
import { useShuffledSongs } from "./use-shuffled-songs";
import styles from "./ipod.module.css";

/* eslint-disable @next/next/no-img-element -- remote cover art and static glyphs */

const previewSlideRight = {
  initial: { x: "130%", opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { duration: 0.4, ease: "easeInOut" as const } },
  exit: { x: "130%", opacity: 0, transition: { duration: 0.4, ease: "easeInOut" as const } },
};

/** Cover art in the same shuffled order as the Music list. */
const useCoverUrls = () => {
  const songs = useShuffledSongs();
  return useMemo(() => songs.map((song) => song.coverArt), [songs]);
};

/** Pans across cover art, cross-fading to the next cover every 5 seconds. */
const KenBurns = ({ urls }: { urls: string[] }) => {
  const [stack, setStack] = useState(urls);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (urls.length < 2) return;
    let fadeTimeout: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setTransitioning(true);
      fadeTimeout = setTimeout(() => {
        setStack((prev) => [...prev.slice(1), prev[0]]);
        setTransitioning(false);
      }, 2000);
    }, 5000);
    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimeout);
    };
  }, [urls.length]);

  return (
    <div>
      {stack.slice(0, 2).map((url, index) => (
        <img
          key={`ken-burns-${url}`}
          className={styles.kenBurnsImage}
          style={{ zIndex: 3 - index }}
          src={url}
          alt=""
          data-animating={index === 0 || transitioning}
          data-hidden={transitioning && index === 0}
        />
      ))}
    </div>
  );
};

const MusicPreview = () => {
  const coverUrls = useCoverUrls();
  return (
    <motion.div className={styles.previewFill} style={{ zIndex: 1 }} {...previewSlideRight}>
      {coverUrls.length ? (
        <KenBurns urls={coverUrls} />
      ) : (
        <div className={styles.previewCard}>
          <h3 className={styles.previewText}>No favorites yet</h3>
        </div>
      )}
    </motion.div>
  );
};

const GamesPreview = () => (
  <div className={styles.previewCard}>
    <img className={styles.previewImage} src="/sites/ipod/dice.svg" alt="" />
    <h3 className={styles.previewText}>Games</h3>
  </div>
);

/** Large avatar for the highlighted social link (initials if it can't load). */
const LinkPreview = ({ link }: { link?: ProfileLink }) => (
  <div className={styles.previewCard}>
    {link && <Avatar key={link.avatarUrl} className={styles.previewAvatar} src={link.avatarUrl} size={64} />}
    <h3 className={styles.previewText}>{link?.label ?? profile.name}</h3>
    <h3 className={styles.previewSubtext}>@{profile.handle}</h3>
  </div>
);

const NowPlayingPreview = () => {
  const { nowPlayingItem } = useAudioPlayer();
  return nowPlayingItem ? (
    <img
      className={styles.nowPlayingArtwork}
      src={nowPlayingItem.coverArt}
      alt={`${nowPlayingItem.title} cover art`}
    />
  ) : (
    <MusicPreviewStatic />
  );
};

const MusicPreviewStatic = () => <KenBurns urls={useCoverUrls()} />;

const renderStaticPreview = (preview: Exclude<PreviewId, "music">) => {
  if (preview === "games") return <GamesPreview />;
  if (preview === "nowPlaying") return <NowPlayingPreview />;
  return <LinkPreview link={profile.links[Number(preview.slice("link-".length))]} />;
};

export const PreviewPanel = ({ isHidden }: { isHidden: boolean }) => {
  const { preview } = useViewContext();

  return (
    <div className={styles.previewPanel} data-hidden={isHidden}>
      {/* The music preview slides in; the others simply appear. */}
      <AnimatePresence>{preview === "music" && <MusicPreview />}</AnimatePresence>
      {preview !== "music" && renderStaticPreview(preview)}
    </div>
  );
};
