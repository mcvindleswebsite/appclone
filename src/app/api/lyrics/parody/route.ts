import Anthropic from "@anthropic-ai/sdk";

import { checkLyricsAccess } from "@/lib/lyrics/access";
import { countSyllables } from "@/lib/lyrics/chunks";
import {
  MAX_BRIEF_CHARS,
  MAX_LINE_CHARS,
  MAX_LINES_PER_CHUNK,
  SYLLABLE_TOLERANCE,
  type ParodyAssistRequest,
  type ParodyAssistResponse,
} from "@/types/lyrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Claude Haiku 5.5: the current successor to Claude 3.5 Haiku (claude-3-5-haiku-20241022, retired
 * Feb 19, 2026). The API no longer accepts temperature, so the strict JSON schema and low effort
 * keep the output consistent instead.
 */
const MODEL = "claude-haiku-5-5";
/** Short on purpose: just enough to finish one chunk. */
const MAX_TOKENS = 250;
/** Extra rounds for lines that miss their syllable count, each told exactly how far off it was. */
const FIT_RETRIES = 2;

const SYSTEM = `You are a creative song parody writer. Analyze the provided original verse for rhyme scheme, meter, and syllable count. Complete the user's partial lines or draft the rest of the verse matching their comedic theme.

You get one chunk of a song (a verse, chorus, or bridge): its original lines with syllable counts, and the user's draft parody lines, some full, some partial, some empty. Give the theme in a few words and the rhyme scheme as letters (e.g. AABB). The parody must be singable over the original melody:
- Return exactly one parody line per original line, in order.
- Keep every word the user already wrote. A drafted line stays as written; a partial line must begin with the user's exact text and you finish it.
- Each line must have exactly the syllable count shown for its original line, so it fits the melody. Count every syllable before you answer: the app counts them and throws out any line that misses.
- Match the original's rhyme scheme.
- Follow what the parody is about (the user's description of the whole song), any extra direction for this chunk, and the theme their drafts establish. Make it funny and specific, not generic.
- Write new lyrics only; never reuse more than a short phrase of the original lines.`;

const SCHEMA = {
  type: "object",
  properties: {
    theme: { type: "string" },
    rhymeScheme: { type: "string" },
    lines: { type: "array", items: { type: "string" } },
  },
  required: ["theme", "rhymeScheme", "lines"],
  additionalProperties: false,
} as const;

type Raw = { theme: string; rhymeScheme: string; lines: string[] };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const fits = (line: string, target: number) => Math.abs(countSyllables(line) - target) <= SYLLABLE_TOLERANCE;
const startsWithDraft = (line: string, draft: string) =>
  line.trim().toLowerCase().startsWith(draft.trim().toLowerCase());

/** AI Parody Assist: finishes a chunk's parody from the user's partial lines and direction. */
export async function POST(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const body = ((await request.json().catch(() => null)) ?? {}) as Partial<ParodyAssistRequest>;
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_LINES_PER_CHUNK).map((l) => ({
    original: clip(l?.original, MAX_LINE_CHARS),
    parody: clip(l?.parody, MAX_LINE_CHARS),
  }));
  const brief = clip(body.brief, MAX_BRIEF_CHARS).trim();
  const direction = clip(body.direction, 1000).trim();
  if (!lines.length) return Response.json({ error: "Pick a chunk with lyrics" }, { status: 400 });
  if (!brief && !direction && lines.every((l) => !l.parody.trim())) {
    return Response.json({ error: "Describe the parody at the top of the page, or write a partial line first" }, { status: 400 });
  }

  const prompt = [
    `Song: "${clip(body.song?.title, 200)}" by ${clip(body.song?.artist, 200)}`,
    `Chunk: ${clip(body.label, 40)}`,
    brief ? `What the parody is about: ${brief}` : "",
    direction ? `Extra direction for this chunk: ${direction}` : "",
    !brief && !direction ? "Comedic direction: follow the theme of the drafts." : "",
    clip(body.context, 6000).trim() ? `Parody so far in other chunks (keep the theme consistent):\n${clip(body.context, 6000)}` : "",
    "Lines:",
    ...lines.map(
      (l, i) =>
        `${i + 1}. original (${countSyllables(l.original)} syllables; write exactly ${countSyllables(l.original)}): ${l.original}\n   draft: ${l.parody.trim() || "(empty)"}`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const targets = lines.map((l) => countSyllables(l.original));
  /** One line per original; the user's own words always survive. */
  const merge = (raw: Raw) =>
    lines.map((l, i) => {
      const draft = l.parody.trim();
      const line = (raw.lines[i] ?? "").trim().slice(0, MAX_LINE_CHARS);
      return draft && !startsWithDraft(line, draft) ? draft : line || draft;
    });
  /** Lines the AI wrote (not the user's untouched draft) that miss their syllable count. */
  const misses = (out: string[]) =>
    out.flatMap((line, i) => (line && line !== lines[i].parody.trim() && !fits(line, targets[i]) ? [i] : []));

  try {
    const client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    let raw: Raw | null = null;
    let out: string[] = [];
    let off: number[] = [];
    for (let round = 0; round <= FIT_RETRIES; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Thinking would spend the small token budget before any lyrics are written.
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages,
      });
      if (response.stop_reason === "refusal") return Response.json({ error: "The AI declined this one" }, { status: 422 });
      if (response.stop_reason === "max_tokens") {
        if (raw) break;
        return Response.json({ error: "The AI ran out of room — try a shorter chunk" }, { status: 502 });
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const next = JSON.parse(text) as Raw;
      const merged = merge(next);
      // Lines that already fit stay from earlier rounds; only the misses get rewritten.
      out = raw ? out.map((line, i) => (off.includes(i) ? merged[i] : line)) : merged;
      raw = next;
      off = misses(out);
      if (!off.length || round === FIT_RETRIES) break;
      messages.push(
        { role: "assistant", content: text },
        {
          role: "user",
          content: `These lines don't fit the melody. Rewrite only them to the exact syllable count, keep every other line as it is, and return all ${lines.length} lines again:\n${off
            .map((i) => `${i + 1}. "${out[i]}" has ${countSyllables(out[i])} syllables; it needs ${targets[i]}.`)
            .join("\n")}`,
        }
      );
    }
    if (!raw) return Response.json({ error: "AI request failed" }, { status: 502 });

    // Anything still off is dropped: the line goes back to the user's draft (or stays empty).
    const result: ParodyAssistResponse = {
      analysis: { theme: raw.theme, rhymeScheme: raw.rhymeScheme, syllables: targets },
      lines: out.map((line, i) => (off.includes(i) ? lines[i].parody : line)),
      unfit: off,
    };
    return Response.json(result);
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "The AI returned malformed JSON" }, { status: 502 });
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited" }, { status: 429 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: `AI error ${error.status ?? ""}`.trim() }, { status: 502 });
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
}
