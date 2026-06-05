import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { shell, type Tool } from "./tools";

const client = new Anthropic();
const tools: Tool[] = [shell];

const SYSTEM_PROMPT = `You are a careful command-line assistant.
You have access to a shell tool. Use it to investigate the user's
request and answer concretely. When you have the answer, stop calling
tools and reply in plain text.`;

async function step(messages: MessageParam[]) {
  return client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: tools.map(({ run, ...t }) => t),
    messages,
  });
}

export async function run(goal: string, maxIterations = 10) {
  const messages: MessageParam[] = [{ role: "user", content: goal }];

  for (let i = 0; i < maxIterations; i++) {
    const response = await step(messages);
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

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const tool = tools.find((t) => t.name === block.name);
      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }
      console.error(`> ${block.name} ${JSON.stringify(block.input)}`);
      try {
        const result = await tool.run(block.input as Record<string, unknown>);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(err),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.error(`iteration limit (${maxIterations}) reached`);
}

const goal = process.argv.slice(2).join(" ");
if (!goal) {
  console.error("usage: bun agent.ts '<goal>'");
  process.exit(1);
}
await run(goal);
