"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { CheckResult, StockState } from "@/types/pokemon";

type Phase = "idle" | "standby" | "warmup" | "dropzone";

interface LogEntry {
  id: number;
  time: string;
  message: string;
  tone: "info" | "good" | "bad" | "warn";
}

interface Ping extends CheckResult {
  id: number;
  at: number;
}

const DEFAULT_URL = "https://www.pokemoncenter.com";
const WARMUP_MS = 10 * 60 * 1000;
const DROP_ZONE_MS = 60 * 1000;
const MAX_LOGS = 200;
const MAX_PINGS = 40;

const PHASES: Record<Phase, { label: string; intervalMs: number | null; message: string }> = {
  idle: { label: "IDLE", intervalMs: null, message: "Idle — Monitor disarmed" },
  standby: {
    label: "STANDBY",
    intervalMs: 60_000,
    message: "Standby — Awaiting pre-drop warmup window (polling every 60s)",
  },
  warmup: {
    label: "WARMUP",
    intervalMs: 30_000,
    message: "Pre-drop warmup — T-10 min window entered (polling every 30s)",
  },
  dropzone: {
    label: "DROP ZONE",
    intervalMs: 5_000,
    message: "Drop zone — Under 1 min to drop (polling every 5s)",
  },
};

const STOCK_LABELS: Record<StockState, string> = {
  in_stock: "IN STOCK",
  sold_out: "SOLD OUT",
  queue: "QUEUE",
  blocked: "BLOCKED",
  unknown: "UNKNOWN",
};

const STOCK_STYLES: Record<StockState, string> = {
  in_stock: "border-[#00ff88]/50 bg-[#00ff88]/10 text-[#00ff88]",
  sold_out: "border-[#ff3b3b]/50 bg-[#ff3b3b]/10 text-[#ff3b3b]",
  queue: "border-[#ffb800]/50 bg-[#ffb800]/10 text-[#ffb800]",
  blocked: "border-[#ffb800]/50 bg-[#ffb800]/10 text-[#ffb800]",
  unknown: "border-white/15 bg-white/5 text-white/50",
};

const LOG_TONES: Record<LogEntry["tone"], string> = {
  info: "text-white/70",
  good: "text-[#00ff88]",
  bad: "text-[#ff3b3b]",
  warn: "text-[#ffb800]",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats a timestamp as a `datetime-local` value in the viewer's timezone. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const getPhase = (armed: boolean, remainingMs: number) => {
  if (!armed) return "idle";
  if (remainingMs > WARMUP_MS) return "standby";
  if (remainingMs > DROP_ZONE_MS) return "warmup";
  return "dropzone";
};

/** Three rising sine notes through Web Audio, so no audio asset is needed. */
const playChime = (ctx: AudioContext | null) => {
  if (!ctx) return;
  void ctx.resume();
  [659.25, 830.61, 987.77, 1318.51].forEach((freq, i) => {
    const start = ctx.currentTime + i * 0.12;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  });
};

