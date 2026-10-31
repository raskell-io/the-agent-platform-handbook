import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from "node:fs";
import { join } from "node:path";

// A run's journal: one JSON line per thing that happened, appended and flushed
// to disk before the run moves on. Replaying it rebuilds the run without
// repeating the work: every model response and tool result already in it is
// read back instead of being asked for again.
export type Entry =
  | { kind: "start"; goal: string; at: string }
  | { kind: "model"; key: string; value: unknown; cost: number }
  | { kind: "tool"; key: string; name: string; value: unknown }
  | { kind: "wait"; key: string; name: string; input: Record<string, unknown>; at: string }
  | { kind: "decision"; key: string; approved: boolean; at: string }
  | { kind: "end"; stopped: string; at: string };

export type Status = "done" | "waiting" | "interrupted";

export const runsDir = () => process.env.RUNS_DIR ?? "runs";

export class Journal {
  private constructor(
    readonly id: string,
    readonly file: string,
    readonly entries: Entry[],
  ) {}

  static create(goal: string): Journal {
    mkdirSync(runsDir(), { recursive: true });
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const j = new Journal(id, join(runsDir(), `${id}.jsonl`), []);
    j.append({ kind: "start", goal, at: new Date().toISOString() });
    return j;
  }

  static open(id: string): Journal {
    const file = join(runsDir(), `${id}.jsonl`);
    if (!existsSync(file)) throw new Error(`no run ${id} in ${runsDir()}/`);
    // A crash can cut the last line in half. Everything before it was flushed
    // whole, so a torn tail is dropped and that step simply runs again.
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const entries: Entry[] = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { break; }
    }
    return new Journal(id, file, entries);
  }

  get goal(): string {
    const start = this.entries[0];
    if (start?.kind !== "start") throw new Error(`run ${this.id} has no start entry`);
    return start.goal;
  }

  // Written and fsynced before the caller continues: once append returns, the
  // entry survives a kill -9, a reboot, or a lost container.
  append(entry: Entry): void {
    const fd = openSync(this.file, "a");
    try {
      writeSync(fd, JSON.stringify(entry) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.entries.push(entry);
  }

  find<K extends Entry["kind"]>(kind: K, key: string): Extract<Entry, { kind: K }> | undefined {
    return this.entries.find((e) => e.kind === kind && "key" in e && e.key === key) as
      | Extract<Entry, { kind: K }>
      | undefined;
  }

  status(): Status {
    if (this.entries.some((e) => e.kind === "end")) return "done";
    const waits = this.entries.filter((e) => e.kind === "wait");
    if (waits.some((w) => !this.find("decision", w.key))) return "waiting";
    return "interrupted";
  }
}

// The one primitive durable execution needs: do a step at most once per run.
// If the journal already holds its result, return that; otherwise do it live
// and record the result before anyone can act on it. The key has to be
// deterministic across a replay: the turn number for a model call, the
// tool_use id (which comes from a replayed model response) for a tool call.
export async function once<T>(
  journal: Journal,
  kind: "model",
  key: string,
  live: () => Promise<{ value: T; cost: number }>,
): Promise<{ value: T; cost: number; replayed: boolean }>;
export async function once<T>(
  journal: Journal,
  kind: "tool",
  key: string,
  live: () => Promise<{ value: T; name: string }>,
): Promise<{ value: T; replayed: boolean }>;
export async function once<T>(
  journal: Journal,
  kind: "model" | "tool",
  key: string,
  live: () => Promise<{ value: T; cost?: number; name?: string }>,
) {
  const recorded = journal.find(kind, key);
  if (recorded) {
    return { value: recorded.value as T, cost: "cost" in recorded ? recorded.cost : 0, replayed: true };
  }
  const result = await live();
  if (kind === "model") {
    journal.append({ kind, key, value: result.value, cost: result.cost ?? 0 });
  } else {
    journal.append({ kind, key, name: result.name ?? "", value: result.value });
  }
  return { ...result, replayed: false };
}

export function listRuns(): { id: string; status: Status; goal: string }[] {
  if (!existsSync(runsDir())) return [];
  return readdirSync(runsDir())
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => {
      const j = Journal.open(f.slice(0, -".jsonl".length));
      return { id: j.id, status: j.status(), goal: j.goal };
    });
}
