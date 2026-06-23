import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveDir, isContextDir, isPinned } from "./context";

export type Chunk = {
  path: string;
  heading: string;
  text: string;
  length: number;
  tf: Map<string, number>;
};

export type Index = {
  chunks: Chunk[];
  df: Map<string, number>;
  avgLength: number;
};

export type Hit = { chunk: Chunk; score: number };

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on",
  "with", "this", "that", "do", "not", "be", "as", "at", "by", "are", "you",
  "your", "if", "use", "when", "from", "into", "than",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Build one chunk: count term frequencies and record length for BM25 length
// normalization. Exported so a second corpus (memory) can assemble its own
// chunks and rank them with the same search() below.
export function makeChunk(path: string, heading: string, text: string): Chunk {
  const tf = new Map<string, number>();
  let length = 0;
  for (const tok of tokenize(text)) {
    tf.set(tok, (tf.get(tok) ?? 0) + 1);
    length++;
  }
  return { path, heading, text, length, tf };
}

// Turn a set of chunks into a searchable index: document frequencies and the
// average chunk length, computed once. Both buildIndex and the memory layer
// finish here.
export function indexChunks(chunks: Chunk[]): Index {
  const df = new Map<string, number>();
  for (const c of chunks) {
    for (const term of c.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const avgLength = chunks.length === 0
    ? 0
    : chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length;
  return { chunks, df, avgLength };
}

function chunkMarkdown(path: string, raw: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = "(intro)";
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body.length === 0) return;
    chunks.push(makeChunk(path, heading, body));
  };

  for (const line of raw.split("\n")) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

export async function buildIndex(opts: { dir?: string } = {}): Promise<Index> {
  const dir = resolveDir(opts.dir);
  if (!(await isContextDir(dir))) {
    return { chunks: [], df: new Map(), avgLength: 0 };
  }

  const names = (await readdir(dir))
    .filter((n) => n.endsWith(".md"))
    .filter((n) => !isPinned(n))
    .sort();

  const chunks: Chunk[] = [];
  for (const name of names) {
    const raw = await readFile(join(dir, name), "utf8");
    chunks.push(...chunkMarkdown(join(dir, name), raw));
  }

  return indexChunks(chunks);
}

const K1 = 1.5;
const B = 0.75;

export function search(index: Index, query: string, k = 3): Hit[] {
  const terms = tokenize(query);
  if (terms.length === 0 || index.chunks.length === 0) return [];

  const N = index.chunks.length;
  const hits: Hit[] = [];

  for (const chunk of index.chunks) {
    let score = 0;
    for (const term of terms) {
      const tf = chunk.tf.get(term);
      if (!tf) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const denom = tf + K1 * (1 - B + B * (chunk.length / (index.avgLength || 1)));
      score += idf * (tf * (K1 + 1)) / denom;
    }
    if (score > 0) hits.push({ chunk, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

export function manifest(index: Index): string {
  if (index.chunks.length === 0) return "";
  const byPath = new Map<string, string[]>();
  for (const c of index.chunks) {
    const heads = byPath.get(c.path) ?? [];
    if (c.heading !== "(intro)") heads.push(c.heading);
    byPath.set(c.path, heads);
  }
  return [...byPath.entries()]
    .map(([path, heads]) => `- ${path}: ${heads.join(", ")}`)
    .join("\n");
}
