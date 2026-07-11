---
name: rtk-lean-shell
description: >
  Token-lean shell usage, ported from RTK (Rust Token Killer,
  github.com/rtk-ai/rtk). Whenever running shell commands in a code-execution
  or bash environment (git, ls, grep, cat, test runners, linters, docker,
  package managers), choose flags and pipelines that emit the minimum output
  needed, instead of dumping raw verbose output into context. Use for any
  repo exploration, build, test, or git workflow, or when the user says
  "rtk", "save tokens on commands", "lean shell", or "compress command
  output".
license: Apache-2.0
---

# RTK Lean Shell

RTK is a Rust CLI proxy that filters command output before it reaches the
model, cutting 60–90% of tokens. Its binary and hooks can't run here, so apply
its filtering rules directly: never run a verbose command when a quiet variant
answers the same question.

## Core rules

1. Ask "what fact do I need?" and run the narrowest command that yields it.
2. Success needs one line. Silence or exit code 0 is a complete answer for
   add/commit/push/install/format — don't echo full logs.
3. On failure, show only the decisive lines: pipe long output to a file, then
   grep/tail the errors out of it.
4. Counts and names beat contents: `grep -lc`, `wc -l`, `--stat`, `--porcelain`.
5. Never `cat` a whole file to find one thing — `grep -n` with 2–3 lines of
   context, or `sed -n 'X,Yp'` for a known range.

## Recipes (verbose → lean)

| Instead of | Run |
|---|---|
| `git status` | `git status --porcelain=v1 -b` |
| `git log` | `git log --oneline -n 10` |
| `git diff` | `git diff --stat`, then per-file diff only where needed |
| `git add/commit/push` output | append `-q` / check `$?`; report one line |
| `ls -laR` / `tree` | `find . -maxdepth 2 -type f \| head -50` or `ls` on the one dir needed |
| `cat file` | `grep -n "pattern" file` or `sed -n '1,40p' file` |
| `grep -r text .` | `grep -rln text src/ \| head`, open only the winner |
| `npm test` / `pytest` / `cargo test` | run with output to a file: `cmd > /tmp/t.log 2>&1; tail -5 /tmp/t.log`; on failure `grep -E "FAIL\|error\|✗" -m 20 /tmp/t.log` |
| `pytest` (direct) | `pytest -q --no-header -x` |
| `cargo build` | `cargo build -q 2>&1 \| tail -20` |
| linters (`ruff`, `eslint`) | `ruff check --output-format=concise`; `eslint --format unix` |
| `docker ps` | `docker ps --format '{{.Names}} {{.Status}}'` |
| `npm install` | `npm install --silent 2>&1 \| tail -3` |

## Reporting

Relay conclusions, not transcripts: "142 tests passed" or "2 failures in
auth_test.py: <the two assert lines>" — never a full runner log. Quote error
text verbatim; summarize everything else.

## Limits

This is the prompt-level port. The original RTK also auto-rewrites commands
via agent hooks and tracks lifetime savings (`rtk gain`); those need the local
binary and a hook-capable agent (Claude Code, Cursor, etc.).
