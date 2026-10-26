"use client";

import { Brain, Calculator, Cloud, CloudOff, KeyRound, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/app/bet/components/BrandLogo";
import {
  evaluate,
  evaluateParlay,
  formatAmerican,
  kalshiDecimal,
  probToAmerican,
  ticketDecimal,
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
import { DEFAULT_WAGER, formatMoney, withPnl } from "@/lib/bet/pnl";
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

const STAKE_STORAGE = "mcvindle_bet_stake";

const EMPTY_SLIP: BetSlip = { legs: [emptyLeg()], comboPrice: null, comboOdds: null };

const pts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const slipReady = (slip: BetSlip) => slip.legs.some((l) => l.market || l.matchup || l.pick);

/** Snapshot of an evaluation for the vault. Module-level so the timestamps stay out of render. */
const toRecord = (
  base: Pick<BetRecord, "id" | "createdAt" | "outcome" | "wager">,
  slip: BetSlip,
  ai: SlipAnalysis | null,
  risk: RiskLevel
): BetRecord => {
  // Payout is sized on the ticket as entered (all legs), whatever the verdict recommends.
  const decimalOdds = ticketDecimal(slip, ai) ?? undefined;
  const common = { ...base, updatedAt: Date.now(), slip, risk, ai: !!ai, aiRisk: ai?.riskScore, decimalOdds };
  if (slip.legs.length === 1) {
    const e = evaluate(slip.legs[0], risk, ai);
    const side = e.side ?? (e.sides.YES.edge >= e.sides.NO.edge ? "YES" : "NO");
    const s = e.sides[side];
    return withPnl({
      ...common,
      side: e.side,
      verdict: e.verdict === "PASS" ? "PASS" : `${e.verdict} @ ${Math.round(s.price * 100)}¢`,
      probability: s.probability,
      edge: s.edge,
      summary: ai?.reasoning ?? `${e.verdict}: ${e.reasons.join(". ")}.`,
    });
  }
  const p = evaluateParlay(slip, risk, ai);
  const line = p.trimmed ?? p.full;
  return withPnl({
    ...common,
    side: null,
    verdict: p.verdict === "PLAY TRIMMED SLIP" ? `PLAY TRIMMED SLIP (${line.indexes.length}/${slip.legs.length} legs)` : p.verdict,
    probability: line.probability,
    edge: line.ev ?? 0,
    summary: ai?.reasoning ?? p.reasons.join(". "),
  });
};

const newRecordBase = () => ({ id: crypto.randomUUID(), createdAt: Date.now(), outcome: "PENDING" as const });

const stampOutcome = (record: BetRecord, outcome: Outcome): BetRecord => withPnl({ ...record, outcome, updatedAt: Date.now() });

const stampWager = (record: BetRecord, wager: number): BetRecord => withPnl({ ...record, wager, updatedAt: Date.now() });

/** A vault entry for a bet already placed on Kalshi. */
const importedRecord = (slip: BetSlip, outcome: Outcome, paidCents: number | null, wager: number): BetRecord => {
  const price = paidCents ?? (outcome === "PENDING" ? (slip.legs.length > 1 ? slip.comboPrice : slip.legs[0].price) : null);
  return withPnl({
    ...newRecordBase(),
    outcome,
    updatedAt: Date.now(),
    slip,
    risk: 3,
    side: slip.legs.length === 1 ? "YES" : null,
    verdict: price ? `LOGGED @ ${price}¢` : "LOGGED",
    probability: price ? price / 100 : 0,
    edge: 0,
    // What was paid, else the ticket's current market odds.
    decimalOdds: price ? kalshiDecimal(price) : (ticketDecimal(slip, null) ?? undefined),
    wager,
    summary: "Added from a Kalshi link.",
    ai: false,
    imported: true,
  });
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
  /** One dollar stake for the whole ticket (not per leg); remembered between visits. */
  const [stake, setStake] = useState(DEFAULT_WAGER);
  const [stakeText, setStakeText] = useState(String(DEFAULT_WAGER));
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
      const savedStake = Number(localStorage.getItem(STAKE_STORAGE));
      if (savedStake > 0) {
        setStake(savedStake);
        setStakeText(String(savedStake));
      }
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
        const record = toRecord({ ...newRecordBase(), wager: stake }, target, null, risk);
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
    const record = toRecord({ ...newRecordBase(), wager: stake }, target, result, risk);
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
    // A leg only needs a pick and something to anchor it (its game or market); a missing
    // price is fine — research still runs and the price can be filled in afterwards.
    const usable = parsed.legs.some((l) => (l.pick || l.market) && (l.matchup || l.market));
    const n = parsed.legs.length;
    const unpriced = parsed.legs.filter((l) => l.price === null && l.americanOdds === null).length;
    setNotice(
      usable
        ? `Read ${n > 1 ? `${n} legs` : "the slip"} from the screenshot — researching now.${
            unpriced ? ` ${unpriced} without a price; add it for EV.` : ""
          } Fix anything wrong and tap Re-run.`
        : "No picks found in that screenshot — fill in the legs, then tap Research."
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
  const changeStake = (value: number) => {
    setStake(value);
    if (value > 0) localStorage.setItem(STAKE_STORAGE, String(value));
    // The pick just saved takes the new stake too.
    const existing = recordsRef.current.find((r) => r.id === activeId);
    if (!existing || !(value > 0)) return;
    const updated = stampWager(existing, value);
    commit(recordsRef.current.map((r) => (r.id === existing.id ? updated : r)), [updated]);
  };

  const quickAdd = async (links: string, paidCents: number | null, wager: number) => {
    const data = await settleKalshi(links);
    const slipFromLink: BetSlip = {
      legs: data.legs,
      comboPrice: data.comboPrice,
      comboOdds: null,
      comboTicker: data.comboTicker ?? undefined,
    };
    const record = importedRecord(slipFromLink, data.outcome, paidCents, wager);
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

  /**
   * Sync Results: with a synced key the server settles the whole Upstash vault (the same job
   * the hourly cron runs) and the page pulls the result; a local-only vault settles here.
   */
  const syncResults = async () => {
    if (!accessKey || sync !== "synced") return refreshOutcomes();
    try {
      const response = await fetch("/api/vault/sync-results", { method: "POST", headers: { "x-bet-key": accessKey } });
      const data = (await response.json()) as { settled?: number; updated?: number; error?: string };
      if (!response.ok) return refreshOutcomes();
      await syncRemote(accessKey);
      if (data.settled) return `Settled ${data.settled} pick${data.settled > 1 ? "s" : ""}.`;
      return data.updated ? "Updated leg results — nothing fully settled yet." : "Nothing new has settled yet.";
    } catch {
      return refreshOutcomes();
    }
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
      className={cn("bet-accent bet-app min-h-[100dvh] w-full overflow-x-clip text-white antialiased", T.bg)}
    >
      <header className="bet-safe-top sticky top-0 z-10 border-b border-[#1E2638] bg-[#050D0A]/90 backdrop-blur">
        {/* One slim line (44px) on every screen: logo, tabs, and the key button until it's synced. */}
        <div className="mx-auto flex h-11 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <BrandLogo className="shrink-0 text-[15px] sm:text-base" />
          <nav className="flex shrink-0 gap-0.5 rounded-full bg-[#121824] p-0.5">
            {(
              [
                ["evaluate", "Evaluate", null],
                ["vault", "Bet Vault", records.length || null],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors sm:px-4",
                  tab === id ? "bg-white text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
                )}
              >
                {label}
                {count && <span className="hidden sm:inline"> · {count}</span>}
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
            {/* Gone once the key works; shown (red) whenever it needs entering or fixing. */}
            {sync !== "synced" && (
              <button
                type="button"
                aria-label={keyBroken ? "Access key not working — tap to enter it" : "Access key"}
                title={typeof sync === "object" ? sync.error : undefined}
                onClick={() => setShowKey((s) => !s)}
                className="rounded-lg p-1.5 text-(--accent) transition-colors hover:bg-[#121824]"
              >
                <KeyRound className="size-4" />
              </button>
            )}
          </div>
        </div>
        {showKey && (
          <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-3 pb-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
            <input
              type="password"
              defaultValue={accessKey}
              placeholder="Access key (BET_ACCESS_KEY)"
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

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
        {tab === "vault" ? (
          <BetVault
            records={records}
            onOutcome={setOutcome}
            onDelete={removeRecord}
            onQuickAdd={quickAdd}
            onRefresh={syncResults}
          />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Slip input */}
            <section className="flex min-w-0 flex-col gap-4 sm:gap-5">
              <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
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
                <SlipReader onParsed={onParsed} accessKey={keyBroken ? "" : accessKey} />
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

              <div className={cn(T.card, "flex flex-col gap-2 p-4 sm:p-5")}>
                <label htmlFor="bet-stake" className={T.label}>
                  Overall Wager / Stake ($)
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative w-36 shrink-0">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#F5F7F4]/50">$</span>
                    <input
                      id="bet-stake"
                      inputMode="decimal"
                      value={stakeText}
                      onChange={(e) => {
                        const text = e.target.value.replace(/[^\d.]/g, "").slice(0, 9);
                        setStakeText(text);
                        changeStake(Math.min(100_000, Number(text) || 0));
                      }}
                      placeholder="10"
                      className={cn(T.input, "pl-7 tabular-nums")}
                    />
                  </div>
                  <p className={cn("text-xs leading-snug", T.muted)}>
                    {(() => {
                      const decimal = ticketDecimal(slip, ai);
                      if (!stake) return "Enter one stake for the whole ticket.";
                      if (!decimal) return `One stake for the whole ${multi ? "parlay" : "bet"} — payout shows once it's priced or researched.`;
                      const priced = multi ? !!(slip.comboPrice || slip.comboOdds || slip.legs.every((l) => l.price || l.americanOdds)) : !!(leg.price || leg.americanOdds);
                      return (
                        <>
                          Pays <span className="font-kalshi-bold text-white">{formatMoney(stake * decimal)}</span> if it hits
                          {priced ? "" : " (model odds)"}
                        </>
                      );
                    })()}
                  </p>
                </div>
              </div>

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
            <section className="flex min-w-0 flex-col gap-4 sm:gap-5 lg:sticky lg:top-14 lg:self-start">
              <div className={cn(T.card, "flex flex-col gap-5 p-4 sm:p-5")}>
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
                <div className={cn(T.card, "flex flex-col gap-5 p-4 sm:p-5")}>
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

                  {leg.price === null ? (
                    /* No market price (typed in by hand): the model's own odds stand alone. */
                    <div className={cn(T.inset, "grid grid-cols-2 gap-3 p-3")}>
                      <div>
                        <p className={T.label}>Model Win Prob</p>
                        <p className="font-kalshi-condensed mt-1 text-3xl tabular-nums">{ai ? pct(single.probability) : "—"}</p>
                      </div>
                      <div>
                        <p className={T.label}>Model Fair Odds</p>
                        <p className="font-kalshi-condensed mt-1 text-3xl tabular-nums">
                          {ai ? formatAmerican(probToAmerican(single.probability)) : "—"}
                        </p>
                      </div>
                      <p className={cn("col-span-2 text-[11px]", T.muted)}>
                        Import the Kalshi link or screenshot to compare against the market price and get an EV verdict.
                      </p>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}

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
