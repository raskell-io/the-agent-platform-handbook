import type { Model } from "./model";
import type { Registry } from "./registry";
import type { ToolResult } from "./types";
import { costOf } from "./price";

export type SpanKind = "run" | "turn" | "model" | "tool";

// A named interval with attributes and children. That is the whole data
// structure of a trace.
export type Span = {
  name: string;
  kind: SpanKind;
  startedAt: number;
  endedAt?: number;
  attributes: Record<string, string | number | boolean>;
  children: Span[];
  error?: string;
};

// Monotonic, not wall time: a clock adjustment mid-run cannot make a span end
// before it started.
const now = () => performance.now();

export class Tracer {
  root?: Span;
  private open: Span[] = [];

  // Runs and turns happen one after another, so a stack is enough to know
  // which one is current. enter/exit push and pop it.
  enter(name: string, kind: SpanKind, attributes: Span["attributes"] = {}): Span {
    const span = this.start(name, kind, attributes);
    this.open.push(span);
    return span;
  }

  exit(span: Span, error?: string) {
    this.end(span, error);
    this.open.pop();
  }

  // Model and tool spans are leaves under the current run or turn. They never
  // go on the stack: the tool calls of one turn run in parallel, and a stack
  // would nest the second call inside the first.
  start(name: string, kind: SpanKind, attributes: Span["attributes"] = {}): Span {
    const span: Span = { name, kind, startedAt: now(), attributes, children: [] };
    const parent = this.open[this.open.length - 1];
    if (parent) parent.children.push(span);
    else this.root = span;
    return span;
  }

  end(span: Span, error?: string) {
    span.endedAt = now();
    if (error) span.error = error;
  }
}

// One more decorator on Model, the same shape as metered and withBudget. It
// sits outermost, so the span records what actually happened: the turn the
// loop asked for (request.hard) and the model that answered (response.model).
export function traced(inner: Model, tracer: Tracer): Model {
  return {
    name: `traced(${inner.name})`,
    async complete(req) {
      const span = tracer.start("model.complete", "model", { "request.hard": req.hard });
      let error: string | undefined;
      try {
        const res = await inner.complete(req);
        span.attributes["response.model"] = res.model;
        span.attributes["usage.input_tokens"] = res.usage.input_tokens;
        span.attributes["usage.output_tokens"] = res.usage.output_tokens;
        span.attributes["usage.cache_read_tokens"] = res.usage.cache_read_input_tokens ?? 0;
        span.attributes["usage.cache_write_tokens"] = res.usage.cache_creation_input_tokens ?? 0;
        span.attributes["cost.usd"] = costOf(res.model, res.usage);
        return res;
      } catch (err) {
        error = String(err);
        throw err;
      } finally {
        tracer.end(span, error);
      }
    },
  };
}

// The tool side, at the one place tools are dispatched. The registry returns
// failures as data (post-03), so a failed tool is an ordinary result here,
// recorded as an error on its span.
export async function tracedDispatch(
  registry: Registry,
  tracer: Tracer,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const span = tracer.start(`tool.${name}`, "tool", { "tool.name": name });
  const result = await registry.dispatch(name, input);
  if (result.ok) span.attributes["result.bytes"] = Buffer.byteLength(result.value, "utf8");
  tracer.end(span, result.ok ? undefined : result.error);
  return result;
}

// Render a span tree for the terminal: one line per span, with duration and,
// where there is one, cost. A turn's cost is the sum of its model calls.
export function render(root: Span): string {
  const lines: string[] = [];
  const walk = (span: Span, prefix: string, branch: string) => {
    lines.push(format(span, prefix + branch));
    const next = prefix + (branch === "├─ " ? "│  " : branch === "└─ " ? "   " : "");
    span.children.forEach((child, i) =>
      walk(child, next, i === span.children.length - 1 ? "└─ " : "├─ "),
    );
  };
  walk(root, "", "");
  return lines.join("\n");
}

function format(span: Span, head: string): string {
  const a = span.attributes;
  let label = span.name;
  if (span.kind === "turn") label += a.hard ? "  hard" : "  easy";
  if (span.kind === "model" && a["response.model"]) {
    const tokens =
      Number(a["usage.input_tokens"]) +
      Number(a["usage.output_tokens"]) +
      Number(a["usage.cache_read_tokens"]) +
      Number(a["usage.cache_write_tokens"]);
    label += `  ${a["response.model"]}  ${(tokens / 1000).toFixed(1)}k tok`;
  }
  if (span.kind === "tool") label += span.error ? "  ERROR" : "  ok";
  if (span.kind === "model" && span.error) label += "  ERROR";
  const seconds = (((span.endedAt ?? span.startedAt) - span.startedAt) / 1000).toFixed(2) + "s";
  const cost = costOfSpan(span);
  return `${(head + label).padEnd(58)}${seconds.padStart(7)}${cost > 0 ? `   $${cost.toFixed(3)}` : ""}`;
}

function costOfSpan(span: Span): number {
  const own = Number(span.attributes["cost.usd"] ?? 0);
  return own + span.children.reduce((sum, c) => sum + costOfSpan(c), 0);
}
