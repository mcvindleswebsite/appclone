"use client";

import { Brain, Calculator, Cloud, CloudOff, KeyRound, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { evaluate, probToAmerican, RISK_PROFILES, type Evaluation } from "@/lib/bet/engine";
import {
  ACCESS_KEY_STORAGE,
  buildInsights,
  deleteRemote,
  fetchRemote,
  loadLocal,
  memoryNotes,
  mergeRecords,
  pushRemote,
  saveLocal,
  syncErrorMessage,
  type SyncStatus,
} from "@/lib/bet/history";
import { SPORTS } from "@/lib/bet/parse-slip";
import { cn } from "@/lib/utils";
import type { AiSynthesis, BetRecord, BetSlip, Outcome, RiskLevel } from "@/types/bet";

import { BrandLogo } from "@/app/bet/components/BrandLogo";

import { BetVault } from "./BetVault";
import { KalshiLinkImport } from "./KalshiLinkImport";
import { PickCard } from "./PickCard";
import { RiskSlider } from "./RiskSlider";
import { SlipReader } from "./SlipReader";
import { T } from "./theme";

const EMPTY_SLIP: BetSlip = {
  sport: "NFL",
  matchup: "",
  marketTitle: "",
  pick: "",
  yesPrice: 50,
  americanOdds: null,
};

const pts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const summarize = (e: Evaluation, ai: AiSynthesis | null) =>
  ai?.reasoning ?? `${e.verdict}: ${e.reasons.join(". ")}.`;

/** Snapshot of an evaluation for the vault. Module-level so the timestamps stay out of render. */
const toRecord = (
  base: Pick<BetRecord, "id" | "createdAt" | "outcome">,
  slip: BetSlip,
  e: Evaluation,
  aiRead: AiSynthesis | null,
  risk: RiskLevel
): BetRecord => {
  const side = e.side ?? (e.sides.YES.edge >= e.sides.NO.edge ? "YES" : "NO");
  return {
    ...base,
    updatedAt: Date.now(),
    slip,
    risk,
    side: e.side,
    verdict: e.verdict === "PASS" ? "PASS" : `${e.verdict} @ ${Math.round(e.sides[side].price * 100)}¢`,
    probability: e.sides[side].probability,
    edge: e.sides[side].edge,
    summary: summarize(e, aiRead),
    ai: !!aiRead,
    aiRisk: aiRead?.riskRating,
  };
};

const newRecordBase = () => ({ id: crypto.randomUUID(), createdAt: Date.now(), outcome: "PENDING" as const });

const stampOutcome = (record: BetRecord, outcome: Outcome): BetRecord => ({ ...record, outcome, updatedAt: Date.now() });

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={T.label}>{label}</span>
      {children}
    </label>
  );
}

