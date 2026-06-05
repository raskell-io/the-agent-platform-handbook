# The Agent Platform Handbook

Reference agent built post-by-post alongside the
[Agent Platform Handbook series](https://raskell.io/articles/what-an-agent-actually-is/)
on raskell.io.

Each post lands as one tag. Check out a tag to see exactly the code that
post discusses.

## Posts and tags

| Tag       | Post                                                                                            |
|-----------|-------------------------------------------------------------------------------------------------|
| `post-01` | [What an Agent Actually Is](https://raskell.io/articles/what-an-agent-actually-is/)             |
| `post-02` | [Your Agent Wants Root](https://raskell.io/articles/your-agent-wants-root/)                     |

```
git checkout post-01   # the ~150-line single-tool agent
git checkout post-02   # adds a hardened, sandboxed shell tool
```

`main` always tracks the latest post.

## Requirements

- [Bun](https://bun.sh) 1.1 or newer
- `ANTHROPIC_API_KEY` in the environment

## Run

```
bun install
bun agent.ts "list the three largest files under /etc"
```

## Post-02 notes

`post-02` adds a hardened, sandboxed shell tool. Tool calls now run inside
a one-shot `alpine:3.20` container with no network, a read-only rootfs,
all Linux capabilities dropped, an unprivileged uid, `no-new-privileges`,
and CPU/memory/pid caps. On Linux, install
[gVisor](https://gvisor.dev/docs/user_guide/install/) and the args use
`--runtime=runsc` automatically. On macOS, drop the `--runtime=runsc`
flag (or run the agent inside a Linux VM) and the hardened Docker flags
still apply.

Requires `docker` on the host.
