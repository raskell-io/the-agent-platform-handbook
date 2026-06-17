import type { Tool } from "../types";
import { search, type Index } from "../retriever";

export function makeContextSearch(index: Index): Tool {
  return {
    name: "context_search",
    description:
      "Search the project's on-demand .AGENTS/ context for sections relevant " +
      "to a query. Returns the best-matching documentation sections, each " +
      "wrapped in a <context> block with its source path and heading. Use " +
      "this when you need project conventions, glossary terms, or architecture " +
      "notes that are not already in your system prompt. The system prompt " +
      "lists which sources are searchable.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language description of what you need to know.",
        },
        k: {
          type: "number",
          description: "Maximum number of sections to return. Defaults to 3.",
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
        return { ok: true, value: `no matching context for: ${q}` };
      }

      const rendered = hits
        .map(
          (h) =>
            `<context path="${h.chunk.path}" section="${h.chunk.heading}" score="${h.score.toFixed(2)}">\n` +
            `${h.chunk.text.trim()}\n</context>`,
        )
        .join("\n\n");

      return { ok: true, value: rendered };
    },
  };
}
