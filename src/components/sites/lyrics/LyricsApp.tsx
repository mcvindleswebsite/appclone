"use client";

import { ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Lock, Monitor, Moon, Music, Play, Plus, Save, Search, Sun, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildChunks, chunkStart, formatTime } from "@/lib/lyrics/chunks";
import { bandlabEmbedUrl, parseRecording } from "@/lib/lyrics/recording";
import { parseYouTubeId } from "@/lib/lyrics/youtube-id";
import { cn } from "@/lib/utils";
import type { LyricChunk, LyricsSource, Parody, ParodyAssistResponse, SongMeta, VideoCandidate } from "@/types/lyrics";

import { ChunkCard } from "./ChunkCard";
import { MediaBar } from "./MediaBar";
import { useTrackPlayer, type TrackSource } from "./useTrackPlayer";

const KEY_STORAGE = "vindle_lyrics_key";
const THEME_STORAGE = "vindle_lyrics_theme";
type Theme = "system" | "light" | "dark";
const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

const errorOf = async (response: Response) =>
  ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${response.status})`;

export function LyricsApp() {
  const [theme, setTheme] = useState<Theme>("system");
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

  const [videoInput, setVideoInput] = useState("");
  const [videos, setVideos] = useState<VideoCandidate[]>([]);
  const [findingVideo, setFindingVideo] = useState(false);
  const [recordingInput, setRecordingInput] = useState("");
  /** In the studio, sync against the original song or preview the parody recording. */
  const [listenTo, setListenTo] = useState<"original" | "parody">("original");

  // Visitors hear only the parody recording; the original song is for syncing in the studio.
  const recording = active?.recording ?? null;
  const youtubeRecording = recording?.kind === "youtube" ? recording.id : null;
  const playingParody = !admin || listenTo === "parody";
  const syncOffset = !active ? 0 : playingParody ? (active.recordingOffset ?? 0) : active.offset;
  let source: TrackSource | null = null;
  if (active && playingParody && youtubeRecording) {
    source = { key: `parody:${active.id}:${youtubeRecording}`, youtubeId: youtubeRecording, previewUrl: null, durationSec: 0 };
  } else if (active && !playingParody) {
    const { song } = active;
    source = { key: `original:${active.id}:${song.youtubeId ?? ""}`, youtubeId: song.youtubeId, previewUrl: song.previewUrl, durationSec: song.durationMs / 1000 };
  }
  const player = useTrackPlayer(source);
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

  // Restore the theme and a saved passcode after mount, then load (drafts included when it still works).
  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE);
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
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

  const cycleTheme = () => {
    const next = NEXT_THEME[theme];
    setTheme(next);
    if (next === "system") localStorage.removeItem(THEME_STORAGE);
    else localStorage.setItem(THEME_STORAGE, next);
  };

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
    setVideos([]);
    setVideoInput("");
    setRecordingInput("");
    setListenTo("original");
    const url = new URL(window.location.href);
    if (parody) url.searchParams.set("p", parody.id);
    else url.searchParams.delete("p");
    window.history.replaceState(null, "", url);
  };

  const update = (patch: Partial<Parody>) => {
    setActive((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  };
  const setVideo = (youtubeId: string | null) => {
    setActive((p) => (p ? { ...p, song: { ...p.song, youtubeId } } : p));
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

  /** Looks up YouTube uploads of the song; with `pick`, links the best length match. */
  const findVideo = async (song: SongMeta, pick: boolean) => {
    setFindingVideo(true);
    try {
      const params = new URLSearchParams({ title: song.title, artist: song.artist, duration: String(Math.round(song.durationMs / 1000)) });
      const response = await fetch(`/api/lyrics/video?${params}`, { headers });
      if (!response.ok) {
        if (!pick) setStatus(await errorOf(response));
        return;
      }
      const found = ((await response.json()) as { videos: VideoCandidate[] }).videos;
      setVideos(found);
      if (pick && found[0]) setVideo(found[0].id);
    } finally {
      setFindingVideo(false);
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
    void findVideo(song, true);
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

  const linkVideo = (event: React.FormEvent) => {
    event.preventDefault();
    const id = parseYouTubeId(videoInput);
    if (!id) {
      setStatus("That doesn't look like a YouTube link.");
      return;
    }
    setVideo(id);
    setVideoInput("");
    setStatus(null);
  };

  const linkRecording = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseRecording(recordingInput);
    if (!parsed) {
      setStatus("Paste a YouTube link, a BandLab post link (bandlab.com/post/…), or BandLab’s embed code.");
      return;
    }
    update({ recording: parsed });
    setRecordingInput("");
    setStatus(null);
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
        brief: active.brief ?? "",
        direction,
        context,
      }),
    }).catch(() => null);
    if (!response?.ok) return response ? await errorOf(response) : "Network error";
    const result = (await response.json()) as ParodyAssistResponse;
    updateChunk({ ...chunk, lines: chunk.lines.map((l, i) => ({ ...l, parody: result.lines[i] ?? l.parody })) });
    return `Theme: ${result.analysis.theme} · Rhyme ${result.analysis.rhymeScheme}`;
  };

  // The line playing now; only a YouTube video (not a preview) follows the song's timeline.
  const activeLineId = useMemo(() => {
    if (!active || !source?.youtubeId || player.time <= 0) return null;
    let current: string | null = null;
    for (const chunk of active.chunks) {
      for (const line of chunk.lines) {
        if (line.time !== null && line.time + syncOffset <= player.time + 0.15) current = line.id;
      }
    }
    return current;
  }, [active, source?.youtubeId, syncOffset, player.time]);

  const ThemeIcon = THEME_ICON[theme];
  const trackSeconds = active ? Math.round(active.song.durationMs / 1000) : 0;

  return (
    <div className="lx pb-32" data-theme={theme === "system" ? undefined : theme}>
      {/* Hidden admin entry: an invisible 40x40 hit area in the top-right corner. */}
      <button
        type="button"
        aria-label="Admin"
        onClick={() => !admin && setGateOpen(true)}
        className="fixed right-0 top-0 z-50 size-10 cursor-default opacity-0"
      />

      {/* The iPod title bar. */}
      <header className="lx-bar sticky top-0 z-40 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto grid h-9 max-w-5xl grid-cols-[1fr_auto_1fr] items-center px-3">
          <div className="flex items-center">
            {active && (
              <button type="button" onClick={() => open(null)} className="flex items-center text-[13px] font-semibold">
                <ChevronLeft className="size-4" /> Parodies
              </button>
            )}
          </div>
          <h1 className="truncate text-[14px] font-semibold">{active ? active.song.title : "Vindle Parodies"}</h1>
          <div className="mr-10 flex items-center justify-end gap-3">
            {player.playing && <Play className="lx-accent size-3 fill-current" aria-label="Playing" />}
            {admin && (
              <button type="button" onClick={() => void lock()} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide" aria-label="Lock studio">
                <Lock className="size-3" /> Studio
              </button>
            )}
            <button type="button" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`}>
              <ThemeIcon className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-5">
        {status && <p className="lx-screen mb-4 px-3 py-2 text-sm">{status}</p>}
        {admin && !storage && (
          <p className="lx-screen lx-warn mb-4 px-3 py-2 text-sm">Storage isn&apos;t configured (Upstash Redis env vars), so parodies can&apos;t be saved.</p>
        )}

        {!active && (
          <>
            {admin && (
              <div className="mb-5">
                {!searchOpen ? (
                  <button type="button" onClick={() => setSearchOpen(true)} className="lx-button px-4 py-2 text-sm">
                    <Plus className="size-4" /> New parody
                  </button>
                ) : (
                  <div className="lx-screen">
                    <form onSubmit={(e) => void runSearch(e)} className="lx-bar flex gap-2 p-2">
                      <div className="relative flex-1">
                        <Search className="lx-faint pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a song" className="lx-input w-full pl-9" />
                      </div>
                      <button type="submit" disabled={searching} className="lx-button px-4 text-sm">
                        {searching ? <Loader2 className="size-4 animate-spin" /> : "Search"}
                      </button>
                      <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="px-1">
                        <X className="size-4" />
                      </button>
                    </form>

                    {pasteFor && (
                      <div className="space-y-2 p-3">
                        <p className="lx-sub text-sm">Paste the lyrics for {pasteFor.title}. Leave a blank line between verses.</p>
                        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} className="lx-input w-full" />
                        <button type="button" disabled={!pasted.trim()} onClick={() => startParody(pasteFor, buildChunks(pasted, null))} className="lx-button px-4 py-1.5 text-sm">
                          Use these lyrics
                        </button>
                      </div>
                    )}

                    <ul className="lx-divide">
                      {results.map((song) => (
                        <li key={song.id}>
                          <button type="button" onClick={() => void pickSong(song)} disabled={searching} className="lx-row flex w-full items-center gap-3 px-3 py-2 text-left">
                            {/* eslint-disable-next-line @next/next/no-img-element -- remote iTunes artwork */}
                            <img src={song.artwork.replace("1200x1200", "120x120")} alt="" className="size-10 object-cover" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{song.title}</span>
                              <span className="lx-sub block truncate text-xs">
                                {song.artist} · {song.album}
                              </span>
                            </span>
                            <ChevronRight className="lx-faint size-4 shrink-0" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="lx-faint grid place-items-center py-24">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : parodies.length === 0 ? (
              <div className="lx-screen lx-sub grid place-items-center gap-2 py-20 text-center">
                <Music className="size-8" />
                <p>No parodies published yet.</p>
              </div>
            ) : (
              // The library as an iPod menu: artwork, title, artist, chevron.
              <ul className="lx-screen lx-divide">
                {parodies.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => open(p)} className="lx-row flex w-full items-center gap-3 px-3 py-2 text-left">
                      {p.song.artwork ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote iTunes artwork
                        <img src={p.song.artwork.replace("1200x1200", "160x160")} alt="" className="size-14 shrink-0 object-cover" />
                      ) : (
                        <div className="grid size-14 shrink-0 place-items-center bg-(--lx-panel) text-white">
                          <Music className="size-5" />
                        </div>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{p.title}</span>
                        <span className="lx-sub block truncate text-[13px]">
                          {p.song.artist} · {p.song.title}
                        </span>
                      </span>
                      {!p.published && <span className="lx-warn shrink-0 text-[10px] font-bold uppercase tracking-wide">Draft</span>}
                      <ChevronRight className="lx-faint size-4 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {active && (
          <article className="space-y-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
              {active.song.artwork && (
                // eslint-disable-next-line @next/next/no-img-element -- remote iTunes artwork
                <img src={active.song.artwork} alt={`${active.song.album} artwork`} className="size-48 shrink-0 object-cover shadow-[0_12px_30px_-12px_rgba(0,0,0,0.5)] sm:size-56" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="lx-accent text-[11px] font-bold uppercase tracking-[0.12em]">Parody</p>
                {admin ? (
                  <input
                    value={active.title}
                    onChange={(e) => update({ title: e.target.value.slice(0, 200) })}
                    className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none sm:text-4xl"
                    aria-label="Parody title"
                  />
                ) : (
                  <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{active.title}</h2>
                )}
                <p className="text-base">
                  {active.song.title} · <span className="font-semibold">{active.song.artist}</span>
                </p>
                <p className="lx-sub text-sm">{active.song.album}</p>
                <div className="pt-2">
                  <button type="button" onClick={() => setShowOriginal((v) => !v)} className="lx-chip">
                    {showOriginal ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    {showOriginal ? "Hide original" : "Show original"}
                  </button>
                </div>
              </div>
              {admin && !playingParody && active.song.youtubeId && (
                <div ref={player.mount} className="aspect-video w-full shrink-0 overflow-hidden rounded-md bg-black sm:w-72" />
              )}
            </div>

            {admin && (
              <label className="lx-screen block space-y-1.5 p-3">
                <span className="text-xs font-semibold">
                  What&apos;s this parody about? <span className="lx-sub font-normal">(only you see this; the AI reads it for every verse)</span>
                </span>
                <textarea
                  value={active.brief ?? ""}
                  onChange={(e) => update({ brief: e.target.value.slice(0, 2000) })}
                  rows={3}
                  placeholder="e.g. My cat Mochi refuses to get off my keyboard while I work from home. She's dramatic, judges my code, and only moves for tuna."
                  className="lx-input w-full resize-y"
                />
              </label>
            )}

            {admin && (
              <div className="lx-screen space-y-2 p-3">
                <p className="text-xs font-semibold">
                  Original song video <span className="lx-sub font-normal">(only you see this)</span>{" "}
                  <span className="lx-sub font-normal">
                    {active.song.youtubeId ? `· ${active.song.youtubeId}` : "· none linked, so only the 30s preview plays"}
                  </span>
                </p>
                <form onSubmit={linkVideo} className="flex flex-wrap gap-2">
                  <input value={videoInput} onChange={(e) => setVideoInput(e.target.value)} placeholder="Paste a YouTube or YouTube Music link" className="lx-input min-w-0 flex-1" />
                  <button type="submit" className="lx-chip">Link</button>
                  <button type="button" onClick={() => void findVideo(active.song, false)} disabled={findingVideo} className="lx-chip">
                    {findingVideo ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />} Find
                  </button>
                  {active.song.youtubeId && (
                    <button type="button" onClick={() => setVideo(null)} className="lx-chip" aria-label="Unlink video">
                      <X className="size-3" />
                    </button>
                  )}
                </form>
                {videos.length > 0 && (
                  <ul className="lx-divide overflow-hidden rounded-md border border-(--lx-divider)">
                    {videos.map((v) => (
                      <li key={v.id}>
                        <button type="button" onClick={() => setVideo(v.id)} data-active={v.id === active.song.youtubeId} className="lx-row flex w-full items-center gap-3 px-2 py-1.5 text-left">
                          {/* eslint-disable-next-line @next/next/no-img-element -- remote YouTube thumbnail */}
                          <img src={v.thumbnail} alt="" className="h-9 w-16 shrink-0 object-cover" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">{v.title}</span>
                            <span className="lx-sub block truncate text-[11px]">
                              {v.channel} · {formatTime(v.durationSec)}
                              {trackSeconds > 0 && ` (${v.durationSec - trackSeconds >= 0 ? "+" : ""}${v.durationSec - trackSeconds}s vs track)`}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="lx-faint text-[11px]">Lyric times follow the video. If it has an intro, move the Offset slider until the lyrics line up.</p>
              </div>
            )}

            {admin && (
              <div className="lx-bar sticky top-[calc(2.25rem+env(safe-area-inset-top))] z-20 -mx-4 flex flex-wrap items-center gap-3 px-4 py-2">
                {youtubeRecording && (
                  <div className="flex overflow-hidden rounded-full border border-(--lx-border) text-xs font-semibold">
                    {(["original", "parody"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setListenTo(v)} data-active={listenTo === v} className="lx-row px-3 py-1">
                        {v === "original" ? "Original" : "My recording"}
                      </button>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs" title={playingParody ? "Lines up the lyrics with your recording" : "Lines up the lyrics with the original video"}>
                  {playingParody ? "Recording offset" : "Offset"}
                  <input
                    type="range"
                    min={playingParody ? -60 : -30}
                    max={playingParody ? 60 : 30}
                    step={0.1}
                    value={syncOffset}
                    onChange={(e) => update(playingParody ? { recordingOffset: Number(e.target.value) } : { offset: Number(e.target.value) })}
                    className="w-28 accent-[rgb(52,122,181)]"
                  />
                  <span className="w-12 tabular-nums">
                    {syncOffset > 0 ? "+" : ""}
                    {syncOffset.toFixed(1)}s
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={active.published} onChange={(e) => update({ published: e.target.checked })} className="accent-[rgb(52,122,181)]" />
                  Published
                </label>
                <div className="ml-auto flex items-center gap-2">
                  {dirty && <span className="lx-warn text-xs font-semibold">Unsaved</span>}
                  <button type="button" onClick={() => void remove()} className="lx-chip" aria-label="Delete parody">
                    <Trash2 className="size-3" />
                  </button>
                  <button type="button" onClick={() => void save()} disabled={saving} className="lx-button px-4 py-1.5 text-sm">
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                  </button>
                </div>
              </div>
            )}

            <div className="lx-screen lx-divide">
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
                    seekable={!!source}
                    onSelect={() => {
                      if (admin) setEditingChunk(chunk.id);
                      if (source) void player.playAt(chunkStart(chunk, syncOffset) ?? 0);
                    }}
                    onChange={updateChunk}
                    onAssist={(direction) => assist(chunk, direction)}
                  />
                );
              })}
            </div>

            {(recording || admin) && (
              <section className="space-y-3 pt-2">
                <h3 className="lx-accent text-[11px] font-bold uppercase tracking-[0.12em]">Listen to the parody</h3>
                {recording?.kind === "youtube" &&
                  (playingParody ? (
                    <div ref={player.mount} className="aspect-video w-full max-w-2xl overflow-hidden rounded-md bg-black" />
                  ) : (
                    <button type="button" onClick={() => setListenTo("parody")} className="lx-chip">
                      <Play className="size-3 fill-current" /> Play my recording
                    </button>
                  ))}
                {recording?.kind === "bandlab" && (
                  <iframe
                    src={bandlabEmbedUrl(recording.id)}
                    title={`${active.title} on BandLab`}
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    className="h-[360px] w-full max-w-2xl rounded-md border-0"
                  />
                )}
                {admin && (
                  <div className="lx-screen space-y-2 p-3">
                    <p className="text-xs font-semibold">
                      Your parody recording{" "}
                      <span className="lx-sub font-normal">
                        {recording ? `· ${recording.kind === "youtube" ? "YouTube" : "BandLab"}` : "· this is what visitors hear"}
                      </span>
                    </p>
                    <form onSubmit={linkRecording} className="flex flex-wrap gap-2">
                      <input
                        value={recordingInput}
                        onChange={(e) => setRecordingInput(e.target.value)}
                        placeholder="Paste a YouTube link or a BandLab post link"
                        className="lx-input min-w-0 flex-1"
                      />
                      <button type="submit" className="lx-chip">
                        Link
                      </button>
                      {recording && (
                        <button type="button" onClick={() => update({ recording: null })} className="lx-chip" aria-label="Unlink recording">
                          <X className="size-3" />
                        </button>
                      )}
                    </form>
                    <p className="lx-faint text-[11px]">
                      {recording?.kind === "bandlab"
                        ? "BandLab plays in its own player, so visitors can’t tap a verse to jump to it. Use a YouTube upload for that."
                        : "With a YouTube recording, visitors can tap any verse to jump to it. Switch to My recording above and set the recording offset so the lyrics line up."}
                    </p>
                  </div>
                )}
              </section>
            )}
          </article>
        )}
      </main>

      {gateOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={() => setGateOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => void unlock(e)} className="lx-screen w-full max-w-xs shadow-2xl">
            <p className="lx-bar flex items-center justify-center gap-2 py-1.5 text-[13px] font-semibold">
              <Lock className="size-3.5" /> Studio
            </p>
            <div className="space-y-3 p-4">
              <input
                autoFocus
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Passcode"
                className={cn("lx-input w-full", gateError && "border-(--lx-danger)")}
                aria-label="Passcode"
              />
              {gateError && <p className="lx-danger text-xs">{gateError}</p>}
              <button type="submit" className="lx-button w-full py-2 text-sm">
                Unlock
              </button>
            </div>
          </form>
        </div>
      )}

      {active && source && (
        <MediaBar
          artwork={active.song.artwork || null}
          title={playingParody ? active.title : active.song.title}
          subtitle={playingParody ? `Parody of ${active.song.title} · ${active.song.artist}` : active.song.artist}
          sourceLabel={playingParody ? "Parody" : active.song.youtubeId ? "Original" : "Preview"}
          player={player}
        />
      )}
    </div>
  );
}
