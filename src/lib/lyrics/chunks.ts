import type { LyricChunk, LyricLine } from "@/types/lyrics";

const newId = () => Math.random().toString(36).slice(2, 10);

/** Lowercased letters and digits only, so "Hello, World!" matches "hello world". */
export const normalizeLine = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Rough English syllable count: vowel groups, minus a silent trailing e. Good enough to compare lines. */
export const countSyllables = (line: string) =>
  normalizeLine(line)
    .split(" ")
    .filter(Boolean)
    .reduce((total, word) => {
      if (/^\d+$/.test(word)) return total + word.length;
      const w = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
      return total + Math.max(1, w.match(/[aeiouy]{1,2}/g)?.length ?? 0);
    }, 0);

interface TimedLine {
  time: number;
  text: string;
}

/** "[01:23.45] line" rows of an LRC file, in order. Rows with empty text mark stanza breaks. */
export const parseLrc = (lrc: string): TimedLine[] => {
  const rows: TimedLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) rows.push({ time: Math.round((Number(m[1]) * 60 + Number(m[2])) * 100) / 100, text: m[3].trim() });
  }
  return rows;
};

const stanzasFromPlain = (plain: string) =>
  plain
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    .filter((block) => block.length > 0);

/** Splits synced rows into stanzas at empty rows or long gaps. */
const stanzasFromSynced = (rows: TimedLine[]) => {
  const stanzas: TimedLine[][] = [];
  let current: TimedLine[] = [];
  for (const row of rows) {
    const gap = current.length ? row.time - current[current.length - 1].time : 0;
    if ((!row.text || gap > 8) && current.length) {
      stanzas.push(current);
      current = [];
    }
    if (row.text) current.push(row);
  }
  if (current.length) stanzas.push(current);
  return stanzas;
};

/**
 * Some LRCLIB lyrics have no blank lines, so the whole song is one stanza. Splits one by its
 * chorus: the most repeated line (3+ times) is the hook, lines repeated about as often are
 * chorus lines, and each run of them from a hook is a chunk. Other runs split into 4-line phrases.
 */
const splitLongStanza = <L extends { text: string }>(lines: L[]): L[][] => {
  if (lines.length <= 12) return [lines];
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(normalizeLine(l.text), (counts.get(normalizeLine(l.text)) ?? 0) + 1);
  const [hook, hookCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const isChorusLine = (l: L) => (counts.get(normalizeLine(l.text)) ?? 0) >= Math.max(2, hookCount * 0.6);

  const runs: L[][] = [];
  let current: L[] = [];
  let inChorus = false;
  for (const l of lines) {
    const isHook = hookCount >= 3 && normalizeLine(l.text) === hook;
    const chorus: boolean = hookCount >= 3 && (isHook || (inChorus && isChorusLine(l)));
    if (current.length && (isHook || chorus !== inChorus)) {
      runs.push(current);
      current = [];
    }
    inChorus = chorus;
    current.push(l);
  }
  if (current.length) runs.push(current);
  return runs.flatMap((run) =>
    run.length <= 8 ? [run] : Array.from({ length: Math.ceil(run.length / 4) }, (_, i) => run.slice(i * 4, i * 4 + 4))
  );
};

/**
 * Names each stanza from its position and repetition: repeated stanzas are the Chorus, a
 * one-off between the second chorus and a later one is the Bridge, a one-off after the last
 * chorus at the end is the Outro (as is a short last line in a song without one), and the rest are numbered verses.
 */
const labelStanzas = (stanzas: string[][]) => {
  const keys = stanzas.map((s) => s.map(normalizeLine).join("|"));
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const isChorus = keys.map((k, i) => (counts.get(k) ?? 0) >= 2 && stanzas[i].length >= 2);
  const chorusAt = isChorus.flatMap((c, i) => (c ? [i] : []));
  const lastChorus = chorusAt.at(-1) ?? -1;

  let verse = 0;
  let bridged = false;
  return stanzas.map((s, i) => {
    if (isChorus[i]) return "Chorus";
    // Back-to-back chorus chunks are one chorus section.
    const chorusesBefore = chorusAt.filter((c) => c < i && !isChorus[c + 1]).length;
    if (i === 0 && s.length <= 2 && stanzas.length > 2) return "Intro";
    if (i === stanzas.length - 1 && i > lastChorus && stanzas.length > 3 && (lastChorus >= 0 || s.length <= 2)) return "Outro";
    if (!bridged && chorusesBefore >= 2 && i < lastChorus) {
      bridged = true;
      return "Bridge";
    }
    verse += 1;
    return `Verse ${verse}`;
  });
};

/**
 * Builds labeled chunks from LRCLIB lyrics. Plain lyrics give the stanza breaks; synced
 * lyrics give each line's timestamp, matched in order by text.
 */
export const buildChunks = (plain: string | null, synced: string | null): LyricChunk[] => {
  const rows = synced ? parseLrc(synced).filter((r) => r.text) : [];
  let stanzas: { text: string; time: number | null }[][];

  if (plain?.trim()) {
    let cursor = 0;
    stanzas = stanzasFromPlain(plain).map((block) =>
      block.map((text) => {
        const want = normalizeLine(text);
        const ahead = rows.slice(cursor, cursor + 8).findIndex((r) => normalizeLine(r.text) === want);
        // Fall back to the next row in order when the texts differ slightly.
        const index = ahead >= 0 ? cursor + ahead : cursor < rows.length ? cursor : -1;
        if (index < 0) return { text, time: null };
        cursor = index + 1;
        return { text, time: rows[index].time };
      })
    );
  } else {
    stanzas = stanzasFromSynced(synced ? parseLrc(synced) : []);
  }
  // Merge runs of one- or two-line stanzas (a hook repeated with blank lines between) into one chunk.
  stanzas = stanzas.flatMap((s) => splitLongStanza(s)).reduce<typeof stanzas>((merged, s) => {
    const last = merged.at(-1);
    if (last && s.length <= 2 && last.length + s.length <= 8 && merged.length && (last.length <= 2 || last.at(-1)?.text === s[0].text)) {
      last.push(...s);
    } else merged.push([...s]);
    return merged;
  }, []);

  const labels = labelStanzas(stanzas.map((s) => s.map((l) => l.text)));
  return stanzas.map((s, i) => ({
    id: newId(),
    label: labels[i],
    lines: s.map((l): LyricLine => ({ id: newId(), original: l.text, parody: "", time: l.time })),
  }));
};

/** When the chunk starts in the track: its first timed line plus the global offset. */
export const chunkStart = (chunk: LyricChunk, offset: number) => {
  const first = chunk.lines.find((l) => l.time !== null);
  return first && first.time !== null ? Math.max(0, first.time + offset) : null;
};

export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
