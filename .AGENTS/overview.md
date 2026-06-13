# The Agent Platform Handbook

This repository is the reference harness for the
[Agent Platform Handbook](https://raskell.io/articles/what-an-agent-actually-is/)
series on raskell.io. Each git tag (`post-01`, `post-02`, ...) is the
exact state of the code that the matching post discusses.

## What is in this repo

- `agent.ts` is the loop. It calls the Anthropic Messages API, dispatches
  tool calls, and stops on `end_turn` or when the iteration budget is hit.
- `registry.ts` owns tool lookup, dispatch, exception wrapping, and
  per-tool output capping.
- `context.ts` loads project context from `.AGENTS/` at startup.
- `tools/` contains the four built-in tools: `shell`, `fs_read`,
  `http_get`, and `git`.
- `types.ts` defines `Tool` and the tagged-union `ToolResult`.

## How to think about the harness

The harness only ever grows. It does not get rewritten between posts.
Every post adds one file or extends one file, and the diff between two
tags is the entire delta of the matching post.
