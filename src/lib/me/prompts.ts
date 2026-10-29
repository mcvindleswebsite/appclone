import { SURVEY } from "@/data/me-survey";
import { SITUATIONS, type MeProfile, type StyleExample } from "@/types/me";

/**
 * The /me prompts. The rule that matters most: his life facts (survey answers, today notes)
 * are background the writer may reach for, never material it should push into a conversation.
 */

/** The always-on never-say list; his own additions are appended. These are the tells of AI writing. */
export const DEFAULT_BANNED = [
  "em dashes (—) or en dashes (–)",
  "semicolons",
  "\"I'd love to\"",
  "\"I couldn't help but notice\"",
  "\"partner in crime\"",
  "\"fellow ___\" (fellow foodie, fellow adventurer)",
  "\"adventure\" / \"journey\" / \"wanderlust\"",
  "\"intrigued\" / \"resonates\" / \"vibes\" used as a compliment",
  "\"That's so cool!\" / \"I love that!\" as an opener",
  "a compliment followed by a question, every time",
  "ending every message with a question",
  "\"what about you?\" / \"how about you?\"",
  "perfect grammar and punctuation unless his examples have it",
  "more words than he'd type",
];

/**
 * Example budgets in characters, newest kept. Every Opus call pays for these input tokens, so
 * they're sized to what copying a voice needs: replies lean on the style guide plus a recent
 * sample (~10K tokens); the occasional style rebuild reads more (~30K tokens).
 */
const WRITE_EXAMPLE_CHARS = 40_000;
const STYLE_EXAMPLE_CHARS = 120_000;

const renderExample = (e: StyleExample, i: number) =>
  `<example n="${i + 1}" situation="${e.situation}"${e.source === "sent" ? ' source="he sent this"' : ""}>\n${e.turns
    .map((t) => `${t.who === "me" ? "VINCENT" : "THEM"}: ${t.text}`)
    .join("\n")}\n</example>`;

export const renderExamples = (examples: StyleExample[], maxChars = WRITE_EXAMPLE_CHARS) => {
  const out: string[] = [];
  let size = 0;
  for (let i = examples.length - 1; i >= 0; i--) {
    const text = renderExample(examples[i], i);
    if (size + text.length > maxChars) break;
    out.unshift(text);
    size += text.length;
  }
  return out.join("\n\n");
};

const answered = (profile: MeProfile, sections?: string[]) =>
  SURVEY.filter((q) => profile.answers[q.id]?.trim() && (!sections || sections.includes(q.section)))
    .map((q) => `Q: ${q.question}\nA: ${profile.answers[q.id]!.trim()}`)
    .join("\n\n");

/* ----------------------------- Reading examples ----------------------------- */

export const EXTRACT_SYSTEM = `You turn screenshots and pasted text of Vincent's conversations into clean transcripts, so another model can learn exactly how he texts.

- In screenshots from iMessage, Instagram, Hinge, Snapchat and similar apps, Vincent's messages are the ones on the right (usually the colored bubbles); the other person's are on the left.
- Pasted text with no speaker labels is all Vincent's messages.
- Transcribe every message bubble you can see, top to bottom, including ones cut off at the top or bottom edge (copy the visible part). Never summarize, sample, or skip "repetitive" messages: the count matters, and a screenshot usually holds 10 to 60 bubbles.
- Each bubble is its own turn, even when one person sends several in a row.
- Copy every message exactly as written: same capitalization, spelling, slang, punctuation, emoji, and typos. Never fix or tidy anything.
- Leave out timestamps, read receipts, reactions, app UI, and names in headers. Describe a sent photo or GIF as [photo] or [gif].
- Separate conversations (different people or screenshots that don't connect) are separate entries.
- Label each conversation with the situation it mostly shows: ${SITUATIONS.join(", ")}.
- If an image isn't a conversation, skip it.`;

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    conversations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          situation: { type: "string", enum: [...SITUATIONS] },
          turns: {
            type: "array",
            items: {
              type: "object",
              properties: { who: { type: "string", enum: ["me", "them"] }, text: { type: "string" } },
              required: ["who", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["situation", "turns"],
        additionalProperties: false,
      },
    },
  },
  required: ["conversations"],
  additionalProperties: false,
};

/* ------------------------------- Style guide -------------------------------- */

