export type Speaker = "me" | "them";

export interface ChatTurn {
  who: Speaker;
  text: string;
}

export const SITUATIONS = ["opener", "banter", "flirting", "plans", "reviving", "dry", "turning-down", "other"] as const;
export type Situation = (typeof SITUATIONS)[number];

/** One conversation (or run of messages) that shows how Vincent texts. */
export interface StyleExample {
  id: string;
  /** "sent": a reply the AI wrote (or he edited) that he actually sent. "instagram": from his data download. */
  source: "screenshot" | "text" | "sent" | "instagram";
  situation: Situation;
  turns: ChatTurn[];
  createdAt: number;
  /** The saved screenshot or paste it was read from, so it can be rescanned. */
  sourceId?: string;
}

/** A screenshot or paste kept after reading, so a better reader can go over it again. */
export interface MeSource {
  id: string;
  image?: ImageInput;
  text?: string;
  createdAt: number;
}

/** What he did today: background the AI may use only when a conversation is on it. */
export interface TodayNote {
  id: string;
  text: string;
  at: number;
}

export interface MeProfile {
  /** Survey answers by question id. */
  answers: Record<string, string>;
  today: TodayNote[];
  /** His own additions to the never-say list. */
  banned: string[];
  /** The distilled style guide, rebuilt from the examples. */
  style: string | null;
  styleBuiltAt: number | null;
  /** How many examples the current style guide was built from. */
  styleExamples: number;
  /** He chose "later" on the first-open survey prompt. */
  surveyDismissed: boolean;
}

export interface ReplyOption {
  /** One message per line: each line is its own text bubble. */
  text: string;
  /** For openers: the prompt or photo it answers. */
  target: string;
  /** Why this one should get a reply, in a few words. */
  why: string;
}

export interface ReplyResult {
  options: ReplyOption[];
  /** What the AI read from the screenshots, briefly, so a misread is obvious. */
  read: string;
  /** Background facts (survey answers or today notes) any option leans on; usually empty. */
  usedFacts: string[];
}

export interface ImageInput {
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Base64, no data: prefix. */
  data: string;
}
