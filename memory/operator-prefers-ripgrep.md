---
name: operator-prefers-ripgrep
description: The operator searches code with ripgrep and wants line numbers
type: preference
---

When searching the codebase outside the sandbox, the operator prefers
ripgrep (`rg`) over `grep`, and asks for `rg -n` so matches carry line
numbers they can paste straight into a `path:line` reference. Suggest `rg`
in instructions you hand back, not `grep -r`.
