import { checkAccess } from "@/lib/bet/access";
import { footballFacts } from "@/lib/bet/football-api";
import { describeVaultProfile } from "@/lib/bet/history";
import { failReason, mismatchFailReason, opinionFailReason, safeFailReason } from "@/lib/bet/picks";
import { loadProfile } from "@/lib/bet/profile";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, sportOfLeague } from "@/lib/bet/scan-scope";
import type { BetLeg, LegAnalysis, SharpLine } from "@/types/bet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Verified stats first, then the model's, without repeating a metric. */
const mergeStats = (verified: LegAnalysis["reasoningStats"] = [], model: LegAnalysis["reasoningStats"] = []) => {
  const seen = new Set(verified.map((s) => s.metric.toLowerCase()));
  return [...verified, ...model.filter((s) => !seen.has(s.metric.toLowerCase()))].slice(0, 10);
};

/**
 * The on-demand deep check for one Top Pick: API-Football's verified match data plus a
 * fresh research call on the deep model, then the same bar the scan applies. Run from the
 * pick's "Deep check" button only, so the stronger model's cost lands on picks you'd bet.
 *
 * Body: { leg, league, kickoffTime, volume, sharp?, futures?, history?, mode? }.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const raw = (body.leg ?? {}) as Record<string, unknown>;
  const price = num(raw.price);
  const leg: BetLeg = {
    sport: sportOfLeague(String(body.league)) === "basketball" ? String(body.league) : "Soccer",
    matchup: str(raw.matchup, 120),
    market: str(raw.market, 200),
    pick: str(raw.pick, 80),
    price: price !== null && price >= 1 && price <= 99 ? Math.round(price) : null,
    americanOdds: null,
    ticker: str(raw.ticker, 80) || undefined,
    side: "yes",
  };
  if (!leg.matchup || !leg.pick || !isScanLeague(body.league)) {
    return Response.json({ error: "Not a Top Picks leg" }, { status: 400 });
  }
  const s = (body.sharp ?? null) as Record<string, unknown> | null;
  const fair = num(s?.fair);
  const edge = num(s?.edge);
  const sharp: SharpLine | undefined = fair !== null && edge !== null ? { fair, edge, source: str(s?.source, 40) } : undefined;
  const futures = body.futures === true;

  try {
    const [profile, facts] = await Promise.all([
      loadProfile(body.history),
      futures ? null : footballFacts(body.league, leg.matchup, str(body.kickoffTime, 40)),
    ]);
    const analysis = await researchLeg(leg, describeVaultProfile(profile), { deep: true, facts: facts?.text });
    if (!analysis.researched) return Response.json({ error: "The deep check didn't finish — try again." }, { status: 502 });
    const merged = facts ? { ...analysis, reasoningStats: mergeStats(facts.stats, analysis.reasoningStats) } : analysis;
    // The same bar the pick's scan mode used.
    const bars: Record<string, typeof failReason> = {
      safe: safeFailReason,
      mismatch: mismatchFailReason,
      opinion: opinionFailReason,
    };
    const bar = bars[String(body.mode)] ?? failReason;
    return Response.json({
      analysis: merged,
      footballData: !!facts,
      // Null: the pick still clears the bar after the deep check.
      failReason: bar({ price: leg.price, volume: num(body.volume) ?? 0, sharp, futures }, merged),
    });
  } catch {
    return Response.json({ error: "The deep check failed — the AI didn't respond." }, { status: 502 });
  }
}
