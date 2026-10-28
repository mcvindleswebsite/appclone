"use client";

import { ArrowLeft, Eye, EyeOff, Loader2, Lock, Music, Plus, Save, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildChunks, chunkStart } from "@/lib/lyrics/chunks";
import { cn } from "@/lib/utils";
import type { LyricChunk, LyricsSource, Parody, ParodyAssistResponse, SongMeta } from "@/types/lyrics";

import { ChunkCard } from "./ChunkCard";
import { MediaBar } from "./MediaBar";
import { useTrackPlayer } from "./useTrackPlayer";

const KEY_STORAGE = "vindle_lyrics_key";

const errorOf = async (response: Response) =>
  ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${response.status})`;

export function LyricsApp() {
  const [adminKey, setAdminKey] = useState("");
  const [admin, setAdmin] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  const [parodies, setParodies] = useState<Parody[]>([]);
  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState(true);
  const [active, setActive] = useState<Parody | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editingChunk, setEditingChunk] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongMeta[]>([]);
  const [searching, setSearching] = useState(false);
  const [pasteFor, setPasteFor] = useState<SongMeta | null>(null);
  const [pasted, setPasted] = useState("");

  const player = useTrackPlayer(active?.song ?? null);
  const headers = useMemo(() => ({ "Content-Type": "application/json", "x-lyrics-key": adminKey }), [adminKey]);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/lyrics/parodies", { headers: { "x-lyrics-key": key }, cache: "no-store" });
      const data = (await response.json()) as { parodies?: Parody[]; storage?: boolean };
      const list = data.parodies ?? [];
      setParodies(list);
      setStorage(data.storage !== false);
      // Deep link: /lyrics?p=<id>
      const wanted = new URLSearchParams(window.location.search).get("p");
      if (wanted) setActive((current) => current ?? list.find((p) => p.id === wanted) ?? null);
    } catch {
      setStatus("Couldn't load parodies.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore a saved passcode after mount, then load (drafts included when it still works).
  useEffect(() => {
    const saved = localStorage.getItem(KEY_STORAGE) ?? "";
    (async () => {
      if (saved) {
        const ok = (await fetch("/api/lyrics/auth", { method: "POST", headers: { "x-lyrics-key": saved } }).catch(() => null))?.ok;
        if (ok) {
          setAdminKey(saved);
          setAdmin(true);
        } else localStorage.removeItem(KEY_STORAGE);
        await load(ok ? saved : "");
      } else await load("");
    })();
  }, [load]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setGateError(null);
    const response = await fetch("/api/lyrics/auth", { method: "POST", headers: { "x-lyrics-key": passcode } }).catch(() => null);
    if (!response?.ok) {
      setGateError(response ? await errorOf(response) : "Network error");
      return;
    }
    localStorage.setItem(KEY_STORAGE, passcode);
    setAdminKey(passcode);
    setAdmin(true);
    setGateOpen(false);
    setPasscode("");
    await load(passcode);
  };

  const lock = async () => {
    localStorage.removeItem(KEY_STORAGE);
    setAdminKey("");
    setAdmin(false);
    setEditingChunk(null);
    setSearchOpen(false);
    setActive(null);
    setDirty(false);
    await load("");
  };

  const open = (parody: Parody | null) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setActive(parody);
    setDirty(false);
    setEditingChunk(null);
    setStatus(null);
    const url = new URL(window.location.href);
    if (parody) url.searchParams.set("p", parody.id);
    else url.searchParams.delete("p");
    window.history.replaceState(null, "", url);
  };

  const update = (patch: Partial<Parody>) => {
    setActive((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  };
  const updateChunk = (chunk: LyricChunk) => {
    setActive((p) => (p ? { ...p, chunks: p.chunks.map((c) => (c.id === chunk.id ? chunk : c)) } : p));
    setDirty(true);
  };

  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/lyrics/search?q=${encodeURIComponent(query)}`, { headers });
      if (!response.ok) throw new Error(await errorOf(response));
      setResults(((await response.json()) as { songs: SongMeta[] }).songs);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const startParody = (song: SongMeta, chunks: LyricChunk[]) => {
    const now = Date.now();
    open({ id: crypto.randomUUID(), title: `${song.title} (Parody)`, song, chunks, offset: 0, published: false, createdAt: now, updatedAt: now });
    setDirty(true);
    setSearchOpen(false);
    setPasteFor(null);
    setPasted("");
    setEditingChunk(chunks[0]?.id ?? null);
  };

  const pickSong = async (song: SongMeta) => {
    setSearching(true);
    setStatus(null);
    try {
      const params = new URLSearchParams({ track: song.title, artist: song.artist, album: song.album, duration: String(Math.round(song.durationMs / 1000)) });
      const response = await fetch(`/api/lyrics/source?${params}`, { headers });
      const source = response.ok ? ((await response.json()) as LyricsSource) : null;
      if (!source?.chunks.length) {
        setPasteFor(song);
        setStatus(source?.instrumental ? "LRCLIB lists this as instrumental." : "No lyrics on LRCLIB — paste them below.");
        return;
      }
      startParody(song, source.chunks);
      setStatus(source.synced ? "Synced lyrics loaded from LRCLIB." : "Lyrics loaded without timestamps — stamp each chunk while it plays.");
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const response = await fetch("/api/lyrics/parodies", { method: "PUT", headers, body: JSON.stringify(active) });
      if (!response.ok) throw new Error(await errorOf(response));
      const { parody } = (await response.json()) as { parody: Parody };
      setActive(parody);
      setDirty(false);
      setParodies((list) => [parody, ...list.filter((p) => p.id !== parody.id)]);
      setStatus(parody.published ? "Saved and published." : "Saved as a draft.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!active || !window.confirm(`Delete "${active.title}"?`)) return;
    const response = await fetch(`/api/lyrics/parodies?id=${encodeURIComponent(active.id)}`, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404) {
      setStatus(await errorOf(response));
      return;
    }
    setParodies((list) => list.filter((p) => p.id !== active.id));
    setDirty(false);
    setActive(null);
    window.history.replaceState(null, "", "/lyrics");
  };

  const assist = async (chunk: LyricChunk, direction: string) => {
    if (!active) return null;
    const context = active.chunks
      .filter((c) => c.id !== chunk.id && c.lines.some((l) => l.parody.trim()))
      .map((c) => `[${c.label}]\n${c.lines.map((l) => l.parody.trim() || "…").join("\n")}`)
      .join("\n\n");
    const response = await fetch("/api/lyrics/parody", {
      method: "POST",
      headers,
      body: JSON.stringify({
        song: { title: active.song.title, artist: active.song.artist },
        label: chunk.label,
        lines: chunk.lines.map((l) => ({ original: l.original, parody: l.parody })),
        direction,
        context,
      }),
    }).catch(() => null);
    if (!response?.ok) return response ? await errorOf(response) : "Network error";
    const result = (await response.json()) as ParodyAssistResponse;
    updateChunk({ ...chunk, lines: chunk.lines.map((l, i) => ({ ...l, parody: result.lines[i] ?? l.parody })) });
    return `Theme: ${result.analysis.theme} · Rhyme ${result.analysis.rhymeScheme}`;
  };

  // The line playing now, only meaningful when the full track (not a preview) is playing.
  const activeLineId = useMemo(() => {
    if (!active || player.engine !== "apple" || player.time <= 0) return null;
    let current: string | null = null;
    for (const chunk of active.chunks) {
      for (const line of chunk.lines) {
        if (line.time !== null && line.time + active.offset <= player.time + 0.15) current = line.id;
      }
    }
    return current;
  }, [active, player.engine, player.time]);

  return (
    <div className="lyrics-app min-h-dvh bg-[#050D0A] pb-32 text-[#F5F7F4]">
      {/* Hidden admin entry: an invisible 40x40 hit area in the top-right corner. */}
      <button
        type="button"
        aria-label="Admin"
        onClick={() => !admin && setGateOpen(true)}
        className="fixed right-0 top-0 z-50 size-10 cursor-default opacity-0"
      />

      <header className="mx-auto flex max-w-5xl items-center gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4">
        {active ? (
          <button type="button" onClick={() => open(null)} className="flex items-center gap-1.5 text-sm text-[#F5F7F4]/70 hover:text-white">
            <ArrowLeft className="size-4" /> All parodies
          </button>
        ) : (
          <h1 className="text-lg font-bold tracking-tight">
            Vindle <span className="text-[#00DD94]">Parodies</span>
          </h1>
        )}
        {admin && (
          <span className="ml-auto mr-8 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#00DD94]">
            Studio
            <button type="button" onClick={() => void lock()} aria-label="Lock studio" className="text-[#F5F7F4]/50 hover:text-white">
              <Lock className="size-3.5" />
            </button>
          </span>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-5">
        {status && <p className="mb-4 rounded-lg border border-[#1E2638] bg-[#121824] px-3 py-2 text-sm text-[#F5F7F4]/80">{status}</p>}
        {admin && !storage && (
          <p className="mb-4 rounded-lg border border-[#FFB020]/40 px-3 py-2 text-sm text-[#FFB020]">
            Storage isn&apos;t configured (Upstash Redis env vars), so parodies can&apos;t be saved.
          </p>
        )}

        {!active && (
          <>
            {admin && (
              <div className="mb-6">
                {!searchOpen ? (
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="flex items-center gap-2 rounded-full bg-[#00DD94] px-4 py-2 text-sm font-semibold text-[#050D0A]"
                  >
                    <Plus className="size-4" /> New parody
                  </button>
                ) : (
                  <div className="rounded-2xl border border-[#1E2638] bg-[#121824] p-4">
                    <form onSubmit={(e) => void runSearch(e)} className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#F5F7F4]/40" />
                        <input
                          autoFocus
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search Apple Music for a song"
                          className="lyrics-input w-full pl-9"
                        />
                      </div>
                      <button type="submit" disabled={searching} className="rounded-lg bg-[#00DD94] px-4 text-sm font-semibold text-[#050D0A]">
                        {searching ? <Loader2 className="size-4 animate-spin" /> : "Search"}
                      </button>
                      <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="px-1 text-[#F5F7F4]/50">
                        <X className="size-4" />
                      </button>
                    </form>

                    {pasteFor && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm text-[#F5F7F4]/70">
                          Paste the lyrics for {pasteFor.title}. Leave a blank line between verses.
                        </p>
                        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} className="lyrics-input w-full" />
                        <button
                          type="button"
                          disabled={!pasted.trim()}
                          onClick={() => startParody(pasteFor, buildChunks(pasted, null))}
                          className="rounded-lg bg-[#00DD94] px-4 py-1.5 text-sm font-semibold text-[#050D0A] disabled:opacity-40"
                        >
                          Use these lyrics
                        </button>
                      </div>
                    )}

                    <ul className="mt-3 divide-y divide-[#1E2638]">
                      {results.map((song) => (
                        <li key={song.id}>
                          <button
                            type="button"
                            onClick={() => void pickSong(song)}
                            disabled={searching}
                            className="flex w-full items-center gap-3 py-2 text-left hover:bg-[#050D0A]/50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- remote Apple artwork */}
                            <img src={song.artwork.replace("1200x1200", "120x120")} alt="" className="size-10 rounded object-cover" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-white">{song.title}</span>
                              <span className="block truncate text-xs text-[#F5F7F4]/55">
                                {song.artist} · {song.album}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="grid place-items-center py-24 text-[#F5F7F4]/40">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : parodies.length === 0 ? (
              <div className="grid place-items-center gap-2 py-24 text-center text-[#F5F7F4]/45">
                <Music className="size-8" />
                <p>No parodies published yet.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {parodies.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => open(p)} className="group w-full text-left">
                      <div className="relative aspect-square overflow-hidden rounded-xl bg-[#121824]">
                        {p.song.artwork && (
                          // eslint-disable-next-line @next/next/no-img-element -- remote Apple artwork
                          <img
                            src={p.song.artwork.replace("1200x1200", "600x600")}
                            alt=""
                            className="size-full object-cover transition-transform group-hover:scale-[1.03]"
                          />
                        )}
                        {!p.published && (
                          <span className="absolute left-2 top-2 rounded-full bg-[#050D0A]/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#FFB020]">
                            Draft
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-white">{p.title}</p>
                      <p className="truncate text-xs text-[#F5F7F4]/55">{p.song.artist}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {active && (
          <article>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
              {active.song.artwork && (
                // eslint-disable-next-line @next/next/no-img-element -- remote Apple artwork
                <img
                  src={active.song.artwork}
                  alt={`${active.song.album} artwork`}
                  className="size-48 shrink-0 rounded-2xl object-cover shadow-[0_20px_60px_-20px_rgba(0,221,148,0.35)] sm:size-56"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#00DD94]">Parody</p>
                {admin ? (
                  <input
                    value={active.title}
                    onChange={(e) => update({ title: e.target.value.slice(0, 200) })}
                    className="w-full bg-transparent text-3xl font-bold tracking-tight text-white outline-none sm:text-4xl"
                    aria-label="Parody title"
                  />
                ) : (
                  <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{active.title}</h2>
                )}
                <p className="text-base text-[#F5F7F4]/80">
                  {active.song.title} · <span className="font-semibold">{active.song.artist}</span>
                </p>
                <p className="text-sm text-[#F5F7F4]/50">{active.song.album}</p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button type="button" onClick={() => setShowOriginal((v) => !v)} className="lyrics-chip">
                    {showOriginal ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    {showOriginal ? "Hide original" : "Show original"}
                  </button>
                </div>
              </div>
            </div>

            {admin && (
              <div className="sticky top-0 z-20 mt-6 flex flex-wrap items-center gap-3 border-y border-[#1E2638] bg-[#050D0A]/95 py-3 backdrop-blur">
                <label className="flex items-center gap-2 text-xs text-[#F5F7F4]/70">
                  Offset
                  <input
                    type="range"
                    min={-10}
                    max={10}
                    step={0.1}
                    value={active.offset}
                    onChange={(e) => update({ offset: Number(e.target.value) })}
                    className="lyrics-range w-28"
                    style={{ "--fill": `${((active.offset + 10) / 20) * 100}%` } as React.CSSProperties}
                  />
                  <span className="w-12 tabular-nums">
                    {active.offset > 0 ? "+" : ""}
                    {active.offset.toFixed(1)}s
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs text-[#F5F7F4]/70">
                  <input type="checkbox" checked={active.published} onChange={(e) => update({ published: e.target.checked })} className="accent-[#00DD94]" />
                  Published
                </label>
                <div className="ml-auto flex items-center gap-2">
                  {dirty && <span className="text-xs text-[#FFB020]">Unsaved</span>}
                  <button type="button" onClick={() => void remove()} className="lyrics-chip" aria-label="Delete parody">
                    <Trash2 className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-full bg-[#00DD94] px-4 py-1.5 text-sm font-semibold text-[#050D0A] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 space-y-2">
              {active.chunks.map((chunk) => {
                const activeLine = activeLineId ? chunk.lines.findIndex((l) => l.id === activeLineId) : -1;
                return (
                  <ChunkCard
                    key={chunk.id}
                    chunk={chunk}
                    offset={active.offset}
                    admin={admin}
                    editing={admin && editingChunk === chunk.id}
                    showOriginal={showOriginal}
                    activeLine={activeLine}
                    currentTime={player.time}
                    onSelect={() => {
                      if (admin) setEditingChunk(chunk.id);
                      void player.playAt(chunkStart(chunk, active.offset) ?? 0);
                    }}
                    onChange={updateChunk}
                    onAssist={(direction) => assist(chunk, direction)}
                  />
                );
              })}
            </div>
          </article>
        )}
      </main>

      {gateOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" onClick={() => setGateOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void unlock(e)}
            className="w-full max-w-xs space-y-3 rounded-2xl border border-[#1E2638] bg-[#121824] p-5"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Lock className="size-4 text-[#00DD94]" /> Studio passcode
            </p>
            <input
              autoFocus
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className={cn("lyrics-input w-full", gateError && "border-[#FF3B30]")}
              aria-label="Passcode"
            />
            {gateError && <p className="text-xs text-[#FF3B30]">{gateError}</p>}
            <button type="submit" className="w-full rounded-lg bg-[#00DD94] py-2 text-sm font-semibold text-[#050D0A]">
              Unlock
            </button>
          </form>
        </div>
      )}

      <MediaBar song={active?.song ?? null} player={player} />
    </div>
  );
}
