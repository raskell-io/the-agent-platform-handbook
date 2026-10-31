import type { Message, MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { Registry } from "./registry";
import { defaultModel, type Model } from "./model";
import { newLedger, BudgetExceeded } from "./meter";
import { Tracer, traced, tracedDispatch, render, type Span } from "./span";
import { shell } from "./tools/shell";
import { fs_read } from "./tools/fs";
import { http_get } from "./tools/http";
import { git } from "./tools/git";
import { makeContextSearch } from "./tools/context_search";
import { makeMemorySearch } from "./tools/memory_search";
import { memory_write } from "./tools/memory_write";
import { loadContext, type LoadedContext } from "./context";
import { buildIndex, manifest, type Index } from "./retriever";
import { loadMemory, buildMemoryIndex, type LoadedMemory } from "./memory";
import { Journal, once, listRuns } from "./journal";
import type { ToolResult } from "./types";

function buildRegistry(contextIndex: Index, memoryIndex: Index): Registry {
  return new Registry()
    .register(shell)
    .register(fs_read)
    .register(http_get)
    .register(git)
    .register(makeContextSearch(contextIndex))
    .register(makeMemorySearch(memoryIndex))
    .register(memory_write);
}

const CORE_PROMPT = `You are a careful command-line assistant.
You have access to a small toolbox: a sandboxed shell, a file reader,
an HTTP GET, a read-only git wrapper, a project context search, and a
durable memory you can search and write to. Use them to investigate the
user's request and answer concretely. Multiple tools may run in one
turn. When you have the answer, stop calling tools and reply in plain
text.`;

function systemPrompt(ctx: LoadedContext, contextIndex: Index, mem: LoadedMemory): string {
  const parts = [CORE_PROMPT];

  if (ctx.sources.length > 0) {
    parts.push(
      "Project context pinned from .AGENTS/. Treat the contents below as " +
      "authoritative for this project's conventions and terminology. Each " +
      "block is wrapped in <context path=\"...\"> tags so you can cite it " +
      "back to the user.\n\n" +
      ctx.rendered,
    );
  }

  const m = manifest(contextIndex);
  if (m) {
    parts.push(
      "More project context is available on demand. Call context_search " +
      "with a natural-language query to pull the relevant sections instead " +
      "of guessing. Searchable sources and their sections:\n\n" + m,
    );
  }

  if (mem.rendered) {
    parts.push(
      "You keep a durable memory across sessions. The entries below are " +
      "notes you saved on earlier runs, one line each. They are your own " +
      "past observations, not project ground truth: treat them as fallible, " +
      "prefer the pinned .AGENTS/ context when they conflict, and verify " +
      "against the live system before acting. Call memory_search to pull the " +
      "full text of a relevant entry. Call memory_write to save a new durable " +
      "fact when you learn one that is stable and reusable.\n\n" +
      mem.rendered,
    );
  } else {
    parts.push(
      "You keep a durable memory across sessions. It is currently empty. " +
      "Call memory_write to save a stable, reusable fact when you learn one. " +
      "Do not save things that only matter for the current task.",
    );
  }

  return parts.join("\n\n");
}

async function step(
  model: Model,
  registry: Registry,
  messages: MessageParam[],
  system: string,
  hard: boolean,
) {
  return model.complete({
    system,
    messages,
    tools: registry.schemas(),
    maxTokens: 4096,
    hard,
  });
}

// What a run hands back instead of printing: the answer, why it stopped, what
// it cost, and the trace. The CLI prints it; the evaluator in eval.ts grades it.
export type RunResult = {
  runId: string;
  answer: string | null;
  // "waiting": a tool call needs a person's approval; the run stopped and
  // resumes from its journal once someone has decided (post-11).
  stopped: "answer" | "budget" | "limit" | "waiting";
  cost: number;
  // Every tool call with its arguments. The trace deliberately leaves
  // arguments out (post-09); an evaluator checking *how* the agent worked
  // needs them, so they come from the transcript instead.
  calls: { name: string; input: Record<string, unknown> }[];
  trace: Span;
};

export type RunOptions = {
  maxIterations?: number;
  // What a tool call that needs approval does: stop and wait for a person (the
  // CLI), or be refused (the evaluator, which must not change what it measures).
  approvals?: "wait" | "deny";
};

// A run is a journal plus the loop that fills it. run() starts a new one;
// resume() replays an existing one up to where it stopped and carries on.
export async function run(goal: string, opts: RunOptions = {}): Promise<RunResult> {
  return execute(Journal.create(goal), opts);
}

export async function resume(id: string, opts: RunOptions = {}): Promise<RunResult> {
  return execute(Journal.open(id), opts);
}

// One span for the whole run, closed however the run ends: which turn
// escalated, which tool failed, where the time and money went.
async function execute(journal: Journal, opts: RunOptions): Promise<RunResult> {
  const tracer = new Tracer();
  const session = tracer.enter("agent.session", "run", { "run.id": journal.id });
  try {
    const result = await loop(journal, opts.maxIterations ?? 10, opts.approvals ?? "wait", tracer);
    return { ...result, runId: journal.id, trace: session };
  } finally {
    tracer.exit(session);
  }
}

type LoopResult = Omit<RunResult, "trace" | "runId">;

async function loop(
  journal: Journal,
  maxIterations: number,
  approvals: "wait" | "deny",
  tracer: Tracer,
): Promise<LoopResult> {
  const goal = journal.goal;
  const ctx = await loadContext();
  const contextIndex = await buildIndex();
  const mem = await loadMemory();
  const memoryIndex = await buildMemoryIndex();
  const registry = buildRegistry(contextIndex, memoryIndex);
  const ledger = newLedger();
  // traced sits outermost so its spans see the turn after budget and fallback
  const model = traced(defaultModel(ledger, 0.5), tracer); // fifty-cent ceiling for the run
  const system = systemPrompt(ctx, contextIndex, mem);
  for (const s of ctx.sources) {
    console.error(`# pinned ${s.path} (${s.bytes}B${s.truncated ? ", truncated" : ""})`);
  }
  if (contextIndex.chunks.length > 0) {
    const paths = new Set(contextIndex.chunks.map((c) => c.path));
    console.error(`# searchable ${contextIndex.chunks.length} sections across ${paths.size} files`);
  }
  if (mem.memories.length > 0) {
    console.error(`# memory ${mem.memories.length} entries`);
  }
  console.error(
    `# run ${journal.id}` +
      (journal.entries.length > 1 ? `, resuming from ${journal.entries.length} journal entries` : ""),
  );
  // The end is recorded once: replaying a finished run reads it, not rewrites it.
  const finish = (r: LoopResult): LoopResult => {
    if (journal.status() !== "done") journal.append({ kind: "end", stopped: r.stopped, at: new Date().toISOString() });
    return r;
  };
  const messages: MessageParam[] = [{ role: "user", content: goal }];
  const calls: RunResult["calls"] = [];
  let hard = false; // first turn is optimistic: take the cheap model, escalate on trouble

  for (let i = 0; i < maxIterations; i++) {
    const turn = tracer.enter(`turn ${i + 1}`, "turn", { hard });
    try {
      let response: Message;
      let turnCost: number;
      let replayed: boolean;
      try {
        // A model call happens at most once per turn of a run. On a resume the
        // response comes back from the journal: no tokens, no cost, and the
        // same answer the run acted on the first time.
        const r = await once(journal, "model", `turn ${i + 1}`, async () => {
          const before = ledger.cost;
          const value = await step(model, registry, messages, system, hard);
          return { value, cost: ledger.cost - before };
        });
        response = r.value as Message;
        turnCost = r.cost;
        replayed = r.replayed;
        // The budget counts what the run spent before it was interrupted.
        if (replayed) ledger.cost += r.cost;
      } catch (err) {
        if (err instanceof BudgetExceeded) {
          console.error(`# ${err.message} -- stopping with a partial answer`);
          return finish({ answer: null, stopped: "budget", cost: ledger.cost, calls });
        }
        throw err;
      }
      turn.attributes.replayed = replayed;
      console.error(
        `# turn ${i + 1} ${hard ? "hard" : "easy"} -> ${response.model} ` +
          `$${turnCost.toFixed(4)} (run $${ledger.cost.toFixed(4)})${replayed ? " replayed" : ""}`,
      );
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n");
        return finish({ answer: text, stopped: "answer", cost: ledger.cost, calls });
      }

      if (response.stop_reason !== "tool_use") {
        throw new Error(`unexpected stop reason: ${response.stop_reason}`);
      }

      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      // Calls that need a person go through the journal too: the run records
      // what it is waiting for and stops. Nothing of this turn runs until every
      // one of them is decided, so a resume picks the turn up whole.
      const pending = toolUses.filter(
        (b) => registry.needsApproval(b.name) && !journal.find("tool", b.id) && !journal.find("decision", b.id),
      );
      if (pending.length > 0 && approvals === "wait") {
        for (const b of pending) {
          if (!journal.find("wait", b.id)) {
            journal.append({
              kind: "wait", key: b.id, name: b.name,
              input: b.input as Record<string, unknown>, at: new Date().toISOString(),
            });
          }
          console.error(`# approval needed: ${b.name} ${JSON.stringify(b.input)}`);
        }
        return { answer: null, stopped: "waiting", cost: ledger.cost, calls };
      }

      const results = await Promise.all(
        toolUses.map(async (block) => {
          const input = block.input as Record<string, unknown>;
          calls.push({ name: block.name, input });
          // A tool call happens at most once per run too, keyed by its
          // tool_use id. A crash between the call and the journal write is the
          // one gap: that call runs again on resume, so tools with side effects
          // have to be safe to repeat (memory_write overwrites by name).
          const r = await once(journal, "tool", block.id, async () => {
            let value: ToolResult;
            if (registry.needsApproval(block.name)) {
              const d = journal.find("decision", block.id);
              value = d?.approved
                ? await tracedDispatch(registry, tracer, block.name, input)
                : { ok: false, error: d ? "the operator declined this call" : "this run does not allow calls that need approval" };
            } else {
              value = await tracedDispatch(registry, tracer, block.name, input);
            }
            return { value, name: block.name };
          });
          const result = r.value;
          // Replayed calls still belong in the trace, marked as such.
          if (r.replayed) tracer.end(tracer.start(`tool.${block.name}`, "tool", { "tool.name": block.name, replayed: true }));
          console.error(`> ${block.name} ${JSON.stringify(block.input)} -> ${result.ok ? "ok" : "err"}${r.replayed ? " (replayed)" : ""}`);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: result.ok ? result.value : result.error,
            is_error: !result.ok,
          };
        }),
      );

      hard = results.some((r) => r.is_error); // a tool error means the next turn is recovery: send in the strong model
      messages.push({ role: "user", content: results });

      // For trying it out: kill the process the hard way after a given turn,
      // the way an OOM kill or a lost node would, then `bun agent.ts resume`.
      if (!replayed && process.env.CRASH_AFTER_TURN === String(i + 1)) {
        console.error(`# simulated crash after turn ${i + 1}`);
        process.kill(process.pid, "SIGKILL");
      }
    } finally {
      tracer.exit(turn);
    }
  }

  console.error(`iteration limit (${maxIterations}) reached`);
  return finish({ answer: null, stopped: "limit", cost: ledger.cost, calls });
}

