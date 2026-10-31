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

  needsApproval(name: string): boolean {
    return this.tools.get(name)?.approval === true;
  }

  async dispatch(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };
    try {
      const result = await withTimeout(tool.run(input), tool.timeout_ms ?? 30_000);
      return cap(result, tool.max_output_bytes ?? 8192);
    } catch (err) {
      return { ok: false, error: `tool threw: ${String(err)}` };
    }
  }
}

// A tool that hangs must not hang the run. After the deadline the call counts
// as failed, and the model sees an error it can work around, like any other.
// The call itself is not cancelled: a tool that can be stopped should take an
// AbortSignal, and one with side effects should be safe to run twice.
async function withTimeout(work: Promise<ToolResult>, ms: number): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ToolResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: `timed out after ${ms} ms` }), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function cap(result: ToolResult, max: number): ToolResult {
  if (!result.ok) return result;
  const bytes = Buffer.byteLength(result.value, "utf8");
  if (bytes <= max) return result;
  const head = result.value.slice(0, max);
  return { ok: true, value: `${head}\n\n[truncated: ${bytes - max} more bytes]` };
}
