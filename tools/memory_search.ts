import type { Tool } from "../types";
import { search, type Index } from "../retriever";

export function makeMemorySearch(index: Index): Tool {
  return {
    name: "memory_search",
    description:
      "Search your own durable memories for ones relevant to a query. Returns " +
      "the best-matching entries, each wrapped in a <memory> block with its " +
      "source path and one-line description. Use this when your memory index " +
      "hints that you noted something relevant before and you need the full " +
      "text. These are your own past notes, not project ground truth: treat " +
      "them as fallible, prefer .AGENTS/ when they conflict, and verify against " +
      "the live system before acting on them.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language description of what you are trying to recall.",
        },
        k: {
          type: "number",
          description: "Maximum number of memories to return. Defaults to 3.",
        },
      },
      required: ["query"],
    },
    max_output_bytes: 16 * 1024,
    run: async ({ query, k }) => {
      const q = String(query ?? "").trim();
      if (q.length === 0) return { ok: false, error: "query is required" };

      const limit = typeof k === "number" && k > 0 ? Math.floor(k) : 3;
      const hits = search(index, q, limit);
      if (hits.length === 0) {
        return { ok: true, value: `no matching memory for: ${q}` };
      }

      const rendered = hits
        .map(
          (h) =>
            `<memory path="${h.chunk.path}" note="${h.chunk.heading}" score="${h.score.toFixed(2)}">\n` +
            `${h.chunk.text.trim()}\n</memory>`,
        )
        .join("\n\n");

      return { ok: true, value: rendered };
    },
  };
}
