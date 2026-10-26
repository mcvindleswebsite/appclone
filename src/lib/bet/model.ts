/**
 * Every /bet AI call is locked to Haiku, with no fallback to Sonnet or Opus. Claude Haiku 3.5
 * (claude-3-5-haiku-20241022, alias claude-3-5-haiku-latest) was retired on Feb 19, 2026 and
 * now returns an error, so this is its current successor. Haiku has no server-side refusal
 * fallback, so a decline is just an error.
 */
export const BET_MODEL = "claude-haiku-5-5";
