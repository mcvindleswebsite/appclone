import { checkAccess } from "@/lib/bet/access";
import { describeVaultProfile } from "@/lib/bet/history";
import { loadProfile } from "@/lib/bet/profile";
import { scan, type PickMode } from "@/lib/bet/scan";
import { isScanLeague, isTimeWindow, SOCCER_SCAN_LEAGUES, windowRange, type ScanScope } from "@/lib/bet/scan-scope";
import { redis } from "@/lib/bet/store";
import { trackPicks } from "@/lib/bet/track";
import type { SoccerRecommendation } from "@/types/bet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

type Body = Partial<Record<keyof ScanScope | "history" | "mode", unknown>>;

/** The scope from the request body; anything missing falls back to every league, this week. */
const readScope = (body: Body): ScanScope => {
  const window = isTimeWindow(body.window) ? body.window : "week";
  const fallback = windowRange(window, Date.now());
  const from = typeof body.from === "number" && Number.isFinite(body.from) ? body.from : fallback.from;
  const to = typeof body.to === "number" && Number.isFinite(body.to) ? body.to : fallback.to;
  const leagues = Array.isArray(body.leagues) ? body.leagues.filter(isScanLeague) : [];
  return { window, from, to: Math.max(from, to), leagues: leagues.length ? leagues : [...SOCCER_SCAN_LEAGUES] };
};

/** Short, stable hash, so a changed Bet Vault record means a fresh scan rather than a stale cache hit. */
const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** One cache entry per mode, league set, hour-rounded window, and Bet Vault profile. */
const cacheKey = (scope: ScanScope, history: string, mode: PickMode) => {
  const hour = 60 * 60 * 1000;
  const range = scope.window === "futures" ? "" : `:${Math.floor(scope.from / hour)}`;
  return `${CACHE_KEY}:v4:${mode}:${scope.window}${range}:${[...scope.leagues].sort().join(",")}:${hash(history)}`;
};

/**
 * Scans soccer and basketball markets on Kalshi in the requested leagues and time window and returns the
 * best +EV picks, each in a fixed pick structure. Body: ScanScope plus `history`, a
 * VaultProfile of the bettor's Bet Vault (used when Upstash isn't connected). Every pick is
 * also logged to the scanner's track record. Results are cached for 30 minutes (when
 * Upstash is connected); `?fresh=1` forces a new scan. The deep check is on demand, per pick
 * (/api/recommendations/deep).
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const scope = readScope(body);
  const mode: PickMode = (["sharp", "safe", "ai", "mismatch"] as const).find((m) => m === body.mode) ?? "opinion";
  const profile = await loadProfile(body.history);
  const key = cacheKey(scope, describeVaultProfile(profile), mode);
  if (!fresh) {
    const cached = await redis(["GET", key]).catch(() => null);
    if (typeof cached?.result === "string") {
      return Response.json({ ...(JSON.parse(cached.result) as SoccerRecommendation), cached: true });
    }
  }

  try {
    const result = await scan(scope, profile, mode);
    // Cached even when empty: an empty scan costs as much as a full one.
    await Promise.all([
      redis(["SET", key, JSON.stringify(result), "EX", CACHE_SECONDS]).catch(() => null),
      result.legs.length ? trackPicks(result.legs) : null,
    ]);
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan failed — Kalshi or the AI didn't respond" }, { status: 502 });
  }
}
