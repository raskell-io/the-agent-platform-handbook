import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { Registry } from "./registry";
import { shell } from "./tools/shell";
import { fs_read } from "./tools/fs";
import { http_get } from "./tools/http";
import { git } from "./tools/git";
import { makeContextSearch } from "./tools/context_search";
import { loadContext, type LoadedContext } from "./context";
import { buildIndex, manifest, type Index } from "./retriever";

const client = new Anthropic();

function buildRegistry(index: Index): Registry {
  return new Registry()
    .register(shell)
    .register(fs_read)
    .register(http_get)
    .register(git)
    .register(makeContextSearch(index));
}

const CORE_PROMPT = `You are a careful command-line assistant.
You have access to a small toolbox: a sandboxed shell, a file reader,
an HTTP GET, a read-only git wrapper, and a project context search. Use
them to investigate the user's request and answer concretely. Multiple
tools may run in one turn. When you have the answer, stop calling tools
and reply in plain text.`;

function systemPrompt(ctx: LoadedContext, index: Index): string {
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

  const m = manifest(index);
  if (m) {
    parts.push(
      "More project context is available on demand. Call context_search " +
      "with a natural-language query to pull the relevant sections instead " +
      "of guessing. Searchable sources and their sections:\n\n" + m,
    );
  }

  return parts.join("\n\n");
}

async function step(registry: Registry, messages: MessageParam[], system: string) {
  return client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system,
    tools: registry.schemas(),
    messages,
  });
}

export async function run(goal: string, maxIterations = 10) {
  const ctx = await loadContext();
  const index = await buildIndex();
  const registry = buildRegistry(index);
  const system = systemPrompt(ctx, index);
  for (const s of ctx.sources) {
    console.error(`# pinned ${s.path} (${s.bytes}B${s.truncated ? ", truncated" : ""})`);
  }
  if (index.chunks.length > 0) {
    const paths = new Set(index.chunks.map((c) => c.path));
    console.error(`# searchable ${index.chunks.length} sections across ${paths.size} files`);
  }
  const messages: MessageParam[] = [{ role: "user", content: goal }];

  for (let i = 0; i < maxIterations; i++) {
    const response = await step(registry, messages, system);
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");
      console.log(text);
      return;
    }

    if (response.stop_reason !== "tool_use") {
      throw new Error(`unexpected stop reason: ${response.stop_reason}`);
    }

    const calls = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    const results = await Promise.all(
      calls.map(async (block) => {
        const result = await registry.dispatch(block.name, block.input as Record<string, unknown>);
        console.error(`> ${block.name} ${JSON.stringify(block.input)} -> ${result.ok ? "ok" : "err"}`);
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result.ok ? result.value : result.error,
          is_error: !result.ok,
        };
      }),
    );

    messages.push({ role: "user", content: results });
  }

  console.error(`iteration limit (${maxIterations}) reached`);
}

const goal = process.argv.slice(2).join(" ");
if (!goal) {
  console.error("usage: bun agent.ts '<goal>'");
  process.exit(1);
}
await run(goal);
