import type { Tool } from "../types";
import { writeMemory } from "../memory";

export const memory_write: Tool = {
  name: "memory_write",
  description:
    "Save a durable memory for your future self in a later session. Use it " +
    "for a stable, reusable fact the project context does not already record: " +
    "a user preference, a decision and its reason, a hard-won detail you would " +
    "have to rediscover. One fact per call. name is a short slug; reusing an " +
    "existing name overwrites that memory, which is how you correct yourself. " +
    "description is the one line that goes in your memory index and is used to " +
    "judge relevance on recall. body is the fact, written for a reader who " +
    "lacks this conversation's context. Do not save things that only matter " +
    "for the current task, or that .AGENTS/ already states.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short slug. Reusing an existing one overwrites that memory.",
      },
      description: {
        type: "string",
        description: "One-line summary, used to judge relevance when recalling.",
      },
      type: {
        type: "string",
        description: "One of fact, preference, decision. Defaults to fact.",
      },
      body: {
        type: "string",
        description: "The fact itself, written to stand on its own in a future session.",
      },
    },
    required: ["name", "description", "body"],
  },
  run: async ({ name, description, type, body }) => {
    const n = String(name ?? "").trim();
    const d = String(description ?? "").trim();
    const b = String(body ?? "").trim();
    if (!n || !d || !b) {
      return { ok: false, error: "name, description, and body are all required" };
    }
    try {
      const res = await writeMemory({
        name: n,
        description: d,
        type: type === undefined ? undefined : String(type),
        body: b,
      });
      return { ok: true, value: `${res.updated ? "updated" : "saved"} memory: ${res.name}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
