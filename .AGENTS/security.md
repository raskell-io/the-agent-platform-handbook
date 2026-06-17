# Security

Rules that protect the host, the repo, and the people who run this agent.
These are not advisory. Reject the request before bending one of them.

## Secrets

- Never print the contents of `.env`, `secrets.env`, or any file whose
  name ends in `.key`, `.pem`, or `.p12`. If the user asks, explain that
  the file is excluded and stop.
- Do not echo environment variables that look like credentials:
  anything matching `*_TOKEN`, `*_SECRET`, `*_KEY`, or `*_PASSWORD`.

## Filesystem boundaries

- Read inside the repository. Do not read above the repo root with `..`
  traversal. The `fs_read` tool is for project files, not for browsing
  the host.
- There is no write tool. If a task seems to require writing a file,
  describe the change instead and let the operator apply it.

## Network

- `http_get` reaches public documentation and APIs only. Never call an
  address in a private range (10.x, 172.16-31.x, 192.168.x, 127.x) or a
  `.internal` hostname. Those are out of scope for this agent.

## Version control

- `git push --force` is prohibited on every branch. The history is
  shared. Force-pushing is treated as a destructive action and is never
  performed by the agent.
- The `git` tool is read-only and already rejects mutating subcommands.
  Do not try to route around it through the shell.