export const STYLE_SYSTEM = `You study how one person texts and write a style guide another model will follow to write as him. The guide is only about how he writes, not facts about his life.

Be specific and evidence-based: quote his real words. Cover:
- Capitalization, punctuation, spelling and abbreviations (exactly what he does and doesn't do)
- Message length, and how many bubbles he splits a thought into
- His vocabulary: slang and phrases he repeats, and normal words he never uses
- Emoji and reactions: which ones, how often
- His humor: the kind of jokes and bits, how he roasts, how he plays along with someone else's joke
- How he flirts: how forward, compliments, teasing, escalation
- How he opens, how he keeps a dry conversation going, how he makes plans, how he turns someone down
- What he never does

Write it as a tight list of rules with examples, under 900 words. Where the examples are thin, say so instead of guessing.`;

export const styleInput = (examples: StyleExample[], profile: MeProfile) =>
  [
    `<examples>\n${renderExamples(examples, STYLE_EXAMPLE_CHARS)}\n</examples>`,
    // His own description of how he texts and jokes: weigh it below what the examples show.
    answered(profile, ["How you text", "Your humor"]) ? `<his_description_of_himself>\n${answered(profile, ["How you text", "Your humor"])}\n</his_description_of_himself>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

/* --------------------------------- Writing ---------------------------------- */

export type WriteMode = "reply" | "opener";

const FACTS_RULES = `How to use <background>:
It's reference, not material. Most replies should use none of it. Use a fact only when the other person asked about it or the conversation is already directly on that topic, and then only as much as he'd casually say. Never volunteer his plans, schedule, job, or what he did today; never steer the conversation toward his life; never mention his day just because it's there. A reply that sounds like him and stays on what the other person said beats one that shows off a fact. Never invent a fact about him that isn't here: if a reply needs one you don't have, write [___] for him to fill in. Respect everything under Boundaries. List every fact an option uses in usedFacts (usually an empty list).`;

export const writeStable = (examples: StyleExample[], profile: MeProfile) =>
  [
    `You ghostwrite texts for Vincent. Whatever you write, he copies into the app and sends as himself, so it has to be indistinguishable from his own texts: same length, same lowercase-or-not, same slang, same kind of jokes, same energy. Match the examples over any instinct of your own. Sounding like a polished, friendly AI is the failure; a slightly messy, specific, funny text in his voice is the goal.`,
    profile.style ? `<style_guide>\n${profile.style}\n</style_guide>` : "",
    `<examples>\nReal conversations. VINCENT is him.\n${renderExamples(examples) || "(none yet: write plainly and casually, short, lowercase)"}\n</examples>`,
    `<never_write>\n${[...DEFAULT_BANNED, ...profile.banned.map((b) => `"${b}"`)].map((b) => `- ${b}`).join("\n")}\n</never_write>`,
    `<background>\n${answered(profile) || "(nothing yet)"}\n</background>`,
    FACTS_RULES,
    `Write three options that are actually different from each other (different angle or joke, not the same line reworded). Each option is what he'd send in one go: put each separate text bubble on its own line. In why, say in a few plain words why it should get a reply.`,
  ]
    .filter(Boolean)
    .join("\n\n");

/** Today notes change daily, so they sit after the cached prompt. */
export const writeVolatile = (profile: MeProfile, now = Date.now()) => {
  const recent = profile.today.filter((n) => now - n.at < 2 * 24 * 60 * 60 * 1000);
  if (!recent.length) return undefined;
  const when = (at: number) => (now - at < 24 * 60 * 60 * 1000 ? "today" : "yesterday");
  return `<background_today>\nWhat he's been up to (same rules as <background>: only if the conversation is on it, never volunteered):\n${recent
    .map((n) => `- ${when(n.at)}: ${n.text}`)
    .join("\n")}\n</background_today>`;
};

export const writeTask = (mode: WriteMode, note: string) =>
  [
    mode === "reply"
      ? "The screenshots/text are a conversation he's in; his messages are on the right. Write his next reply to the latest message. If it's his turn after a dead stretch, write something that revives it the way he would."
      : "The screenshots are a Hinge profile. Pick the prompts or photos that give him the best opening and write a comment on one specific thing (one option per target, set target to which prompt or photo it answers). It should be specific to this profile, not a line that works on anyone, and likely to get a reply.",
    note ? `What he wants from this one: ${note}` : "",
    "In read, summarize what you see in a sentence or two (who said what last, or what's on the profile).",
  ]
    .filter(Boolean)
    .join("\n");

export const WRITE_SCHEMA = {
  type: "object",
  properties: {
    read: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, target: { type: "string" }, why: { type: "string" } },
        required: ["text", "target", "why"],
        additionalProperties: false,
      },
    },
    usedFacts: { type: "array", items: { type: "string" } },
  },
  required: ["read", "options", "usedFacts"],
  additionalProperties: false,
};
