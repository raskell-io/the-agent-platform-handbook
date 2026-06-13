# Glossary

Terms used throughout this repo and the matching posts.

- **Harness.** The code that wraps the model and turns a chat API into
  something that acts. Loop, tools, system prompt, dispatcher, budgets,
  context loader. Everything that is yours to write and operate. The
  model is a dependency you call; the harness is the artifact you ship.
- **Registry.** The named map from tool name to handler. Holds tools,
  exposes the schema view to the model, dispatches calls, caps output.
- **Tool.** A finite, named, side-effecting operation the model is
  allowed to invoke. Has a JSON schema for input, a handler, and an
  optional `max_output_bytes` cap.
- **Sandbox.** The hardened container (and gVisor, on Linux) the
  `shell` tool runs inside. See `post-02`.
- **Context.** Information the model can read beyond the user's turn:
  the system prompt, the prior message history, the contents of files
  loaded from `.AGENTS/`.
- **Tool result.** A `{ ok, value | error }` tagged union. Tools never
  throw to the loop. The model reads the error and decides what to do.
