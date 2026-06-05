import type { Tool } from "../types";

export const fs_read: Tool = {
  name: "fs_read",
  description:
    "Read a UTF-8 text file from the local filesystem and return its contents. " +
    "Fails if the path does not exist, is not a regular file, is not valid UTF-8, " +
    "or exceeds 1 MB. Use this for source files, configs, and logs.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file." },
    },
    required: ["path"],
  },
  max_output_bytes: 1024 * 1024,
  run: async ({ path }) => {
    try {
      const file = Bun.file(String(path));
      const exists = await file.exists();
      if (!exists) return { ok: false, error: `no such file: ${path}` };
      if (file.size > 1024 * 1024) return { ok: false, error: `file too large: ${file.size} bytes` };
      const text = await file.text();
      return { ok: true, value: text };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
