/**
 * /bet AI calls run on Haiku: the slip evaluator, slip reader, and the Top Picks screen that
 * checks every fixture. Claude Haiku 3.5 (claude-3-5-haiku-20241022) was retired on Feb 19,
 * 2026, so this is its current successor. Haiku has no server-side refusal fallback, so a
 * decline is just an error.
 */
export const BET_MODEL = "claude-haiku-5-5";

/**
 * The Top Picks deep check: run on demand from a pick's button (never automatically), on
 * Sonnet with API-Football data, so the extra cost lands only on picks you'd actually bet.
 * Server-side fallback is on, so a policy decline re-runs on another model instead of failing.
 */
export const DEEP_MODEL = "claude-sonnet-5-5";
