import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { Registry } from "./registry";
import { shell } from "./tools/shell";
import { fs_read } from "./tools/fs";
import { http_get } from "./tools/http";
import { git } from "./tools/git";
import { loadContext, type LoadedContext } from "./context";

const client = new Anthropic();

const tools = new Registry()
  .register(shell)
  .register(fs_read)
  .register(http_get)
  .register(git);

const CORE_PROMPT = `You are a careful command-line assistant.
You have access to a small toolbox: a sandboxed shell, a file reader,
an HTTP GET, and a read-only git wrapper. Use them to investigate the
user's request and answer concretely. Multiple tools may run in one
turn. When you have the answer, stop calling tools and reply in plain
text.`;

function systemPrompt(ctx: LoadedContext): string {
  if (ctx.sources.length === 0) return CORE_PROMPT;
  return (
    CORE_PROMPT +
    "\n\nProject context loaded from .AGENTS/. Treat the contents below " +
    "as authoritative for this project's conventions and terminology. " +
    "Each block is wrapped in <context path=\"...\"> tags so you can cite " +
    "it back to the user.\n\n" +
    ctx.rendered
  );
}

async function step(messages: MessageParam[], system: string) {
  return client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system,
    tools: tools.schemas(),
    messages,
  });
}

export async function run(goal: string, maxIterations = 10) {
  const ctx = await loadContext();
  const system = systemPrompt(ctx);
  for (const s of ctx.sources) {
    console.error(`# context ${s.path} (${s.bytes}B${s.truncated ? ", truncated" : ""})`);
  }
  const messages: MessageParam[] = [{ role: "user", content: goal }];

  for (let i = 0; i < maxIterations; i++) {
    const response = await step(messages, system);
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
        const result = await tools.dispatch(block.name, block.input as Record<string, unknown>);
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
