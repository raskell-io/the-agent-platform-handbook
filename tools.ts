export type Tool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  run: (input: Record<string, unknown>) => Promise<string>;
};

export const shell: Tool = {
  name: "shell",
  description:
    "Run a shell command in the current working directory and return its stdout, stderr, and exit code as JSON.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to run. Runs under `sh -c`.",
      },
    },
    required: ["command"],
  },
  run: async ({ command }) => {
    const proc = Bun.spawn(["sh", "-c", String(command)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return JSON.stringify({ code, stdout, stderr });
  },
};
