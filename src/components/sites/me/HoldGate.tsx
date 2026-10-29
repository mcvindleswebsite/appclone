"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const HOLD_MS = 15_000;
/** The hold has to start within this many px of the center, and stay within it. */
const CENTER_RADIUS = 110;
const SECRET_EMAIL = "vincent@mcvindle.com";

/**
 * A completely black page. Holding the center for 15 seconds without letting go or moving
 * brings up the password (skipped when this browser is still logged in).
 */
export function HoldGate({ onUnlock }: { onUnlock: () => void }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const hold = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const cancel = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => cancel, []);

  const nearCenter = (x: number, y: number) => Math.hypot(x - window.innerWidth / 2, y - window.innerHeight / 2) <= CENTER_RADIUS;

  const held = async () => {
    hold.current = null;
    const session = await fetch("/api/inbox/auth")
      .then((r) => r.json() as Promise<{ ok?: boolean }>)
      .catch(() => ({ ok: false }));
    if (session.ok) onUnlock();
    else setAsking(true);
  };

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: SECRET_EMAIL, password }),
      });
      if (response.ok) return onUnlock();
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(response.status === 401 ? null : (data.error ?? "Couldn't log in"));
      setPassword("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="fixed inset-0 touch-none bg-black select-none [-webkit-touch-callout:none]"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (asking || hold.current || !nearCenter(event.clientX, event.clientY)) return;
        hold.current = { id: event.pointerId, timer: setTimeout(() => void held(), HOLD_MS) };
      }}
      onPointerMove={(event) => {
        if (hold.current?.id === event.pointerId && !nearCenter(event.clientX, event.clientY)) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
    >
      {asking && (
        <form
          className={cn(
            "absolute top-1/2 left-1/2 w-[min(88vw,320px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 text-black select-text",
            "animate-in fade-in zoom-in-95 duration-300",
            shake && "animate-[me-shake_0.4s]"
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="font-serif text-2xl font-bold">Password</p>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            aria-label="Password"
            className="mt-4 w-full border-b-2 border-black bg-transparent py-2 text-lg outline-none"
          />
          {error && <p className="mt-2 text-sm text-[#d0021b]">{error}</p>}
          <button
            type="submit"
            disabled={!password || busy}
            className="mt-5 w-full rounded-full bg-black py-3 text-[15px] font-semibold text-white disabled:opacity-30"
          >
            {busy ? "…" : "Continue"}
          </button>
        </form>
      )}
    </main>
  );
}
