import type { Tool } from "./types";

const SANDBOX_IMAGE = "alpine:3.20";
const SANDBOX_WORKDIR = "/work";

const dockerArgs = (image: string, command: string) => [
  "docker", "run",
  "--rm",
  "--runtime=runsc",                  // gVisor. drop on macOS.
  "--network=none",                   // no exfil, no SSRF
  "--read-only",                      // no writes to the rootfs
  "--tmpfs", "/tmp:size=64m",         // give /tmp back, bounded
  "--cap-drop=ALL",                   // no Linux capabilities
  "--security-opt=no-new-privileges", // no setuid escalation
  "--user=1000:1000",                 // unprivileged uid in the container
  "--memory=256m",                    // hard memory cap
  "--cpus=0.5",                       // fractional cpu cap
  "--pids-limit=64",                  // no fork bombs
  "--workdir", SANDBOX_WORKDIR,
  image,
  "sh", "-c", command,
];

export const shell: Tool = {
  name: "shell",
  description:
    "Run a shell command inside an isolated sandbox with no network and a read-only filesystem. Returns stdout, stderr, and exit code as JSON.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to run under `sh -c` inside the sandbox.",
      },
    },
    required: ["command"],
  },
  run: async ({ command }) => {
    const args = dockerArgs(SANDBOX_IMAGE, String(command));
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return JSON.stringify({ code, stdout, stderr });
  },
};
