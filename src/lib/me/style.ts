import { askText } from "@/lib/me/claude";
import { STYLE_SYSTEM, styleInput } from "@/lib/me/prompts";
import { readExamples, readProfile, writeProfile } from "@/lib/me/store";

/** Re-reads every example and rewrites the style guide. Returns the updated profile. */
export const rebuildStyle = async () => {
  const [examples, profile] = await Promise.all([readExamples(), readProfile()]);
  if (!examples.length) return profile;
  const { text: style } = await askText(STYLE_SYSTEM, [{ type: "text", text: styleInput(examples, profile) }], "medium");
  // Re-read so survey answers saved meanwhile aren't overwritten.
  const latest = await readProfile();
  const next = { ...latest, style: style.trim(), styleBuiltAt: Date.now(), styleExamples: examples.length };
  await writeProfile(next);
  return next;
};
