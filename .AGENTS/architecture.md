# Architecture

How the harness fits together, for tasks that touch its internals.

## The loop

`agent.ts` owns the loop. It builds the system prompt once, then calls the
Anthropic Messages API in a bounded `for` loop. On `tool_use` it dispatches
every tool call from the turn in parallel through the registry and feeds the
results back. On `end_turn` it prints the final text and returns.

## The registry

`registry.ts` is the named map from tool name to handler. It exposes the
schema view the model sees, dispatches calls, wraps handler exceptions into
error results, and caps each tool's output at `max_output_bytes`. Tools never
throw to the loop.

## Tools

Each file in `tools/` exports one `Tool`: a name, a JSON input schema, an
optional output cap, and an async handler returning a `{ ok, value | error }`
result. The four built-ins are `shell`, `fs_read`, `http_get`, and `git`.
`context_search` is built at startup because it closes over the loaded index.

## Context

`context.ts` pins a small set of always-on files into the system prompt.
`retriever.ts` indexes the rest of `.AGENTS/` and ranks sections with BM25 so
the `context_search` tool can pull only what a task needs. No embeddings, no
vector store: the corpus is a handful of markdown files.
