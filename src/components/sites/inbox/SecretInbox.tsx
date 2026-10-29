"use client";

import { Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Inbox } from "./Inbox";
import styles from "./inbox.module.css";

/** Size of the top-right hot corner, in px. */
const CORNER = 96;
/** Typed after the shift-click, with nothing on screen; the server checks it again at login. */
const SECRET_EMAIL = "vincent@mcvindle.com";
/** The hidden prompt gives up after this long without a key. */
const LISTEN_MS = 20_000;
const ZOOM_MS = 1100;

type Stage = "idle" | "listening" | "password" | "opening" | "open" | "closing";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Full screen, and it stays full screen when the window resizes. */
const FULL = { top: 0, left: 0, width: "100vw", height: "100dvh" } as const;

/** The iPod screen's spot on the page, which the inbox zooms out of and back into. */
const screenRect = (): Rect => {
  const el = document.querySelector("[data-ipod-screen]");
  if (!el) return { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/**
 * The hidden way into the inbox: shift-click the top-right corner, type the address blind
 * (nothing shows), then a password bubble appears; a good login zooms the iPod screen out to
 * a full-screen inbox. Keys go nowhere else while it's listening, so the iPod doesn't move.
 */
export function SecretInbox() {
  const [stage, setStage] = useState<Stage>("idle");
  /** The iPod screen's rect the zoom starts from and returns to; `grown` is the full-screen end. */
  const [from, setFrom] = useState<Rect | null>(null);
  const [grown, setGrown] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const typed = useRef("");
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  });

  const reset = useCallback(() => {
    typed.current = "";
    if (giveUp.current) clearTimeout(giveUp.current);
    setPassword("");
    setError(null);
    setStage("idle");
  }, []);

  const open = useCallback(() => {
    setFrom(screenRect());
    setGrown(false);
    setStage("opening");
    // Two frames so the frame paints at the screen's size before it grows.
    requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    setTimeout(() => setStage("open"), ZOOM_MS);
  }, []);

  const close = useCallback(() => {
    void fetch("/api/inbox/auth", { method: "DELETE" }).catch(() => null);
    setStage("closing");
    setFrom(screenRect());
    setGrown(false);
    setTimeout(() => {
      setFrom(null);
      reset();
    }, ZOOM_MS);
  }, [reset]);

  // The hot corner.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!event.shiftKey || stageRef.current !== "idle") return;
      if (event.clientX < window.innerWidth - CORNER || event.clientY > CORNER) return;
      event.preventDefault();
      event.stopPropagation();
      typed.current = "";
      setStage("listening");
      if (giveUp.current) clearTimeout(giveUp.current);
      giveUp.current = setTimeout(reset, LISTEN_MS);
    };
    window.addEventListener("pointerdown", onPointer, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointer, { capture: true });
  }, [reset]);

  // Blind typing: swallow every key until the address is typed.
  useEffect(() => {
    if (stage !== "listening") return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return reset();
      if (event.key === "Backspace") typed.current = typed.current.slice(0, -1);
      else if (event.key.length === 1) typed.current = (typed.current + event.key).slice(-SECRET_EMAIL.length);
      if (giveUp.current) clearTimeout(giveUp.current);
      giveUp.current = setTimeout(reset, LISTEN_MS);
      if (typed.current.toLowerCase() !== SECRET_EMAIL) return;
      if (giveUp.current) clearTimeout(giveUp.current);
      // Still logged in from earlier today: straight in.
      void fetch("/api/inbox/auth")
        .then((r) => r.json() as Promise<{ ok?: boolean }>)
        .catch(() => ({ ok: false }))
        .then((s) => (s.ok ? open() : setStage("password")));
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [stage, reset, open]);

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
      if (response.ok) {
        setPassword("");
        open();
        return;
      }
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
    <>
      {stage === "password" && (
        <>
          <div className="fixed inset-0 z-60" onPointerDown={reset} />
          <form
            className={cn(styles.theme, styles.bubble, shake && styles.shake, "p-4")}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") reset();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Lock className="size-3.5 text-(--ib-muted)" /> {SECRET_EMAIL}
            </div>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              aria-label="Password"
              disabled={busy}
              className="w-full rounded-lg bg-(--ib-field) px-3 py-2 text-[14px] outline-none placeholder:text-(--ib-muted) focus:ring-[3px] focus:ring-(--ib-accent)/40"
            />
            {error && <p className="mt-2 text-[12px] text-[#ff3b30]">{error}</p>}
          </form>
        </>
      )}

      {from && (stage === "opening" || stage === "open" || stage === "closing") && (
        <div
          className={cn(styles.theme, styles.frame)}
          style={grown ? { ...FULL, borderRadius: 0 } : { ...from, borderRadius: 4 }}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className={cn(styles.content, grown && styles.contentShown)}>
            <Inbox onLock={close} />
          </div>
        </div>
      )}
    </>
  );
}
