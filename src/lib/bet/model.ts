/**
 * /bet AI calls run on Haiku: the slip evaluator, slip reader, and the Top Picks screen that
 * checks every fixture. Claude Haiku 3.5 (claude-3-5-haiku-20241022) was retired on Feb 19,
 * 2026, so this is its current successor. Haiku has no server-side refusal fallback, so a
 * decline is just an error.
 */
export const BET_MODEL = "claude-haiku-5-5";

/**
 * The Top Picks deep stage: only the shortlisted finalists of a scan are re-researched on
 * Sonnet, with more searches and API-Football data, so the extra cost stays on legs that
 * might actually be bet. Server-side fallback is on, so a policy decline re-runs on another
 * model instead of failing.
 */
export const DEEP_MODEL = "claude-sonnet-5-5";
