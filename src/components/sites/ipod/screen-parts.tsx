"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useAudioPlayer } from "./audio-context";
import { useViewContext } from "./ipod-context";
import type { ListOption } from "./types";
import styles from "./ipod.module.css";

/* eslint-disable @next/next/no-img-element -- tiny UI glyphs and remote cover art */

type BatteryManager = EventTarget & { charging: boolean; level: number };

/** Reads the Battery Status API where supported (Chromium); defaults to full. */
const useBattery = () => {
  const [state, setState] = useState({ percent: 100, isCharging: false });

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) return;
    let battery: BatteryManager | null = null;
    const update = () => {
      if (battery) {
        setState({ percent: Math.round(battery.level * 100), isCharging: battery.charging });
      }
    };
    nav
      .getBattery()
      .then((manager) => {
        battery = manager;
        manager.addEventListener("levelchange", update);
        manager.addEventListener("chargingchange", update);
        update();
      })
      .catch(() => undefined);
    return () => {
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);

  return state;
};

const BatteryIndicator = () => {
  const { percent, isCharging } = useBattery();
  const width = Math.max(percent, 15);
  const color = percent > 20 || isCharging ? "#A5E07F" : "#D17F6B";

  return (
    <div className={styles.battery} aria-label={`Battery ${percent}%`}>
      <div className={styles.batteryBody}>
        <div
          className={styles.batteryLevel}
          style={{ width: `${width}%`, "--battery-color": color } as CSSProperties}
        />
      </div>
      <div className={styles.batteryCap} />
    </div>
  );
};

export const Header = () => {
  const { headerTitle } = useViewContext();
  const { playbackInfo } = useAudioPlayer();

  return (
    <div className={styles.header}>
      <h3 className={styles.headerText}>{headerTitle}</h3>
      <div className={styles.headerIcons}>
        {playbackInfo.isPlaying && (
          <img className={styles.headerIcon} src="/sites/ipod/play.svg" alt="Playing" />
        )}
        {playbackInfo.isPaused && (
          <img className={styles.headerIcon} src="/sites/ipod/pause.svg" alt="Paused" />
        )}
        <BatteryIndicator />
      </div>
    </div>
  );
};

type SelectableListProps = {
  options: ListOption[];
  activeIndex: number;
  emptyMessage?: string;
};

export const SelectableList = ({
  options,
  activeIndex,
  emptyMessage = "Nothing to see here",
}: SelectableListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { nowPlayingItem, playbackInfo } = useAudioPlayer();

  // Scroll only the view's own scroller, vertically. scrollIntoView would also
  // scroll the overflow:hidden panels sideways while views slide in.
  useEffect(() => {
    const item = containerRef.current?.children[activeIndex] as HTMLElement | undefined;
    const scroller = item?.closest<HTMLElement>("[data-scroller]");
    if (!item || !scroller) return;
    const itemTop = item.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < 0) {
      scroller.scrollTop += itemTop;
    } else if (itemBottom > scroller.clientHeight) {
      scroller.scrollTop += itemBottom - scroller.clientHeight;
    }
  }, [activeIndex]);

  if (!options.length) {
    return <div className={styles.emptyMessage}>{emptyMessage}</div>;
  }

  return (
    <div ref={containerRef} className={styles.list}>
      {options.map((option, index) => {
        const isActive = index === activeIndex;
        const isPlayingSong =
          option.type === "song" &&
          option.queue[option.startIndex]?.id === nowPlayingItem?.id &&
          playbackInfo.isPlaying;
        const content = (
          <>
            {option.imageUrl && (
              <img className={styles.listImage} src={option.imageUrl} alt="" />
            )}
            <div className={styles.listLabelContainer}>
              <h3 className={styles.listLabel}>{option.label}</h3>
              {option.sublabel && (
                <h3 className={styles.listSublabel}>{option.sublabel}</h3>
              )}
            </div>
            {isActive && (
              <img className={styles.listIcon} src="/sites/ipod/arrow_right.svg" alt="" />
            )}
            {isPlayingSong && !isActive && (
              <img
                className={styles.listIcon}
                src="/sites/ipod/volume_full.svg"
                alt="Now playing"
                style={{ width: 16, height: 16, marginRight: 8 }}
              />
            )}
          </>
        );

        // Real anchors keep outbound links crawlable and assistive-tech friendly.
        return option.type === "link" ? (
          <a
            key={`${option.label}-${index}`}
            className={styles.listItem}
            data-active={isActive}
            href={option.url}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={-1}
          >
            {content}
          </a>
        ) : (
          <div key={`${option.label}-${index}`} className={styles.listItem} data-active={isActive}>
            {content}
          </div>
        );
      })}
    </div>
  );
};
