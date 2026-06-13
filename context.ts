import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type ContextSource = {
  path: string;
  bytes: number;
  content: string;
  truncated: boolean;
};

export type LoadedContext = {
  sources: ContextSource[];
  rendered: string;
  totalBytes: number;
  budgetBytes: number;
};

export type ContextOptions = {
  dir?: string;
  maxBytes?: number;
};

const DEFAULT_DIR = ".AGENTS";
const DEFAULT_MAX_BYTES = 32 * 1024;
const PRIORITY = ["overview.md", "conventions.md", "glossary.md"];

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function orderEntries(entries: string[]): string[] {
  const present = new Set(entries);
  const head = PRIORITY.filter((n) => present.has(n));
  const tail = entries
    .filter((n) => !PRIORITY.includes(n))
    .filter((n) => n.endsWith(".md"))
    .sort();
  return [...head, ...tail];
}

export async function loadContext(opts: ContextOptions = {}): Promise<LoadedContext> {
  const dir = opts.dir ?? process.env.AGENTS_DIR ?? DEFAULT_DIR;
  const budget = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!(await isDir(dir))) {
    return { sources: [], rendered: "", totalBytes: 0, budgetBytes: budget };
  }

  const entries = await readdir(dir);
  const ordered = orderEntries(entries);

  const sources: ContextSource[] = [];
  let used = 0;

  for (const name of ordered) {
    const path = join(dir, name);
    const raw = await readFile(path, "utf8");
    const bytes = Buffer.byteLength(raw, "utf8");
    const remaining = budget - used;

    if (bytes <= remaining) {
      sources.push({ path, bytes, content: raw, truncated: false });
      used += bytes;
      continue;
    }

    if (remaining < 256) break;

    const head = raw.slice(0, remaining);
    const note = `\n\n[truncated: ${bytes - remaining} more bytes]`;
    sources.push({
      path,
      bytes: remaining,
      content: head + note,
      truncated: true,
    });
    used += remaining;
    break;
  }

  const rendered = sources
    .map((s) => `<context path="${s.path}">\n${s.content.trimEnd()}\n</context>`)
    .join("\n\n");

  return { sources, rendered, totalBytes: used, budgetBytes: budget };
}
