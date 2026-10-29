import { SURVEY } from "@/data/me-survey";
import { meRoute, str } from "@/lib/me/handler";
import { newId, readExamples, readProfile, writeProfile } from "@/lib/me/store";

export const dynamic = "force-dynamic";

const SURVEY_IDS = new Set(SURVEY.map((q) => q.id));
const MAX_ANSWER = 1500;
const MAX_TODAY = 30;
const MAX_BANNED = 100;

export async function GET(request: Request) {
  return meRoute(request, async () => {
    const [profile, examples] = await Promise.all([readProfile(), readExamples()]);
    return Response.json({ profile, examples: examples.length });
  });
}

/**
 * Partial update. Body: `answers` (merged; an empty answer clears it), `addToday` (a note),
 * `removeToday` (a note id), `banned` (the whole list), `surveyDismissed`.
 */
export async function PATCH(request: Request) {
  return meRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const profile = await readProfile();

    if (body?.answers && typeof body.answers === "object") {
      const answers = { ...profile.answers };
      for (const [id, value] of Object.entries(body.answers as Record<string, unknown>)) {
        if (!SURVEY_IDS.has(id)) continue;
        const answer = str(value, MAX_ANSWER);
        if (answer) answers[id] = answer;
        else delete answers[id];
      }
      profile.answers = answers;
    }
    const note = str(body?.addToday, 600);
    if (note) profile.today = [{ id: newId(), text: note, at: Date.now() }, ...profile.today].slice(0, MAX_TODAY);
    if (typeof body?.removeToday === "string") profile.today = profile.today.filter((n) => n.id !== body.removeToday);
    if (Array.isArray(body?.banned)) {
      profile.banned = body.banned
        .map((b) => str(b, 120))
        .filter(Boolean)
        .slice(0, MAX_BANNED);
    }
    if (typeof body?.surveyDismissed === "boolean") profile.surveyDismissed = body.surveyDismissed;

    await writeProfile(profile);
    return Response.json({ profile });
  });
}