// Only when run as `bun agent.ts`, so that eval.ts can import run() without
// starting an agent.
//   bun agent.ts '<goal>'            start a run
//   bun agent.ts resume <run-id>     replay a run's journal and carry on
//   bun agent.ts approve <run-id>    approve what a waiting run asked for (or: deny)
//   bun agent.ts runs                list runs and their status
if (import.meta.main) {
  const [cmd, id] = process.argv.slice(2);
  if (cmd === "runs") {
    for (const r of listRuns()) console.log(`${r.id}  ${r.status.padEnd(11)}  ${r.goal}`);
    process.exit(0);
  }
  if ((cmd === "approve" || cmd === "deny") && id) {
    const journal = Journal.open(id);
    const open = journal.entries.filter(
      (e): e is Extract<typeof e, { kind: "wait" }> => e.kind === "wait" && !journal.find("decision", e.key),
    );
    for (const w of open) {
      journal.append({ kind: "decision", key: w.key, approved: cmd === "approve", at: new Date().toISOString() });
      console.log(`${cmd === "approve" ? "approved" : "denied"}: ${w.name} ${JSON.stringify(w.input)}`);
    }
    if (open.length === 0) console.log(`run ${id} is not waiting for anything`);
    else console.log(`now: bun agent.ts resume ${id}`);
    process.exit(0);
  }
  const goal = process.argv.slice(2).join(" ");
  if (!goal) {
    console.error("usage: bun agent.ts '<goal>' | resume <run-id> | approve <run-id> | deny <run-id> | runs");
    process.exit(1);
  }
  const result = cmd === "resume" && id ? await resume(id) : await run(goal);
  if (result.answer) console.log(result.answer);
  console.error(render(result.trace));
  if (result.stopped === "waiting") {
    console.error(`# run ${result.runId} is waiting: bun agent.ts approve ${result.runId} (or deny), then resume`);
  }
}
