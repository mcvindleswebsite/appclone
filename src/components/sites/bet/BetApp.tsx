"use client";

import { Brain, Calculator, Cloud, CloudOff, KeyRound, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/app/bet/components/BrandLogo";
import {
  evaluate,
  evaluateParlay,
  kalshiDecimal,
  RISK_PROFILES,
  type Evaluation,
  type ParlayEvaluation,
} from "@/lib/bet/engine";
import {
  ACCESS_KEY_STORAGE,
  buildInsights,
  deleteRemote,
  fetchRemote,
  historyContext,
  loadLocal,
  memoryNotes,
  mergeRecords,
  pushRemote,
  saveLocal,
  syncErrorMessage,
  type SyncStatus,
} from "@/lib/bet/history";
import { settleKalshi, settleLegs, tickerLink } from "@/lib/bet/kalshi-link";
import { emptyLeg } from "@/lib/bet/parse-slip";
import { cn } from "@/lib/utils";
import type { BetRecord, BetSlip, Outcome, RiskLevel, SlipAnalysis } from "@/types/bet";

import { BetVault } from "./BetVault";
import { KalshiLinkImport } from "./KalshiLinkImport";
import { LegEditor } from "./LegEditor";
import { ParlayCard } from "./ParlayCard";
import { PickCard } from "./PickCard";
import { RiskSlider } from "./RiskSlider";
import { SlipReader } from "./SlipReader";
import { T } from "./theme";

const EMPTY_SLIP: BetSlip = { legs: [emptyLeg()], comboPrice: null, comboOdds: null };

const pts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const slipReady = (slip: BetSlip) => slip.legs.some((l) => l.market || l.matchup || l.pick);

/** Snapshot of an evaluation for the vault. Module-level so the timestamps stay out of render. */
const toRecord = (
  base: Pick<BetRecord, "id" | "createdAt" | "outcome">,
  slip: BetSlip,
  ai: SlipAnalysis | null,
  risk: RiskLevel
): BetRecord => {
  const common = { ...base, updatedAt: Date.now(), slip, risk, ai: !!ai, aiRisk: ai?.riskScore };
  if (slip.legs.length === 1) {
    const e = evaluate(slip.legs[0], risk, ai);
    const side = e.side ?? (e.sides.YES.edge >= e.sides.NO.edge ? "YES" : "NO");
    const s = e.sides[side];
    return {
      ...common,
      side: e.side,
      verdict: e.verdict === "PASS" ? "PASS" : `${e.verdict} @ ${Math.round(s.price * 100)}¢`,
      probability: s.probability,
      edge: s.edge,
      decimalOdds: kalshiDecimal(Math.round(s.price * 100)),
      summary: ai?.reasoning ?? `${e.verdict}: ${e.reasons.join(". ")}.`,
    };
  }
  const p = evaluateParlay(slip, risk, ai);
  const line = p.trimmed ?? p.full;
  return {
    ...common,
    side: null,
    verdict: p.verdict === "PLAY TRIMMED SLIP" ? `PLAY TRIMMED SLIP (${line.indexes.length}/${slip.legs.length} legs)` : p.verdict,
    probability: line.probability,
    edge: line.ev ?? 0,
    decimalOdds: line.decimal ?? undefined,
    summary: ai?.reasoning ?? p.reasons.join(". "),
  };
};

const newRecordBase = () => ({ id: crypto.randomUUID(), createdAt: Date.now(), outcome: "PENDING" as const });

const stampOutcome = (record: BetRecord, outcome: Outcome): BetRecord => ({ ...record, outcome, updatedAt: Date.now() });

/** A vault entry for a bet already placed on Kalshi. */
const importedRecord = (slip: BetSlip, outcome: Outcome, paidCents: number | null): BetRecord => {
  const price = paidCents ?? (outcome === "PENDING" ? (slip.legs.length > 1 ? slip.comboPrice : slip.legs[0].price) : null);
  return {
    ...newRecordBase(),
    outcome,
    updatedAt: Date.now(),
    slip,
    risk: 3,
    side: slip.legs.length === 1 ? "YES" : null,
    verdict: price ? `LOGGED @ ${price}¢` : "LOGGED",
    probability: price ? price / 100 : 0,
    edge: 0,
    decimalOdds: price ? kalshiDecimal(price) : undefined,
    summary: "Added from a Kalshi link.",
    ai: false,
    imported: true,
  };
};

export function BetApp() {
  const [tab, setTab] = useState<"evaluate" | "vault">("evaluate");
  const [slip, setSlip] = useState<BetSlip>(EMPTY_SLIP);
  const [risk, setRisk] = useState<RiskLevel>(3);
  const [ai, setAi] = useState<SlipAnalysis | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [records, setRecords] = useState<BetRecord[]>([]);
  const [accessKey, setAccessKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  /** False until localStorage has been read, so the page doesn't flash the broken-key state. */
  const [booted, setBooted] = useState(false);
  const [sync, setSync] = useState<SyncStatus>("local");
  const [ocrText, setOcrText] = useState<string | null>(null);
  const recordsRef = useRef<BetRecord[]>([]);
  /** Bumped by every new slip, so a slow research reply for an old slip is discarded. */
  const evalSeq = useRef(0);

  const multi = slip.legs.length > 1;
  const single: Evaluation = evaluate(slip.legs[0], risk, ai);
  const parlay: ParlayEvaluation | null = multi ? evaluateParlay(slip, risk, ai) : null;
  const notes = memoryNotes(buildInsights(records), slip);

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
      setShowKey(false);
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
      setBooted(true);
      if (key) {
        setSync("checking");
        void syncRemote(key);
      }
    }, 0);
    return () => clearTimeout(boot);
  }, [syncRemote]);

  const editSlip = (next: BetSlip) => {
    setSlip(next);
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
        const record = toRecord(newRecordBase(), target, null, risk);
        setActiveId(record.id);
        commit([record, ...recordsRef.current], [record]);
      }
      return;
    }

    setRunning(true);
    let result: SlipAnalysis | null = null;
    let problem: string | null = null;
    try {
      const response = await fetch("/api/bet/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bet-key": accessKey },
        // The server prefers the Upstash vault; this copy covers a vault that isn't connected.
        body: JSON.stringify({ slip: target, history: historyContext(recordsRef.current) }),
      });
      const data = (await response.json()) as SlipAnalysis | { error: string };
      if (response.status === 401 || response.status === 403) setSync({ error: "Wrong passphrase" });
      else if ("error" in data && data.error === "Not configured") setSync({ error: "BET_ACCESS_KEY not set on the server" });
      if ("error" in data) problem = data.error;
      else result = data;
    } catch {
      problem = "can't reach the server";
    }
    if (seq !== evalSeq.current) return;

    setRunning(false);
    if (!result) {
      setNotice(`Research failed (${problem}) — tap Re-run to try again.`);
      return;
    }
    setAi(result);
    const failed = result.legs.filter((l) => !l.researched).length;
    if (failed) setNotice(`Research failed for ${failed} leg${failed > 1 ? "s" : ""} — those are rated on price alone.`);
    const record = toRecord(newRecordBase(), target, result, risk);
    setActiveId(record.id);
    commit([record, ...recordsRef.current], [record]);
  };

  // Latest runner for the memoized import callbacks below.
  const latest = useRef({ run: runEvaluation });
  useEffect(() => {
    latest.current = { run: runEvaluation };
  });

  const onParsed = useCallback((parsed: BetSlip, raw: string) => {
    setOcrText(raw);
    setSlip(parsed);
    const usable = parsed.legs.some((l) => (l.price !== null || l.americanOdds !== null) && (l.market || l.matchup));
    const n = parsed.legs.length;
    setNotice(
      usable
        ? `Read ${n > 1 ? `${n} legs` : "the slip"} from the screenshot — researching now. Fix anything wrong and tap Re-run.`
        : "Couldn't read enough from the screenshot — fill in the legs, then tap Research."
    );
    if (usable) void latest.current.run(parsed, true);
    else {
      evalSeq.current++;
      setAi(null);
      setActiveId(null);
    }
  }, []);

  const onImport = useCallback((imported: Pick<BetSlip, "legs" | "comboPrice" | "comboTicker">, label: string) => {
    const next: BetSlip = { ...imported, comboOdds: null };
    setSlip(next);
    setOcrText(null);
    setNotice(`Imported ${label} from Kalshi.`);
    void latest.current.run(next, true);
  }, []);

  const changeRisk = (next: RiskLevel) => {
    setRisk(next);
    const existing = recordsRef.current.find((r) => r.id === activeId);
    if (!existing) return;
    const updated = toRecord(existing, slip, ai, next);
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

  /** Logs a bet placed on Kalshi, settled leg by leg from Kalshi's results (no AI). */
  const quickAdd = async (links: string, paidCents: number | null) => {
    const data = await settleKalshi(links);
    const slipFromLink: BetSlip = {
      legs: data.legs,
      comboPrice: data.comboPrice,
      comboOdds: null,
      comboTicker: data.comboTicker ?? undefined,
    };
    const record = importedRecord(slipFromLink, data.outcome, paidCents);
    commit([record, ...recordsRef.current], [record]);
    const legs = data.legsTotal > 1 ? ` · ${data.legsHit}/${data.legsTotal} legs hit` : "";
    const skipped = data.skipped ? ` (${data.skipped} game link${data.skipped > 1 ? "s" : ""} skipped — link the market itself)` : "";
    return `Added ${data.legsTotal > 1 ? `${data.legsTotal}-leg slip` : data.legs[0].pick} as ${data.outcome}${legs}${skipped}.`;
  };

  /**
   * Re-checks pending picks that have Kalshi tickers: fills in each leg's result as games
   * finish, and settles the pick once the outcome is known.
   */
  const refreshOutcomes = async () => {
    const pending = recordsRef.current
      .filter((r) => r.outcome === "PENDING" && (r.slip.comboTicker || r.slip.legs.some((l) => l.ticker)))
      .slice(0, 20);
    const updated: BetRecord[] = [];
    let newlySettled = 0;
    await Promise.all(
      pending.map(async (r) => {
        const tickers = r.slip.comboTicker ? [r.slip.comboTicker] : r.slip.legs.flatMap((l) => (l.ticker ? [l.ticker] : []));
        try {
          const data = await settleKalshi(tickers.map(tickerLink).join("\n"));
          const results = new Map(data.legs.map((l) => [l.ticker, l.result]));
          const legs = r.slip.legs.map((l) => (l.ticker && results.has(l.ticker) ? { ...l, result: results.get(l.ticker) } : l));
          const outcome = r.slip.comboTicker ? data.outcome : settleLegs(legs).outcome;
          const changed = outcome !== "PENDING" || legs.some((l, i) => l.result !== r.slip.legs[i].result);
          if (!changed) return;
          if (outcome !== "PENDING") newlySettled++;
          updated.push({ ...stampOutcome(r, outcome), slip: { ...r.slip, legs } });
        } catch {
          // Leave it as is; Kalshi may be briefly unavailable.
        }
      })
    );
    if (updated.length) {
      const byId = new Map(updated.map((r) => [r.id, r]));
      commit(recordsRef.current.map((r) => byId.get(r.id) ?? r), updated);
    }
    if (newlySettled) return `Settled ${newlySettled} pick${newlySettled > 1 ? "s" : ""}.`;
    return updated.length ? "Updated leg results — nothing fully settled yet." : "Nothing new has settled yet.";
  };

  const saveKey = (key: string) => {
    setAccessKey(key);
    if (key) {
      localStorage.setItem(ACCESS_KEY_STORAGE, key);
      setSync("checking");
      void syncRemote(key);
    } else {
      localStorage.removeItem(ACCESS_KEY_STORAGE);
      setSync("local");
    }
  };

  const leg = slip.legs[0];
  /** Missing, rejected, or unusable key: every accent on the page turns red. */
  const keyBroken = booted && (!accessKey || typeof sync === "object");
  const verdictTone = single.verdict === "BUY YES" ? T.yes : single.verdict === "BUY NO" ? T.no : "text-white";
  const marketProb = single.marketProbability;

  return (
    <div
      data-key-broken={keyBroken || undefined}
      className={cn("bet-accent bet-app fixed inset-0 overflow-y-auto text-white antialiased", T.bg)}
    >
      <header className="bet-safe-top sticky top-0 z-10 border-b border-[#1E2638] bg-[#050D0A]/90 backdrop-blur">
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
            {/* The status pill disappears entirely while the key is broken; the red accent says it instead. */}
            {!keyBroken && (
              <span className={cn("hidden items-center gap-1.5 text-xs sm:flex", T.muted)}>
                {sync === "synced" ? <Cloud className="size-3.5 text-(--accent)" /> : <CloudOff className="size-3.5" />}
                {sync === "synced" ? "Synced" : "Checking…"}
              </span>
            )}
            <button
              type="button"
              aria-label={keyBroken ? "Access key not working — tap to enter it" : "Access key"}
              title={typeof sync === "object" ? sync.error : undefined}
              onClick={() => setShowKey((s) => !s)}
              className="rounded-lg p-2 text-(--accent) transition-colors hover:bg-[#121824]"
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
            <span className={cn("text-xs", keyBroken ? T.no : T.muted)}>
              {typeof sync === "object" ? sync.error : accessKey ? "Stored in this browser only." : "No key entered."}
            </span>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "vault" ? (
          <BetVault
            records={records}
            onOutcome={setOutcome}
            onDelete={removeRecord}
            onQuickAdd={quickAdd}
            onRefresh={refreshOutcomes}
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Slip input */}
            <section className="flex flex-col gap-5">
              <div className={cn(T.card, "flex flex-col gap-4 p-5")}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-kalshi-bold text-lg">Bet Slip</h2>
                  {multi && <span className={cn("text-xs", T.muted)}>{slip.legs.length}-leg parlay</span>}
                </div>
                <KalshiLinkImport onImport={onImport} />
                <div className={cn("flex items-center gap-3 text-[11px] uppercase", T.muted)}>
                  <span className="h-px flex-1 bg-[#1E2638]" />
                  or scan a screenshot
                  <span className="h-px flex-1 bg-[#1E2638]" />
                </div>
                <SlipReader onParsed={onParsed} />
                {notice && <p className="text-xs text-[#F5F7F4]">{notice}</p>}

                <LegEditor slip={slip} onChange={editSlip} />

                {ocrText && (
                  <details className="text-xs">
                    <summary className={cn("cursor-pointer", T.muted)}>Raw OCR text</summary>
                    <pre className={cn(T.inset, "mt-2 max-h-40 overflow-auto p-3 whitespace-pre-wrap", T.muted)}>
                      {ocrText}
                    </pre>
                  </details>
                )}
              </div>

              {!multi && (
                <PickCard leg={leg} analysis={ai} evaluation={single} researching={running} hasKey={!!accessKey} />
              )}

              <button
                type="button"
                disabled={!slipReady(slip) || running}
                onClick={() => void runEvaluation(slip)}
                className="font-kalshi-bold flex items-center justify-center gap-2 rounded-xl bg-(--accent) py-3.5 text-sm text-[#050D0A] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Researching{multi ? ` ${slip.legs.length} legs` : ""}…
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

              {parlay ? (
                <ParlayCard
                  slip={slip}
                  analysis={ai}
                  parlay={parlay}
                  risk={risk}
                  researching={running}
                  hasKey={!!accessKey}
                />
              ) : (
                <div className={cn(T.card, "flex flex-col gap-5 p-5")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={T.label}>
                        Verdict · Risk {risk} {RISK_PROFILES[risk].label}
                      </p>
                      <p className={cn("font-kalshi-condensed mt-1 text-5xl", verdictTone)}>{single.verdict}</p>
                      {single.side && (
                        <p className={cn("text-sm", T.muted)}>
                          {single.side === "YES" ? leg.pick || "YES" : `Against ${leg.pick || "YES"}`} @{" "}
                          {Math.round(single.sides[single.side].price * 100)}¢ · stake{" "}
                          <span className="font-semibold text-white">{(single.stakePct * 100).toFixed(1)}%</span> of bankroll
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        ai ? "bg-(--accent-deep) text-(--accent)" : "bg-[#1E2638] text-[#F5F7F4]/60"
                      )}
                    >
                      {ai ? <Brain className="size-3" /> : <Calculator className="size-3" />}
                      {ai ? `AI · ${ai.legs[0]?.hitConfidence ?? 0}/10` : "Market only"}
                    </span>
                  </div>

                  {/* Market vs model probability */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-xs">
                      <span className={T.muted}>Market {pct(marketProb)}</span>
                      <span className="font-semibold">Model {pct(single.probability)}</span>
                    </div>
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-[#FF3B30]/25">
                      <div className="absolute inset-y-0 left-0 bg-(--accent)" style={{ width: pct(single.probability) }} />
                      <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(marketProb) }} />
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className={T.yes}>YES {leg.pick}</span>
                      <span className={T.no}>NO</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {(["YES", "NO"] as const).map((side) => {
                      const s = single.sides[side];
                      const positive = s.edge > 0;
                      return (
                        <div
                          key={side}
                          className={cn(
                            T.inset,
                            "p-3",
                            single.side === side && (side === "YES" ? "border-(--accent)/60" : "border-[#FF3B30]/60")
                          )}
                        >
                          <div className="flex items-baseline justify-between">
                            <span className={cn("font-kalshi-bold text-sm", side === "YES" ? T.yes : T.no)}>{side}</span>
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
                    {single.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span className={single.side ? T.yes : T.no}>{single.side ? "✓" : "✕"}</span>
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
                </div>
              )}

              {(notes.length > 0 || activeId) && (
                <div className={cn(T.card, "flex flex-col gap-1 p-4 text-xs")}>
                  {notes.length > 0 && <p className={T.label}>From Your Vault</p>}
                  {notes.map((n) => (
                    <p key={n} className="text-[#F5F7F4]/85">
                      {n}
                    </p>
                  ))}
                  {activeId && <p className={T.muted}>Saved to Bet Vault · moving the slider updates it.</p>}
                </div>
              )}

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
