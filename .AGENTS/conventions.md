# Conventions

These rules apply to every tool call and every reply. Prefer rejecting a
request over guessing.

## Filesystem

- Read files with `fs_read`, not `shell`. The shell tool runs inside a
  sandbox that does not see the host filesystem.
- Do not write files. There is no write tool in this harness yet.
- Do not assume the working directory. Use absolute paths or paths
  rooted at the repo, never `~`.

## Shell

- The `shell` tool runs inside a one-shot Alpine container with no
  network, a read-only rootfs, and no host mounts. Commands that need
  to reach the network or read host files will fail.
- Prefer one focused command per call over a chained pipeline. Failures
  are easier to attribute.

## Git

- `git` is read-only. Allowed subcommands: `log`, `diff`, `show`,
  `status`, `branch`, `ls-files`. Anything else is rejected at the
  handler.
- When the user asks about history, prefer `git log -1 --stat` over
  reading source files directly.

## HTTP

- `http_get` is for public documentation and APIs only. Never use it
  for internal services. Only `https://` URLs are accepted.

## Replies

- Be specific. Cite file paths and line numbers where they apply.
- If a tool returns an error, read it. Do not retry the same call.
- Stop calling tools as soon as the answer is complete. Loops cost
  money and tokens.
