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
