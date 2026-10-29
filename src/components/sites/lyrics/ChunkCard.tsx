"use client";

import { Clock, Loader2, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { chunkStart, countSyllables, formatTime } from "@/lib/lyrics/chunks";
import { cn } from "@/lib/utils";
import { SYLLABLE_TOLERANCE, type LyricChunk, type LyricLine } from "@/types/lyrics";

const LABELS = ["Intro", "Verse 1", "Verse 2", "Verse 3", "Pre-Chorus", "Chorus", "Bridge", "Outro"];

interface ChunkCardProps {
  chunk: LyricChunk;
  offset: number;
  admin: boolean;
  editing: boolean;
  showOriginal: boolean;
  /** Index of the line playing now, or -1. */
  activeLine: number;
  currentTime: number;
  /** Whether clicking plays from here (false when only a BandLab player or nothing is linked). */
  seekable: boolean;
  /** The admin's tools: AI assist, timing, and chunk labels. The editor login only writes lines. */
  fullEditor: boolean;
  onSelect: () => void;
  onChange: (chunk: LyricChunk) => void;
  onAssist: (direction: string) => Promise<string | null>;
}

/**
 * One lyric chunk, styled as an iPod menu row: the chunk playing now gets the blue selection.
 * Clicking it seeks the player there and plays (when seekable); for the admin it also opens the editor:
 * parody lines, syllable counts, per-line timestamps, and the AI assist.
 */
export function ChunkCard({
  chunk,
  offset,
  admin,
  editing,
  showOriginal,
  activeLine,
  currentTime,
  seekable,
  fullEditor,
  onSelect,
  onChange,
  onAssist,
}: ChunkCardProps) {
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const start = chunkStart(chunk, offset);
  const playingHere = activeLine >= 0;

  const setLine = (index: number, patch: Partial<LyricLine>) =>
    onChange({ ...chunk, lines: chunk.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  /** Shifts every timed line in the chunk, so its start moves without changing the spacing. */
  const shift = (delta: number) =>
    onChange({ ...chunk, lines: chunk.lines.map((l) => (l.time === null ? l : { ...l, time: Math.max(0, l.time + delta) })) });
  const stampStart = () => {
    const raw = Math.max(0, currentTime - offset);
    const first = chunk.lines.find((l) => l.time !== null)?.time;
    if (first === undefined || first === null) setLine(0, { time: raw });
    else shift(raw - first);
  };

  const assist = async () => {
    setBusy(true);
    setMessage(null);
    setMessage(await onAssist(direction));
    setBusy(false);
  };

  return (
    <section
      onClick={onSelect}
      data-active={playingHere && !editing}
      className={cn("px-4 py-4 sm:px-5", (seekable || admin) && "lx-row cursor-pointer", editing && "bg-(--lx-hover)")}
    >
      <header className="mb-2 flex items-center gap-3">
        <h3 className="lx-accent text-[11px] font-bold uppercase tracking-[0.12em]">{chunk.label}</h3>
        {start !== null && <span className="lx-sub text-[11px] tabular-nums">{formatTime(start)}</span>}
      </header>

      {!editing && (
        <div className="space-y-0.5">
          {chunk.lines.map((line, i) => {
            const text = line.parody.trim() || line.original;
            return (
              <div key={line.id}>
                <p
                  className={cn(
                    "text-lg font-semibold leading-snug sm:text-xl",
                    playingHere && i !== activeLine && "opacity-70",
                    !line.parody.trim() && admin && "italic opacity-45"
                  )}
                >
                  {text}
                </p>
                {showOriginal && line.parody.trim() && <p className="lx-sub text-sm">{line.original}</p>}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div onClick={(e) => e.stopPropagation()} className="cursor-default space-y-4">
          {fullEditor && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                list="lyrics-chunk-labels"
                value={chunk.label}
                onChange={(e) => onChange({ ...chunk, label: e.target.value.slice(0, 40) })}
                className="lx-input w-36"
                aria-label="Chunk label"
              />
              <datalist id="lyrics-chunk-labels">
                {LABELS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <span className="lx-sub text-xs">Sync</span>
              <button type="button" onClick={() => shift(-0.5)} className="lx-chip" aria-label="Shift chunk earlier">
                <Minus className="size-3" /> 0.5s
              </button>
              <button type="button" onClick={() => shift(0.5)} className="lx-chip" aria-label="Shift chunk later">
                <Plus className="size-3" /> 0.5s
              </button>
              <button type="button" onClick={stampStart} className="lx-chip" title="Move this chunk so it starts at the player's current time">
                <Clock className="size-3" /> Start at {formatTime(currentTime)}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {chunk.lines.map((line, i) => {
              const target = countSyllables(line.original);
              const got = countSyllables(line.parody);
              return (
                <div key={line.id} className="space-y-1">
                  <div className="lx-sub flex items-baseline gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{line.original}</span>
                    <span className="tabular-nums">{target} syl</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={line.parody}
                      onChange={(e) => setLine(i, { parody: e.target.value.slice(0, 300) })}
                      placeholder="Write your parody line, or half of one…"
                      className="lx-input min-w-0 flex-1"
                    />
                    <span
                      className={cn(
                        "w-10 shrink-0 text-right text-xs tabular-nums",
                        !line.parody ? "lx-faint" : Math.abs(got - target) <= SYLLABLE_TOLERANCE ? "lx-accent" : "lx-warn"
                      )}
                    >
                      {line.parody ? got : "–"}
                    </span>
                    {fullEditor && (
                      <>
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={line.time ?? ""}
                          onChange={(e) => setLine(i, { time: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                          className="lx-input w-20 shrink-0 tabular-nums"
                          aria-label="Line time in seconds"
                          placeholder="sec"
                        />
                        <button
                          type="button"
                          onClick={() => setLine(i, { time: Math.max(0, Math.round((currentTime - offset) * 10) / 10) })}
                          className="lx-chip shrink-0"
                          title="Stamp this line at the player's current time"
                          aria-label="Stamp line at current time"
                        >
                          <Clock className="size-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {fullEditor ? (
            <div className="lx-screen space-y-2 p-3">
              <textarea
                value={direction}
                onChange={(e) => setDirection(e.target.value.slice(0, 1000))}
                rows={2}
                placeholder="Extra direction for this chunk only (optional): e.g. this verse is the cat's side of the story"
                className="lx-input w-full resize-none"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void assist()} disabled={busy} className="lx-button px-4 py-1.5 text-sm">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  AI Parody Assist
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...chunk, lines: chunk.lines.map((l) => ({ ...l, parody: "" })) })}
                  className="lx-chip"
                >
                  <Trash2 className="size-3" /> Clear parody
                </button>
                {message && <span className="lx-sub text-xs">{message}</span>}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onChange({ ...chunk, lines: chunk.lines.map((l) => ({ ...l, parody: "" })) })}
              className="lx-chip"
            >
              <Trash2 className="size-3" /> Clear parody
            </button>
          )}
        </div>
      )}
    </section>
  );
}
