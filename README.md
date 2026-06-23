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
| `post-03` | [Tools: How Agents Actually Do Things](https://raskell.io/articles/tools-how-agents-actually-do-things/) |
| `post-04` | [Context Is the Product](https://raskell.io/articles/context-is-the-product/)                    |
| `post-05` | [Retrieval Is a Tool, Not a Layer](https://raskell.io/articles/retrieval-is-a-tool-not-a-layer/) |
| `post-06` | [Memory Is a Write Path](https://raskell.io/articles/memory-is-a-write-path/)                    |

```
git checkout post-01   # the ~150-line single-tool agent
git checkout post-02   # adds a hardened, sandboxed shell tool
git checkout post-03   # adds a real registry, three more tools, parallel dispatch
git checkout post-04   # adds a .AGENTS/ context loader
git checkout post-05   # turns the loader into a lexical retriever behind a tool
git checkout post-06   # adds a durable, agent-owned memory write path
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

## Post-03 notes

`post-03` promotes the one-tool agent into a real toolbox. The tools move
into a `tools/` subdirectory, `types.ts` gains a tagged-union `ToolResult`
and a `max_output_bytes` field, a new `registry.ts` owns lookup, dispatch,
exception wrapping, and per-tool output capping, and `agent.ts` runs all
tool calls from a single turn in parallel via `Promise.all`. Three new
tools land: `fs_read`, `http_get`, and `git` (read-only allow-list).

The diff against `post-02`:

```
git diff post-02 post-03
```

## Post-04 notes

`post-04` adds the context layer. A new `context.ts` loads markdown
files from a `.AGENTS/` directory at startup, applies a 32 KB byte
budget across all sources, and wraps each one in a `<context path="...">`
block. `agent.ts` weaves the rendered context into the system prompt
underneath a small `CORE_PROMPT` describing the agent's role and tools.

The repo ships with three example sources: `overview.md`,
`conventions.md`, and `glossary.md`. Drop more `.md` files in
`.AGENTS/` and they get loaded alphabetically after the three known
names. Override the directory with the `AGENTS_DIR` environment
variable. Override the byte budget by passing `maxBytes` to
`loadContext()`.

The diff against `post-03`:

```
git diff post-03 post-04
```

## Post-05 notes

`post-05` splits the context layer in two. `context.ts` now only pins the
always-on files, `overview.md` and `conventions.md`, into the system
prompt. The rest of `.AGENTS/` becomes searchable on demand. A new
`retriever.ts` chunks the non-pinned markdown by heading, ranks sections
with BM25, and renders a manifest of what is available. A new
`tools/context_search.ts` exposes that retriever as a registry tool, so
the model pulls the slice it needs per task instead of paying for the
whole directory every turn.

No embeddings and no vector store: at `.AGENTS/` scale the corpus is a
handful of markdown files, and a lexical ranker beats a database you have
to host and keep in sync. The article explains when embeddings start to
earn their keep.

The repo adds two more searchable sources, `security.md` and
`architecture.md`, alongside the now-searchable `glossary.md`. The
`context_search` tool takes a `query` and an optional `k` (default 3).

The diff against `post-04`:

```
git diff post-04 post-05
```

## Post-06 notes

`post-06` gives the agent a write path. Retrieval (post-05) reads context
the project authored; memory is the agent writing context for its own
future sessions. A new `memory.ts` owns a `memory/` directory, one file
per fact, each with `name`, `description`, and `type` frontmatter. The
`name` is a slug and the filename stem, so writing the same name twice
corrects a memory in place instead of forking it. `MEMORY.md` is an index
derived from the files and regenerated on every write, so it cannot drift
out of sync with the facts it points at.

Two new tools land. `memory_write` is the write path: it validates the
shape, clamps the body size, slugs the name, and writes only inside
`memory/`, never `.AGENTS/`. `memory_search` reuses the post-05 BM25
retriever over the memory bodies, so recall is the same ranker pointed at
a second corpus. The one-line summaries are pinned into the system prompt
every turn; the full bodies are pulled on demand.

The split that keeps the agent from corrupting its own ground truth is a
directory boundary and an authority boundary. `.AGENTS/` is project truth
and read-only to the agent. `memory/` is the agent's own notes, framed in
the prompt as fallible and lower-authority than the pinned context. The
repo ships two seed memories so a fresh clone has a populated index.

The diff against `post-05`:

```
git diff post-05 post-06
```
