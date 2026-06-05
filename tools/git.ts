import type { Tool } from "../types";

const ALLOWED = new Set(["log", "diff", "show", "status", "branch", "ls-files"]);

export const git: Tool = {
  name: "git",
  description:
    "Run a read-only git command in the current repository and return its output. " +
    "Allowed subcommands: log, diff, show, status, branch, ls-files. " +
    "Any other subcommand is rejected. Use this to inspect history, " +
    "see uncommitted changes, or list tracked files.",
  input_schema: {
    type: "object",
    properties: {
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments after `git`, e.g. ['log', '--oneline', '-5'].",
      },
    },
    required: ["args"],
  },
  max_output_bytes: 32 * 1024,
  run: async ({ args }) => {
    const a = (args as string[]) ?? [];
    if (a.length === 0 || !ALLOWED.has(a[0])) {
      return { ok: false, error: `subcommand not allowed: ${a[0] ?? "(none)"}` };
    }
    try {
      const proc = Bun.spawn(["git", ...a.map(String)], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      if (code !== 0) return { ok: false, error: stderr || `git exited ${code}` };
      return { ok: true, value: stdout };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
