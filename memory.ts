import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Index, makeChunk, indexChunks } from "./retriever";

// A memory is one fact the agent chose to remember, written for a reader who
// will not have this conversation's context: its future self, in a later
// session. The shape is deliberately small. name is the slug and the filename
// stem, so writing the same name twice corrects a memory instead of forking
// it. description is the one line that lands in the always-pinned index.
export type MemoryType = "fact" | "preference" | "decision";

export type Memory = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
};

export type LoadedMemory = {
  memories: Memory[];
  rendered: string;
};

const TYPES: MemoryType[] = ["fact", "preference", "decision"];
const DEFAULT_DIR = "memory";
const INDEX_FILE = "MEMORY.md";
const MAX_BODY_BYTES = 4 * 1024;

// The agent writes here and only here. .AGENTS/ is project ground truth and is
// read-only to the agent; memory/ is the agent's own write surface. Keeping
// them in separate directories is the first line of defense against an agent
// corrupting the context it was given.
export function resolveMemoryDir(dir?: string): string {
  return dir ?? process.env.MEMORY_DIR ?? DEFAULT_DIR;
}

// A name from the model becomes a filesystem-safe slug. This both sanitizes
// the path (no traversal, no surprises) and makes the slug the dedup key:
// "User prefers Bun" and "user-prefers-bun" land on the same file.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function coerceType(value: unknown): MemoryType {
  return TYPES.includes(value as MemoryType) ? (value as MemoryType) : "fact";
}

function render(m: Memory): string {
  return [
    "---",
    `name: ${m.name}`,
    `description: ${m.description}`,
    `type: ${m.type}`,
    "---",
    "",
    m.body.trim(),
    "",
  ].join("\n");
}

// Parse a memory file back into a record. A file that has no frontmatter, or no
// name and description, is not a memory this layer wrote, so it is skipped
// rather than guessed at.
function parse(raw: string): Memory | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;

  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.name || !meta.description) return null;

  return {
    name: meta.name,
    description: meta.description,
    type: coerceType(meta.type),
    body: m[2].trim(),
  };
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Read every memory in the directory, skipping the derived index file. Sorted
// by name so the pinned block and the search corpus are stable across runs.
export async function listMemories(dir = resolveMemoryDir()): Promise<Memory[]> {
  if (!(await isDir(dir))) return [];

  const names = (await readdir(dir))
    .filter((n) => n.endsWith(".md") && n !== INDEX_FILE)
    .sort();

  const memories: Memory[] = [];
  for (const name of names) {
    const parsed = parse(await readFile(join(dir, name), "utf8"));
    if (parsed) memories.push(parsed);
  }
  return memories;
}

// MEMORY.md is derived from the files, never authored directly. Regenerating it
// on every write means the index cannot drift out of sync with the facts it
// points at. The agent owns the facts; the layer owns the index.
async function rebuildIndexFile(dir: string): Promise<void> {
  const memories = await listMemories(dir);
  const lines = memories.map(
    (m) => `- [${m.name}](${m.name}.md) (${m.type}) -- ${m.description}`,
  );
  const body = [
    "# Memory index",
    "",
    "Notes this agent chose to remember, one file per fact. These are the",
    "agent's own past observations, not project ground truth. Treat them as",
    "fallible and verify against .AGENTS/ and the live system before acting.",
    "",
    ...(lines.length > 0 ? lines : ["(empty)"]),
    "",
  ].join("\n");
  await writeFile(join(dir, INDEX_FILE), body, "utf8");
}

// The write path. Validate the shape, clamp the size, slug the name, write the
// file, regenerate the index. Reusing a name overwrites in place: that is how
// the agent corrects a memory that turned out to be wrong, instead of leaving
// the stale one to be recalled forever.
export async function writeMemory(
  input: { name: string; description: string; type?: string; body: string },
  dir = resolveMemoryDir(),
): Promise<{ name: string; updated: boolean }> {
  const name = slugify(input.name);
  if (!name) throw new Error("memory name is empty after slugifying");

  const description = input.description.trim();
  if (!description) throw new Error("memory description is required");

  const body = input.body.trim();
  if (!body) throw new Error("memory body is required");
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error(`memory body exceeds ${MAX_BODY_BYTES} bytes`);
  }

  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name}.md`);
  const updated = await exists(file);
  await writeFile(file, render({ name, description, type: coerceType(input.type), body }), "utf8");
  await rebuildIndexFile(dir);
  return { name, updated };
}

// Load the pinned block: one line per memory, the same one-line summaries that
// live in MEMORY.md. This is what every turn pays for. The bodies stay on disk
// and are pulled on demand through memory_search.
export async function loadMemory(dir = resolveMemoryDir()): Promise<LoadedMemory> {
  const memories = await listMemories(dir);
  if (memories.length === 0) return { memories: [], rendered: "" };

  const lines = memories.map((m) => `- ${m.name} (${m.type}): ${m.description}`);
  const rendered = `<memory>\n${lines.join("\n")}\n</memory>`;
  return { memories, rendered };
}

// Build the searchable index over memory bodies, reusing the BM25 machinery
// from the retriever. Each memory is one chunk; its description becomes the
// chunk heading, so a hit cites the same one-liner the agent saw in the index.
export async function buildMemoryIndex(dir = resolveMemoryDir()): Promise<Index> {
  const memories = await listMemories(dir);
  const chunks = memories.map((m) =>
    makeChunk(join(dir, `${m.name}.md`), m.description, `${m.description}\n\n${m.body}`),
  );
  return indexChunks(chunks);
}
