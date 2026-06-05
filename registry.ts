import type { Tool, ToolResult } from "./types";

export class Registry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  schemas() {
    return Array.from(this.tools.values()).map(({ run, ...t }) => t);
  }

  async dispatch(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };
    try {
      const result = await tool.run(input);
      return cap(result, tool.max_output_bytes ?? 8192);
    } catch (err) {
      return { ok: false, error: `tool threw: ${String(err)}` };
    }
  }
}

function cap(result: ToolResult, max: number): ToolResult {
  if (!result.ok) return result;
  const bytes = Buffer.byteLength(result.value, "utf8");
  if (bytes <= max) return result;
  const head = result.value.slice(0, max);
  return { ok: true, value: `${head}\n\n[truncated: ${bytes - max} more bytes]` };
}
