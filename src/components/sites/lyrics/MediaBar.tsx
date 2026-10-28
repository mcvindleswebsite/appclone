"use client";

import { Music, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { formatTime } from "@/lib/lyrics/chunks";
import type { SongMeta } from "@/types/lyrics";

import type { TrackPlayer } from "./useTrackPlayer";

/** The iPod Now Playing bar: glossy blue fill, diamond knob, over a transparent range input. */
function Scrubber({ value, max, onChange, disabled, label }: { value: number; max: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  const percent = max > 0 ? (Math.min(value, max) / max) * 100 : 0;
  return (
    <div className="lx-scrub min-w-0 flex-1">
      <div className="lx-scrub-track" />
      <div className="lx-scrub-fill" style={{ width: `${percent}%` }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from the iPod kit */}
      <img src="/sites/ipod/diamond.svg" alt="" className="lx-scrub-knob" style={{ left: `${percent}%` }} />
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.1}
        value={Math.min(value, max || 1)}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

/** The persistent bottom player: track info, play/pause, scrubber, times, volume, and the source. */
export function MediaBar({ song, player }: { song: SongMeta | null; player: TrackPlayer }) {
  const { engine, playing, time, duration, volume } = player;
  const max = Math.max(duration, time);

  return (
    <div className="lx-bar-top fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]">
      {player.notice && <p className="lx-sub border-b border-(--lx-divider) px-4 py-1.5 text-center text-xs">{player.notice}</p>}
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        {song?.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote iTunes artwork
          <img src={song.artwork.replace("1200x1200", "120x120")} alt="" className="size-11 shrink-0 rounded-sm object-cover shadow-sm" />
        ) : (
          <div className="lx-screen grid size-11 shrink-0 place-items-center">
            <Music className="lx-faint size-5" />
          </div>
        )}
        <div className="hidden w-40 min-w-0 shrink-0 sm:block">
          <p className="truncate text-sm font-semibold">{song?.title ?? "Nothing playing"}</p>
          <p className="lx-sub truncate text-xs">{song?.artist ?? "Pick a parody"}</p>
        </div>

        <button
          type="button"
          onClick={() => void player.toggle()}
          disabled={!song}
          aria-label={playing ? "Pause" : "Play"}
          className="lx-button size-10 shrink-0"
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-px fill-current" />}
        </button>

        <span className="w-10 shrink-0 text-right text-xs tabular-nums">{formatTime(time)}</span>
        <Scrubber value={time} max={max} onChange={player.seek} disabled={!song} label="Timeline" />
        <span className="w-10 shrink-0 text-xs tabular-nums">{formatTime(duration)}</span>

        <div className="hidden items-center gap-2 md:flex">
          <button type="button" onClick={() => player.setVolume(volume > 0 ? 0 : 0.8)} aria-label={volume > 0 ? "Mute" : "Unmute"}>
            {volume > 0 ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
          <div className="w-20">
            <Scrubber value={volume} max={1} onChange={player.setVolume} label="Volume" />
          </div>
        </div>

        {song && (
          <span className="lx-sub hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide sm:inline" title={engine === "preview" ? "Only a 30-second preview is linked" : "Full track from YouTube"}>
            {engine === "youtube" ? "YouTube" : "Preview"}
          </span>
        )}
      </div>
    </div>
  );
}
