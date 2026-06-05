import type { Tool } from "../types";

export const http_get: Tool = {
  name: "http_get",
  description:
    "Perform an HTTP GET request and return the response body as text. " +
    "Times out after 10 seconds. Returns the status code in the result. " +
    "Use this to fetch public documentation, API responses, or web pages. " +
    "Do not use it to interact with internal services.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute https:// URL." },
    },
    required: ["url"],
  },
  max_output_bytes: 64 * 1024,
  run: async ({ url }) => {
    const u = String(url);
    if (!u.startsWith("https://")) return { ok: false, error: "only https:// is allowed" };
    try {
      const ctl = AbortSignal.timeout(10_000);
      const res = await fetch(u, { signal: ctl });
      const body = await res.text();
      return { ok: true, value: `status: ${res.status}\n\n${body}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
