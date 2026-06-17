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

// Pinned files load into every turn. They carry cross-cutting rules that
// have to be true regardless of the task. Everything else in .AGENTS/ is
// searchable on demand through the context_search tool (see retriever.ts).
export const PINNED = ["overview.md", "conventions.md"];

export function resolveDir(dir?: string): string {
  return dir ?? process.env.AGENTS_DIR ?? DEFAULT_DIR;
}

export function isPinned(name: string): boolean {
  return PINNED.includes(name);
}

export async function isContextDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function loadContext(opts: ContextOptions = {}): Promise<LoadedContext> {
  const dir = resolveDir(opts.dir);
  const budget = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!(await isContextDir(dir))) {
    return { sources: [], rendered: "", totalBytes: 0, budgetBytes: budget };
  }

  const present = new Set(await readdir(dir));
  const ordered = PINNED.filter((n) => present.has(n));

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
