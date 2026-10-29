import { redis } from "@/lib/bet/store";
import type { MeProfile, MeSource, StyleExample } from "@/types/me";

/** /me data in Upstash: examples one per hash field, everything else in one profile document. */
const EXAMPLES_KEY = "vindle_me_examples";
const PROFILE_KEY = "vindle_me_profile";
/** The screenshots and pastes examples were read from, one per hash field, for rescans. */
const SOURCES_KEY = "vindle_me_sources";
/** Dollars spent on AI calls, one field per month ("2026-10"), plus "<month>:calls". */
const SPEND_KEY = "vindle_me_spend";

/** Today notes stay this long; only the last day or two ever reach the AI. */
const TODAY_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

export const EMPTY_PROFILE: MeProfile = {
  answers: {},
  today: [],
  banned: [],
  style: null,
  styleBuiltAt: null,
  styleExamples: 0,
  surveyDismissed: false,
};

export class StoreMissing extends Error {}

const need = <T>(reply: T | null): T => {
  if (!reply) throw new StoreMissing("Store not configured");
  return reply;
};

/** Oldest first, so the prompt built from them stays stable (and cached) as new ones are added. */
export const readExamples = async (): Promise<StyleExample[]> => {
  const flat = (need(await redis(["HGETALL", EXAMPLES_KEY])).result as string[] | null) ?? [];
  const examples: StyleExample[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      examples.push(JSON.parse(flat[i]) as StyleExample);
    } catch {
      // Skip a corrupt entry.
    }
  }
  return examples.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
};

export const addExamples = async (examples: StyleExample[]) => {
  if (!examples.length) return;
  need(await redis(["HSET", EXAMPLES_KEY, ...examples.flatMap((e) => [e.id, JSON.stringify(e)])]));
};

export const deleteExamples = async (ids: string[]) => {
  if (ids.length) need(await redis(["HDEL", EXAMPLES_KEY, ...ids]));
};

export const addSource = async (source: MeSource) => need(await redis(["HSET", SOURCES_KEY, source.id, JSON.stringify(source)]));

export const readSource = async (id: string): Promise<MeSource | null> => {
  const reply = need(await redis(["HGET", SOURCES_KEY, id]));
  return typeof reply.result === "string" ? (JSON.parse(reply.result) as MeSource) : null;
};

/** Source ids, oldest first (ids start with a timestamp). */
export const sourceIds = async () => (((need(await redis(["HKEYS", SOURCES_KEY])).result as string[] | null) ?? []).sort());

export const deleteSource = async (id: string) => need(await redis(["HDEL", SOURCES_KEY, id]));

export const readProfile = async (now = Date.now()): Promise<MeProfile> => {
  const reply = need(await redis(["GET", PROFILE_KEY]));
  const stored = typeof reply.result === "string" ? (JSON.parse(reply.result) as Partial<MeProfile>) : {};
  const profile = { ...EMPTY_PROFILE, ...stored };
  return { ...profile, today: profile.today.filter((n) => now - n.at < TODAY_KEEP_MS) };
};

export const writeProfile = async (profile: MeProfile) => need(await redis(["SET", PROFILE_KEY, JSON.stringify(profile)]));

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const month = (now = new Date()) => now.toISOString().slice(0, 7);

export const addSpend = async (dollars: number) => {
  const m = month();
  await redis(["HINCRBYFLOAT", SPEND_KEY, m, dollars.toFixed(6)]);
  await redis(["HINCRBY", SPEND_KEY, `${m}:calls`, 1]);
};

export const readSpend = async () => {
  const m = month();
  const reply = need(await redis(["HMGET", SPEND_KEY, m, `${m}:calls`]));
  const [total, calls] = (reply.result as (string | null)[] | null) ?? [];
  return { month: m, total: Number(total ?? 0), calls: Number(calls ?? 0) };
};