export function DropMonitor() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [dropTime, setDropTime] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [checking, setChecking] = useState(false);

  const logId = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const engine = useRef({
    url: DEFAULT_URL,
    dropMs: Number.NaN,
    armed: false,
    phase: "idle" as Phase,
    lastCheck: 0,
    inFlight: false,
    dropHit: false,
    stockHit: false,
  });

  const dropMs = dropTime ? new Date(dropTime).getTime() : Number.NaN;
  const remainingMs = now === null || Number.isNaN(dropMs) ? null : dropMs - now;
  const urlValid = isValidUrl(url);
  const lastPing = pings.at(-1);

  const log = useCallback((message: string, tone: LogEntry["tone"] = "info") => {
    const entry = { id: logId.current++, time: formatClock(Date.now()), message, tone };
    setLogs((prev) => [...prev, entry].slice(-MAX_LOGS));
  }, []);

  const openStore = useCallback(
    (reason: string) => {
      const target = engine.current.url;
      playChime(audioRef.current);
      const tab = window.open(target, "_blank");
      if (tab) {
        tab.opener = null;
        log(`${reason} — Opened ${target} in a new tab`, "good");
      } else {
        log(`${reason} — Pop-up blocked. Allow pop-ups for this site or hit BUY NOW`, "warn");
      }
    },
    [log]
  );

  const runCheck = useCallback(async () => {
    const state = engine.current;
    if (state.inFlight || !isValidUrl(state.url)) return;
    state.inFlight = true;
    state.lastCheck = Date.now();
    setChecking(true);
    try {
      const response = await fetch(`/api/pokemon/check?url=${encodeURIComponent(state.url)}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as CheckResult;
      setPings((prev) => [...prev, { ...result, id: state.lastCheck, at: state.lastCheck }].slice(-MAX_PINGS));

      const detail = result.status ? `HTTP ${result.status}` : (result.error ?? "No response");
      const tone = result.stock === "in_stock" ? "good" : result.ok ? "info" : "bad";
      log(`Ping ${detail} · ${result.latencyMs}ms · ${STOCK_LABELS[result.stock]}`, tone);

      if (result.stock === "in_stock" && state.armed && !state.stockHit) {
        state.stockHit = true;
        setUnlocked(true);
        openStore("STOCK DETECTED");
      }
    } catch {
      log("Ping failed — Monitor endpoint unreachable", "bad");
    } finally {
      state.inFlight = false;
      setChecking(false);
    }
  }, [log, openStore]);

  // Keep the engine's view of the inputs current without restarting its timer.
  useEffect(() => {
    engine.current.url = url;
    engine.current.dropMs = dropMs;
    engine.current.armed = armed;
  }, [url, dropMs, armed]);

  // Clock + polling engine: one timer drives the countdown, phase changes, and checks.
  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);

      const state = engine.current;
      if (Number.isNaN(state.dropMs)) return;
      const remaining = state.dropMs - current;
      const next = getPhase(state.armed, remaining);

      if (next !== state.phase) {
        state.phase = next;
        setPhase(next);
        if (next !== "idle") log(PHASES[next].message, next === "dropzone" ? "warn" : "info");
      }

      if (state.armed && remaining <= 0 && !state.dropHit) {
        state.dropHit = true;
        setUnlocked(true);
        playChime(audioRef.current);
        log("DROP TIME REACHED — BUY NOW unlocked", "good");
      }

      const interval = PHASES[next].intervalMs;
      if (interval && current - state.lastCheck >= interval) void runCheck();
    };

    const boot = setTimeout(() => {
      setDropTime((prev) => prev || toLocalInput(Date.now() + 15 * 60 * 1000));
      log("Idle — Awaiting pre-drop warmup window");
      tick();
    }, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(boot);
      clearInterval(timer);
    };
  }, [log, runCheck]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);

  const toggleArmed = () => {
    if (!audioRef.current) audioRef.current = new AudioContext();
    void audioRef.current.resume();

    const state = engine.current;
    if (armed) {
      state.armed = false;
      log("Monitor disarmed — Polling stopped", "warn");
    } else {
      // Re-arming starts fresh: immediate first check and new triggers.
      Object.assign(state, { armed: true, lastCheck: 0, dropHit: false, stockHit: false, phase: "idle" });
      setUnlocked(false);
      log(`Monitor armed — Target ${url}`, "good");
    }
    setArmed(!armed);
  };

  const buyNow = () => {
    if (!audioRef.current) audioRef.current = new AudioContext();
    openStore("BUY NOW");
  };

  const connection = !lastPing
    ? { label: "NO SIGNAL", dot: "bg-white/30", text: "text-white/50" }
    : lastPing.stock === "blocked"
      ? { label: "BLOCKED", dot: "bg-[#ffb800]", text: "text-[#ffb800]" }
      : lastPing.ok
        ? { label: "CONNECTED", dot: "bg-[#00ff88]", text: "text-[#00ff88]" }
        : { label: "UNREACHABLE", dot: "bg-[#ff3b3b]", text: "text-[#ff3b3b]" };

  const host = urlValid ? new URL(url).host : "—";
  const maxLatency = Math.max(500, ...pings.map((p) => p.latencyMs));
  const dropLive = remainingMs !== null && remainingMs <= 0;

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0b0b0b] text-white [color-scheme:dark]">
      <div className="mx-auto flex min-h-full max-w-[1400px] flex-col gap-4 p-4 md:flex-row md:p-6">
        {/* Left panel */}
        <section className="flex flex-col gap-4 md:w-[35%]">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="font-mono text-sm font-bold tracking-[0.2em] text-white">DROP MONITOR</h1>
              <p className="font-mono text-[11px] text-white/40">pokemon / adaptive poller</p>
            </div>
            <span
              className={cn(
                "rounded border px-2 py-1 font-mono text-[11px] tracking-widest",
                phase === "idle" && "border-white/15 text-white/50",
                phase === "standby" && "border-white/30 text-white",
                phase === "warmup" && "border-[#ffb800]/50 text-[#ffb800]",
                phase === "dropzone" && "animate-pulse border-[#ff3b3b]/60 text-[#ff3b3b]"
              )}
            >
              {PHASES[phase].label}
            </span>
          </header>

          <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] tracking-widest text-white/50">TARGET STORE URL</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value.trim())}
                placeholder={DEFAULT_URL}
                spellCheck={false}
                className={cn(
                  "rounded border bg-black px-3 py-2 font-mono text-sm outline-none focus:border-white/40",
                  urlValid ? "border-white/15" : "border-[#ff3b3b]/60"
                )}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] tracking-widest text-white/50">TARGET DROP TIME</span>
              <input
                type="datetime-local"
                step={1}
                value={dropTime}
                onChange={(e) => setDropTime(e.target.value)}
                className="rounded border border-white/15 bg-black px-3 py-2 font-mono text-sm outline-none focus:border-white/40"
              />
            </label>
            <button
              type="button"
              onClick={toggleArmed}
              disabled={!urlValid || Number.isNaN(dropMs)}
              className={cn(
                "rounded border py-2 font-mono text-xs font-bold tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                armed
                  ? "border-[#ff3b3b]/50 text-[#ff3b3b] hover:bg-[#ff3b3b]/10"
                  : "border-[#00ff88]/50 text-[#00ff88] hover:bg-[#00ff88]/10"
              )}
            >
              {armed ? "DISARM MONITOR" : "ARM MONITOR"}
            </button>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center">
            <p className="font-mono text-[11px] tracking-widest text-white/50">
              {dropLive ? "DROP IS LIVE" : "TIME TO DROP"}
            </p>
            <p
              className={cn(
                "font-mono text-5xl font-bold tabular-nums tracking-tight",
                dropLive ? "text-[#00ff88]" : phase === "dropzone" ? "text-[#ff3b3b]" : "text-white"
              )}
            >
              {remainingMs === null ? "--:--:--" : formatCountdown(remainingMs)}
            </p>
          </div>

          <div className="flex min-h-[220px] flex-1 flex-col rounded-lg border border-white/10 bg-black">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="font-mono text-[11px] tracking-widest text-white/50">CLAUDE STATUS LOG</span>
              <button
                type="button"
                onClick={() => setLogs([])}
                className="font-mono text-[10px] text-white/30 hover:text-white/60"
              >
                CLEAR
              </button>
            </div>
            <div className="h-[260px] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed md:h-auto md:flex-1">
              {logs.map((entry) => (
                <div key={entry.id} className={LOG_TONES[entry.tone]}>
                  <span className="text-white/30">[{entry.time}]</span> {entry.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          <button
            type="button"
            onClick={buyNow}
            disabled={!unlocked || !urlValid}
            className={cn(
              "rounded-lg py-4 font-mono text-base font-bold tracking-[0.2em] transition-all",
              unlocked
                ? "animate-pulse bg-[#00ff88] text-black shadow-[0_0_30px_rgba(0,255,136,0.4)] hover:animate-none hover:brightness-110"
                : "cursor-not-allowed border border-white/10 bg-white/[0.03] text-white/30"
            )}
          >
            {unlocked ? "BUY NOW / OPEN STORE" : "LOCKED — AWAITING DROP"}
          </button>
        </section>

        {/* Right viewport */}
        <section className="flex flex-col gap-4 md:w-[65%]">
          <div className="flex flex-1 flex-col gap-5 rounded-lg border border-white/10 bg-white/[0.02] p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-widest text-white/50">DROP MONITOR</p>
                <h2 className="truncate text-2xl font-semibold">{host}</h2>
                <p className="truncate font-mono text-xs text-white/40">{urlValid ? url : "Invalid URL"}</p>
              </div>
              <div className={cn("flex items-center gap-2 font-mono text-xs tracking-widest", connection.text)}>
                <span className="relative flex size-2.5">
                  {armed && lastPing?.ok && (
                    <span className={cn("absolute inset-0 animate-ping rounded-full", connection.dot)} />
                  )}
                  <span className={cn("relative size-2.5 rounded-full", connection.dot)} />
                </span>
                {connection.label}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "STOCK", value: lastPing ? STOCK_LABELS[lastPing.stock] : "—", badge: lastPing?.stock },
                { label: "HTTP", value: lastPing?.status ?? (lastPing ? "ERR" : "—") },
                { label: "LATENCY", value: lastPing ? `${lastPing.latencyMs}ms` : "—" },
                {
                  label: "INTERVAL",
                  value: PHASES[phase].intervalMs ? `${PHASES[phase].intervalMs / 1000}s` : "OFF",
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded border border-white/10 bg-black p-3">
                  <p className="font-mono text-[10px] tracking-widest text-white/40">{stat.label}</p>
                  {stat.badge ? (
                    <span
                      className={cn(
                        "mt-1 inline-block rounded border px-2 py-0.5 font-mono text-sm font-bold",
                        STOCK_STYLES[stat.badge]
                      )}
                    >
                      {stat.value}
                    </span>
                  ) : (
                    <p className="mt-1 font-mono text-lg font-bold tabular-nums">{stat.value}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded border border-white/10 bg-black p-4">
              <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-widest text-white/40">
                <span>STATUS CHECK PINGS</span>
                <span>
                  {pings.length} CHECKS{lastPing && ` · LAST ${formatClock(lastPing.at)}`}
                </span>
              </div>
              <svg viewBox={`0 0 ${MAX_PINGS * 10} 100`} preserveAspectRatio="none" className="h-28 w-full">
                <line x1="0" y1="99.5" x2={MAX_PINGS * 10} y2="99.5" stroke="rgba(255,255,255,0.1)" />
                {pings.map((ping, i) => {
                  const height = ping.ok ? Math.max(4, (ping.latencyMs / maxLatency) * 96) : 96;
                  const x = (MAX_PINGS - pings.length + i) * 10 + 1.5;
                  return (
                    <rect
                      key={ping.id}
                      x={x}
                      y={100 - height}
                      width={7}
                      height={height}
                      rx={1}
                      fill={ping.ok ? "#00ff88" : "#ff3b3b"}
                      opacity={ping.ok ? 0.85 : 0.35}
                    />
                  );
                })}
              </svg>
              {pings.length === 0 && (
                <p className="mt-2 text-center font-mono text-[11px] text-white/30">
                  Arm the monitor or ping manually to start collecting checks
                </p>
              )}
            </div>

            <div className="mt-auto flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void runCheck()}
                disabled={!urlValid || checking}
                className="flex-1 rounded border border-white/15 py-3 font-mono text-xs font-bold tracking-[0.2em] hover:bg-white/5 disabled:opacity-40"
              >
                {checking ? "PINGING…" : "PING NOW"}
              </button>
              <a
                href={urlValid ? url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => log(`Manual store access — Opened ${url}`)}
                className="flex-1 rounded border border-[#00ff88]/40 py-3 text-center font-mono text-xs font-bold tracking-[0.2em] text-[#00ff88] hover:bg-[#00ff88]/10"
              >
                OPEN STORE MANUALLY ↗
              </a>
            </div>
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-white/30">
            Checks run server-side and read the page for stock markers (“add to cart”, “sold out”, queue pages).
            Stores behind bot protection may report BLOCKED — the countdown still unlocks BUY NOW at drop time.
            Keep this tab open and allow pop-ups so detection can open the store automatically.
          </p>
        </section>
      </div>
    </div>
  );
}