export function BetApp() {
  const [tab, setTab] = useState<"evaluate" | "vault">("evaluate");
  const [slip, setSlip] = useState<BetSlip>(EMPTY_SLIP);
  const [oddsText, setOddsText] = useState("");
  const [risk, setRisk] = useState<RiskLevel>(3);
  const [ai, setAi] = useState<AiSynthesis | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [records, setRecords] = useState<BetRecord[]>([]);
  const [accessKey, setAccessKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [sync, setSync] = useState<SyncStatus>("local");
  const [ocrText, setOcrText] = useState<string | null>(null);
  const recordsRef = useRef<BetRecord[]>([]);
  /** Bumped by every new slip, so a slow research reply for an old slip is discarded. */
  const evalSeq = useRef(0);

  const evaluation = evaluate(slip, risk, ai);
  const insights = buildInsights(records);
  const notes = memoryNotes(insights, slip.sport, slip.matchup);
  const slipReady = slip.yesPrice >= 1 && slip.yesPrice <= 99 && (slip.matchup || slip.marketTitle);

  /** Writes records locally and, when a key is set, mirrors the changed ones to the API store. */
  const commit = useCallback(
    (next: BetRecord[], changed: BetRecord[]) => {
      recordsRef.current = next;
      setRecords(next);
      saveLocal(next);
      if (accessKey && changed.length) {
        pushRemote(accessKey, changed)
          .then(() => setSync("synced"))
          .catch((error: unknown) => setSync({ error: syncErrorMessage(error) }));
      }
    },
    [accessKey]
  );

  const syncRemote = useCallback(async (key: string) => {
    try {
      const remote = await fetchRemote(key);
      const merged = mergeRecords(recordsRef.current, remote);
      recordsRef.current = merged;
      setRecords(merged);
      saveLocal(merged);
      const remoteIds = new Map(remote.map((r) => [r.id, r.updatedAt]));
      const missing = merged.filter((r) => (remoteIds.get(r.id) ?? -1) < r.updatedAt);
      if (missing.length) await pushRemote(key, missing);
      setSync("synced");
    } catch (error) {
      setSync({ error: syncErrorMessage(error) });
    }
  }, []);

  // Load the vault from localStorage (and the API store, if a key was saved) after mount.
  useEffect(() => {
    const boot = setTimeout(() => {
      const local = loadLocal();
      recordsRef.current = local;
      setRecords(local);
      const key = localStorage.getItem(ACCESS_KEY_STORAGE) ?? "";
      setAccessKey(key);
      if (key) void syncRemote(key);
    }, 0);
    return () => clearTimeout(boot);
  }, [syncRemote]);

  const updateSlip = (patch: Partial<BetSlip>) => {
    setSlip((prev) => ({ ...prev, ...patch }));
    // A different slip is a new evaluation; the old research no longer applies.
    evalSeq.current++;
    setRunning(false);
    setAi(null);
    setActiveId(null);
    setNotice(null);
  };

  /**
   * Researches the slip with the AI route, then saves it to the vault. `auto` runs come
   * from a link import or OCR scan and only fire when the AI is available.
   */
  const runEvaluation = async (target: BetSlip, auto = false) => {
    const seq = ++evalSeq.current;
    setAi(null);
    setActiveId(null);
    if (!accessKey) {
      if (!auto) {
        setNotice("No access key — saved with market pricing only, no research.");
        const record = toRecord(newRecordBase(), target, evaluate(target, risk, null), null, risk);
        setActiveId(record.id);
        commit([record, ...recordsRef.current], [record]);
      }
      return;
    }

    setRunning(true);
    let aiRead: AiSynthesis | null = null;
    let problem: string | null = null;
    try {
      const response = await fetch("/api/bet/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bet-key": accessKey },
        body: JSON.stringify({ slip: target }),
      });
      const data = (await response.json()) as AiSynthesis | { error: string };
      if ("error" in data) problem = data.error;
      else aiRead = data;
    } catch {
      problem = "can't reach the server";
    }
    if (seq !== evalSeq.current) return;

    setRunning(false);
    if (!aiRead) {
      setNotice(`Research failed (${problem}) — tap Re-run to try again.`);
      return;
    }
    setAi(aiRead);
    const record = toRecord(newRecordBase(), target, evaluate(target, risk, aiRead), aiRead, risk);
    setActiveId(record.id);
    commit([record, ...recordsRef.current], [record]);
  };

  // Latest slip and runner for the memoized import callbacks below.
  const latest = useRef({ slip, run: runEvaluation });
  useEffect(() => {
    latest.current = { slip, run: runEvaluation };
  });

  const onParsed = useCallback((fields: Partial<BetSlip>, raw: string) => {
    const next = { ...latest.current.slip, ...fields };
    setOcrText(raw);
    setSlip(next);
    setOddsText(fields.americanOdds ? `${fields.americanOdds > 0 ? "+" : ""}${fields.americanOdds}` : "");
    const found = Object.keys(fields).filter((k) => k !== "sport").length;
    const usable = fields.yesPrice !== undefined && !!(fields.matchup || fields.marketTitle);
    setNotice(
      usable
        ? `Read ${found} fields from the screenshot — researching now. Fix anything wrong and tap Re-run.`
        : found
          ? `Read ${found} field${found > 1 ? "s" : ""} — fill in the rest, then tap Research.`
          : "No slip fields found — enter them manually."
    );
    if (usable) void latest.current.run(next, true);
    else {
      evalSeq.current++;
      setAi(null);
      setActiveId(null);
    }
  }, []);

  const onImport = useCallback((fields: Partial<BetSlip>, label: string) => {
    const next = { ...latest.current.slip, ...fields };
    setSlip(next);
    setOddsText("");
    setOcrText(null);
    setNotice(`Imported ${label} from Kalshi.`);
    void latest.current.run(next, true);
  }, []);

  const changeRisk = (next: RiskLevel) => {
    setRisk(next);
    const existing = recordsRef.current.find((r) => r.id === activeId);
    if (!existing) return;
    const updated = toRecord(existing, slip, evaluate(slip, next, ai), ai, next);
    commit(recordsRef.current.map((r) => (r.id === existing.id ? updated : r)), [updated]);
  };

  const setOutcome = (id: string, outcome: Outcome) => {
    const existing = recordsRef.current.find((r) => r.id === id);
    if (!existing) return;
    const updated = stampOutcome(existing, outcome);
    commit(recordsRef.current.map((r) => (r.id === id ? updated : r)), [updated]);
  };

  const removeRecord = (id: string) => {
    commit(recordsRef.current.filter((r) => r.id !== id), []);
    if (accessKey) void deleteRemote(accessKey, id);
    if (id === activeId) setActiveId(null);
  };

  const saveKey = (key: string) => {
    setAccessKey(key);
    if (key) {
      localStorage.setItem(ACCESS_KEY_STORAGE, key);
      void syncRemote(key);
    } else {
      localStorage.removeItem(ACCESS_KEY_STORAGE);
      setSync("local");
    }
  };

  const verdictTone =
    evaluation.verdict === "BUY YES" ? T.yes : evaluation.verdict === "BUY NO" ? T.no : "text-white";
  const marketProb = slip.yesPrice / 100;

  return (
    <div className={cn("fixed inset-0 overflow-y-auto text-white antialiased", T.bg)}>
      <header className="sticky top-0 z-10 border-b border-[#1E2638] bg-[#050D0A]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <BrandLogo className="text-lg" />
          <nav className="flex gap-1 rounded-full bg-[#121824] p-1">
            {(
              [
                ["evaluate", "Evaluate"],
                ["vault", `Bet Vault${records.length ? ` · ${records.length}` : ""}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                  tab === id ? "bg-white text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span
              title={typeof sync === "object" ? sync.error : undefined}
              className={cn("hidden items-center gap-1.5 text-xs sm:flex", typeof sync === "object" ? T.no : T.muted)}
            >
              {sync === "synced" ? <Cloud className="size-3.5 text-[#00DD94]" /> : <CloudOff className="size-3.5" />}
              {sync === "synced" ? "Synced" : typeof sync === "object" ? `Sync error: ${sync.error}` : "Local only"}
            </span>
            <button
              type="button"
              aria-label="Access key"
              onClick={() => setShowKey((s) => !s)}
              className={cn(
                "rounded-lg p-2 transition-colors hover:bg-[#121824]",
                accessKey ? "text-[#00DD94]" : "text-[#F5F7F4]/60"
              )}
            >
              <KeyRound className="size-4" />
            </button>
          </div>
        </div>
        {showKey && (
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-3">
            <input
              type="password"
              defaultValue={accessKey}
              placeholder="BET_ACCESS_KEY — enables AI research + cloud vault"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  saveKey(e.currentTarget.value.trim());
                  setShowKey(false);
                }
              }}
              onBlur={(e) => saveKey(e.currentTarget.value.trim())}
              className={cn(T.input, "max-w-md")}
            />
            <span className={cn("text-xs", typeof sync === "object" ? T.no : T.muted)}>
              {typeof sync === "object" ? `Sync error: ${sync.error}` : "Stored in this browser only."}
            </span>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "vault" ? (
          <BetVault records={records} onOutcome={setOutcome} onDelete={removeRecord} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Slip input */}
            <section className="flex flex-col gap-5">
              <div className={cn(T.card, "flex flex-col gap-4 p-5")}>
                <h2 className="font-kalshi-bold text-lg">Bet Slip</h2>
                <KalshiLinkImport onImport={onImport} />
                <div className={cn("flex items-center gap-3 text-[11px] uppercase", T.muted)}>
                  <span className="h-px flex-1 bg-[#1E2638]" />
                  or scan a screenshot
                  <span className="h-px flex-1 bg-[#1E2638]" />
                </div>
                <SlipReader onParsed={onParsed} />
                {notice && <p className="text-xs text-[#F5F7F4]">{notice}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sport">
                    <select
                      value={slip.sport}
                      onChange={(e) => updateSlip({ sport: e.target.value })}
                      className={T.input}
                    >
                      {SPORTS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Matchup">
                    <input
                      value={slip.matchup}
                      onChange={(e) => updateSlip({ matchup: e.target.value })}
                      placeholder="Chiefs vs Bills"
                      className={T.input}
                    />
                  </Field>
                  <Field label="Market Title" className="col-span-2">
                    <input
                      value={slip.marketTitle}
                      onChange={(e) => updateSlip({ marketTitle: e.target.value })}
                      placeholder="Who will win Chiefs vs Bills?"
                      className={T.input}
                    />
                  </Field>
                  <Field label="YES Side (Pick)">
                    <input
                      value={slip.pick}
                      onChange={(e) => updateSlip({ pick: e.target.value })}
                      placeholder="Kansas City"
                      className={T.input}
                    />
                  </Field>
                  <Field label="YES Price (¢)">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={slip.yesPrice}
                      onChange={(e) => updateSlip({ yesPrice: Number(e.target.value) })}
                      className={cn(T.input, "tabular-nums")}
                    />
                  </Field>
                  <Field label="Book Odds (optional)">
                    <input
                      value={oddsText}
                      onChange={(e) => {
                        setOddsText(e.target.value);
                        const n = Number(e.target.value.replace(/\s/g, ""));
                        updateSlip({ americanOdds: Number.isFinite(n) && Math.abs(n) >= 100 ? n : null });
                      }}
                      placeholder="-150 / +130"
                      className={cn(T.input, "tabular-nums")}
                    />
                  </Field>
                  <div className="flex flex-col justify-end gap-1 pb-2 text-xs">
                    <span className={T.muted}>
                      Implied <span className="font-semibold text-white">{pct(marketProb)}</span> ·{" "}
                      {probToAmerican(marketProb) > 0 ? "+" : ""}
                      {probToAmerican(marketProb)}
                    </span>
                    <span className={T.muted}>NO ≈ {100 - slip.yesPrice}¢</span>
                  </div>
                </div>
                {ocrText && (
                  <details className="text-xs">
                    <summary className={cn("cursor-pointer", T.muted)}>Raw OCR text</summary>
                    <pre className={cn(T.inset, "mt-2 max-h-40 overflow-auto p-3 whitespace-pre-wrap", T.muted)}>
                      {ocrText}
                    </pre>
                  </details>
                )}
              </div>

              <PickCard slip={slip} ai={ai} evaluation={evaluation} researching={running} hasKey={!!accessKey} />

              <button
                type="button"
                disabled={!slipReady || running}
                onClick={() => void runEvaluation(slip)}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#00DD94] py-3.5 text-sm font-bold text-[#050D0A] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Researching…
                  </>
                ) : (
                  <>
                    {accessKey ? <Sparkles className="size-4" /> : <Calculator className="size-4" />}
                    {accessKey ? (ai ? "Re-run Research & Save" : "Research & Save") : "Save Without Research"}
                  </>
                )}
              </button>
            </section>

            {/* Verdict */}
            <section className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
              <div className={cn(T.card, "flex flex-col gap-5 p-5")}>
                <RiskSlider value={risk} onChange={changeRisk} />
              </div>

              <div className={cn(T.card, "flex flex-col gap-5 p-5")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={T.label}>Verdict · Risk {risk} {RISK_PROFILES[risk].label}</p>
                    <p className={cn("font-kalshi-condensed mt-1 text-5xl", verdictTone)}>{evaluation.verdict}</p>
                    {evaluation.side && (
                      <p className={cn("text-sm", T.muted)}>
                        {evaluation.side === "YES" ? slip.pick || "YES" : `Against ${slip.pick || "YES"}`} @{" "}
                        {Math.round(evaluation.sides[evaluation.side].price * 100)}¢ · stake{" "}
                        <span className="font-semibold text-white">{(evaluation.stakePct * 100).toFixed(1)}%</span> of bankroll
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      ai ? "bg-[#014737] text-[#00DD94]" : "bg-[#1E2638] text-[#F5F7F4]/60"
                    )}
                  >
                    {ai ? <Brain className="size-3" /> : <Calculator className="size-3" />}
                    {ai ? `AI · ${ai.hitConfidence}/10` : "Market only"}
                  </span>
                </div>

                {/* Market vs model probability */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs">
                    <span className={T.muted}>Market {pct(marketProb)}</span>
                    <span className="font-semibold">Model {pct(evaluation.probability)}</span>
                  </div>
                  <div className="relative h-2.5 overflow-hidden rounded-full bg-[#FF3B30]/25">
                    <div className="absolute inset-y-0 left-0 bg-[#00DD94]" style={{ width: pct(evaluation.probability) }} />
                    <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(marketProb) }} />
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className={T.yes}>YES {slip.pick}</span>
                    <span className={T.no}>NO</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(["YES", "NO"] as const).map((side) => {
                    const s = evaluation.sides[side];
                    const positive = s.edge > 0;
                    return (
                      <div
                        key={side}
                        className={cn(
                          T.inset,
                          "p-3",
                          evaluation.side === side && (side === "YES" ? "border-[#00DD94]/60" : "border-[#FF3B30]/60")
                        )}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className={cn("text-sm font-bold", side === "YES" ? T.yes : T.no)}>{side}</span>
                          <span className="text-sm tabular-nums">{Math.round(s.price * 100)}¢</span>
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs tabular-nums">
                          <dt className={T.muted}>Fair</dt>
                          <dd className="text-right">{s.fairCents}¢</dd>
                          <dt className={T.muted}>Edge</dt>
                          <dd className={cn("text-right font-semibold", positive ? T.yes : T.no)}>{pts(s.edge)} pts</dd>
                          <dt className={T.muted}>EV / $1</dt>
                          <dd className={cn("text-right", positive ? T.yes : T.no)}>{pts(s.roi)}¢</dd>
                        </dl>
                      </div>
                    );
                  })}
                </div>

                <ul className="flex flex-col gap-1.5 text-sm">
                  {evaluation.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span className={evaluation.side ? T.yes : T.no}>{evaluation.side ? "✓" : "✕"}</span>
                      <span className="text-[#F5F7F4]/85">{reason}</span>
                    </li>
                  ))}
                </ul>

                {ai && ai.risks.length > 0 && (
                  <ul className="flex flex-col gap-1 text-xs">
                    {ai.risks.map((r) => (
                      <li key={r} className="text-[#FF3B30]/90">
                        ▲ {r}
                      </li>
                    ))}
                  </ul>
                )}

                {notes.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-[#1E2638] pt-4 text-xs">
                    <p className={T.label}>From Your Vault</p>
                    {notes.map((n) => (
                      <p key={n} className="text-[#F5F7F4]/85">
                        {n}
                      </p>
                    ))}
                  </div>
                )}

                {activeId && <p className={cn("text-xs", T.muted)}>Saved to Bet Vault · moving the slider updates it.</p>}
              </div>

              <p className={cn("text-[11px] leading-relaxed", T.muted)}>
                Estimates, not guarantees. Edge is measured after Kalshi&apos;s taker fee; NO price is approximated as 100 − YES.
                Bet only what you can afford to lose.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
