import type { ChatTurn } from "@/types/me";

/**
 * Reads Instagram's "Download your information" export in the browser. The zip can be gigabytes
 * of photos, so only the zip's directory and the message JSON files are ever read from disk.
 */

/* --------------------------------- Zip -------------------------------------- */

interface ZipEntry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

const view = async (file: Blob, start: number, end: number) => new DataView(await file.slice(start, end).arrayBuffer());
const big = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

const zipEntries = async (file: File): Promise<ZipEntry[]> => {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = await view(file, tailStart, file.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`${file.name} isn't a zip`);
  let count = tail.getUint16(end + 10, true);
  let dirSize = tail.getUint32(end + 12, true);
  let dirAt = tail.getUint32(end + 16, true);
  // Zip64 (archives over 4GB): the real numbers are in a separate record.
  if (end >= 20 && tail.getUint32(end - 20, true) === 0x07064b50) {
    const at = big(tail, end - 12);
    const record = await view(file, at, at + 56);
    count = big(record, 32);
    dirSize = big(record, 40);
    dirAt = big(record, 48);
  }

  const dir = await view(file, dirAt, dirAt + dirSize);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let p = 0, n = 0; n < count && p + 46 <= dir.byteLength && dir.getUint32(p, true) === 0x02014b50; n++) {
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    let size = dir.getUint32(p + 20, true);
    let offset = dir.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(dir.buffer, p + 46, nameLength));
    for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength; e += 4 + dir.getUint16(e + 2, true)) {
      if (dir.getUint16(e, true) !== 1) continue;
      let q = e + 4;
      if (dir.getUint32(p + 24, true) === 0xffffffff) q += 8;
      if (size === 0xffffffff) {
        size = big(dir, q);
        q += 8;
      }
      if (offset === 0xffffffff) offset = big(dir, q);
    }
    entries.push({ name, method: dir.getUint16(p + 10, true), size, offset });
    p += 46 + nameLength + extraLength + dir.getUint16(p + 32, true);
  }
  return entries;
};

const readEntry = async (file: File, entry: ZipEntry) => {
  const head = await view(file, entry.offset, entry.offset + 30);
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const data = file.slice(start, start + entry.size);
  if (entry.method === 0) return data.text();
  if (entry.method !== 8) throw new Error("Unsupported zip compression");
  return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
};

/* ------------------------------- Messages ----------------------------------- */

interface IgMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  photos?: unknown[];
  videos?: unknown[];
  audio_files?: unknown[];
  gifs?: unknown[];
  sticker?: unknown;
  share?: { link?: string; share_text?: string };
}

interface IgFile {
  participants?: { name?: string }[];
  messages?: IgMessage[];
  thread_path?: string;
}

export interface IgThread {
  path: string;
  people: string[];
  messages: { from: string; text: string; at: number }[];
}

