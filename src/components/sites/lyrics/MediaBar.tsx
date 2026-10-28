"use client";

import { Loader2, Music, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { formatTime } from "@/lib/lyrics/chunks";
import type { SongMeta } from "@/types/lyrics";

import type { TrackPlayer } from "./useTrackPlayer";

/** The persistent bottom player: track info, play/pause, scrubber, times, volume, Apple Music status. */
export function MediaBar({ song, player }: { song: SongMeta | null; player: TrackPlayer }) {
  const { engine, playing, time, duration, volume } = player;
  const max = Math.max(duration, time, 1);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#1E2638] bg-[#050D0A]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {player.notice && <p className="border-b border-[#1E2638] px-4 py-1.5 text-center text-xs text-[#F5F7F4]/70">{player.notice}</p>}
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        {song?.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Apple artwork, any host
          <img src={song.artwork.replace("1200x1200", "120x120")} alt="" className="size-11 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="grid size-11 shrink-0 place-items-center rounded-md bg-[#121824] text-[#F5F7F4]/40">
            <Music className="size-5" />
          </div>
        )}
        <div className="hidden w-40 min-w-0 shrink-0 sm:block">
          <p className="truncate text-sm font-semibold text-white">{song?.title ?? "Nothing playing"}</p>
          <p className="truncate text-xs text-[#F5F7F4]/60">{song?.artist ?? "Pick a parody"}</p>
        </div>

        <button
          type="button"
          onClick={() => void player.toggle()}
          disabled={!song}
          aria-label={playing ? "Pause" : "Play"}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#00DD94] text-[#050D0A] transition-opacity disabled:opacity-40"
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-px fill-current" />}
        </button>

        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[#F5F7F4]/60">{formatTime(time)}</span>
        <input
          type="range"
          min={0}
          max={max}
          step={0.1}
          value={Math.min(time, max)}
          onChange={(e) => void player.seek(Number(e.target.value))}
          disabled={!song}
          aria-label="Timeline"
          className="lyrics-range min-w-0 flex-1"
          style={{ "--fill": `${(Math.min(time, max) / max) * 100}%` } as React.CSSProperties}
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-[#F5F7F4]/60">{formatTime(duration)}</span>

        <div className="hidden items-center gap-2 md:flex">
          <button type="button" onClick={() => player.setVolume(volume > 0 ? 0 : 0.8)} aria-label="Mute" className="text-[#F5F7F4]/70">
            {volume > 0 ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="lyrics-range w-20"
            style={{ "--fill": `${volume * 100}%` } as React.CSSProperties}
          />
        </div>

        {engine === "apple" ? (
          <button
            type="button"
            onClick={() => void player.disconnectApple()}
            className="shrink-0 rounded-full border border-[#00DD94]/40 px-3 py-1 text-[11px] font-semibold text-[#00DD94]"
            title="Playing full tracks through Apple Music. Click to disconnect."
          >
            Apple Music
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void player.connectApple()}
            disabled={player.connecting}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#1E2638] px-3 py-1 text-[11px] font-semibold text-[#F5F7F4]/80 hover:border-[#00DD94]/50"
            title="Sign in to Apple Music for full-length playback and synced seeking"
          >
            {player.connecting && <Loader2 className="size-3 animate-spin" />}
            <span className="hidden sm:inline">Connect</span> Apple Music
          </button>
        )}
      </div>
    </div>
  );
}
