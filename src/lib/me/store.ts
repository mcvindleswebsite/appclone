import { redis } from "@/lib/bet/store";
import type { MeProfile, StyleExample } from "@/types/me";

/** /me data in Upstash: examples one per hash field, everything else in one profile document. */
const EXAMPLES_KEY = "vindle_me_examples";
const PROFILE_KEY = "vindle_me_profile";

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

export const deleteExample = async (id: string) => need(await redis(["HDEL", EXAMPLES_KEY, id]));

export const readProfile = async (now = Date.now()): Promise<MeProfile> => {
  const reply = need(await redis(["GET", PROFILE_KEY]));
  const stored = typeof reply.result === "string" ? (JSON.parse(reply.result) as Partial<MeProfile>) : {};
  const profile = { ...EMPTY_PROFILE, ...stored };
  return { ...profile, today: profile.today.filter((n) => now - n.at < TODAY_KEEP_MS) };
};

export const writeProfile = async (profile: MeProfile) => need(await redis(["SET", PROFILE_KEY, JSON.stringify(profile)]));

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