/** Instagram writes UTF-8 bytes as if they were Latin-1 ("ðŸ˜‚" for 😂); this undoes that. */
const fixText = (s: string) => {
  if (![...s].every((c) => c.charCodeAt(0) < 256)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
};

/** Instagram's own notices, which aren't anything anyone typed. */
const NOTICE =
  /^(reacted .+ to your message|liked a message|.+ sent an attachment\.|you sent an attachment\.|.+ shared a story\.|.+ (started|missed) (a |an )?(video|audio) (chat|call)|you missed a (video|audio) (chat|call)|.+ (left|joined) the (group|chat)\.?|.+ named the group .+|.+ changed the group photo\.?|.+ added .+ to the group\.?|.+ removed .+ from the group\.?|this message was unsent\.?|.+ unsent a message\.?)$/i;

const messageText = (m: IgMessage) => {
  const content = m.content ? fixText(m.content).trim() : "";
  if (content && !NOTICE.test(content)) return content;
  if (content) return null;
  if (m.photos?.length) return "[photo]";
  if (m.videos?.length) return "[video]";
  if (m.audio_files?.length) return "[voice message]";
  if (m.gifs?.length) return "[gif]";
  if (m.sticker) return "[sticker]";
  if (m.share) return "[shared a post]";
  return null;
};

const THREAD_FILE = /(?:^|\/)messages\/inbox\/([^/]+)\/message_\d+\.json$/;

/** Every chat in the picked zips (or loose message_N.json files), oldest message first. */
export const readInstagram = async (files: File[], onProgress: (note: string) => void): Promise<IgThread[]> => {
  const parts: { key: string; read: () => Promise<string> }[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".json")) {
      parts.push({ key: file.name, read: () => file.text() });
      continue;
    }
    onProgress(`Opening ${file.name}…`);
    for (const entry of await zipEntries(file)) {
      const match = THREAD_FILE.exec(entry.name);
      if (match) parts.push({ key: match[1], read: () => readEntry(file, entry) });
    }
  }
  if (!parts.length) throw new Error("No messages in that. Pick the zip(s) from Instagram's download, in JSON format.");

  const threads = new Map<string, IgThread>();
  for (let i = 0; i < parts.length; i++) {
    if (i % 20 === 0) onProgress(`Reading chats… ${i} of ${parts.length}`);
    let data: IgFile;
    try {
      data = JSON.parse(await parts[i].read()) as IgFile;
    } catch {
      continue;
    }
    const key = data.thread_path ?? parts[i].key;
    const thread = threads.get(key) ?? { path: key, people: (data.participants ?? []).map((p) => fixText(p.name ?? "")).filter(Boolean), messages: [] };
    for (const m of data.messages ?? []) {
      const text = messageText(m);
      if (text && m.sender_name && m.timestamp_ms) thread.messages.push({ from: fixText(m.sender_name), text, at: m.timestamp_ms });
    }
    threads.set(key, thread);
  }
  for (const t of threads.values()) t.messages.sort((a, b) => a.at - b.at);
  return [...threads.values()].filter((t) => t.messages.length);
};

/** Likely names for him, best first: he's in every chat, so the name in the most chats. */
export const ownerCandidates = (threads: IgThread[]) => {
  const count = new Map<string, number>();
  for (const t of threads) for (const name of new Set(t.messages.map((m) => m.from))) count.set(name, (count.get(name) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
};

/* ------------------------------ Conversations -------------------------------- */

/** A quiet stretch this long starts a new conversation. */
const GAP_MS = 6 * 60 * 60 * 1000;
const MAX_TURNS = 80;
/** A bit more than the style rebuild reads (120K characters); more would only sit unused. */
const TOTAL_CHARS = 150_000;
/** So one long-running chat doesn't crowd out everyone else. */
const THREAD_CHARS = 15_000;

export interface IgConversation {
  id: string;
  turns: ChatTurn[];
  createdAt: number;
}

const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

const size = (c: IgConversation) => c.turns.reduce((n, t) => n + t.text.length + 8, 0);

/**
 * Splits each chat into conversations and keeps the newest ones that fit, a fair share per
 * chat. Ids are stable, so importing the same download again replaces rather than duplicates.
 */
export const toConversations = (threads: IgThread[], me: string) => {
  const picked: IgConversation[] = [];
  for (const thread of threads) {
    const runs: IgThread["messages"][] = [];
    for (const m of thread.messages) {
      const run = runs.at(-1);
      if (run && m.at - run.at(-1)!.at < GAP_MS && run.length < MAX_TURNS) run.push(m);
      else runs.push([m]);
    }
    let used = 0;
    for (const run of runs.reverse()) {
      const turns = run.map((m): ChatTurn => ({ who: m.from === me ? "me" : "them", text: m.text.slice(0, 1000) }));
      if (turns.filter((t) => t.who === "me").length < 2) continue;
      const conversation = { id: `ig_${hash(thread.path)}_${run[0].at.toString(36)}`, turns, createdAt: run[0].at };
      used += size(conversation);
      if (used > THREAD_CHARS) break;
      picked.push(conversation);
    }
  }
  picked.sort((a, b) => b.createdAt - a.createdAt);
  const kept: IgConversation[] = [];
  let total = 0;
  for (const c of picked) {
    total += size(c);
    if (total > TOTAL_CHARS) break;
    kept.push(c);
  }
  return kept;
};
