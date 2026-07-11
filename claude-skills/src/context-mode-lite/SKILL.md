---
name: context-mode-lite
description: >
  Keep raw data out of the context window — a prompt/script port of
  context-mode (github.com/mksglu/context-mode). Whenever a task involves
  bulky data (many files, large logs, big JSON/CSV, long command output,
  fetched pages), write a small script that processes it in the sandbox and
  print only the distilled result, instead of reading raw content into
  context. Also maintains a session notes file for continuity. Use for data
  analysis, log digging, multi-file counting/statistics, large-output tools,
  or when the user says "context mode", "save context", "think in code", or
  "don't dump that into chat".
---

# Context Mode (lite)

The original is an MCP server with hooks, an FTS5-indexed SQLite session
store, and sandbox tools. Those can't run in Claude.ai, but its central
paradigm can: **the model should program the analysis, not be the data
processor.** Raw bytes stay in the sandbox; only conclusions enter context.

## Think in Code

Before reading data, ask: "could a 10-line script answer this?" If yes, write
it and `print()` only the answer.

- Counting/aggregating over many files: one script that walks and tallies —
  never N file reads. (47 reads = 700 KB; one script = a few KB.)
- Large log or JSON: script filters/reduces it; print matches, counts, or the
  top-N slice, capped (`[:40]`).
- Fetched web/API content: save to a file first, then grep/parse the file;
  quote only the relevant excerpt.
- Chained steps (parse → filter → join → summarize): one script, not one
  tool call per step.

## Index and search, don't re-read

For material you'll consult repeatedly, build a scratch index once:
`grep -rn "" corpus/ > /tmp/idx.txt` (or a script writing key:value lines),
then answer later questions with `grep` against `/tmp/idx.txt`. Never re-read
a large source twice.

## Session continuity

Maintain `/tmp/session-notes.md`: append one line per significant event —
files edited, decisions made, tasks open, errors hit. After any context
compaction or when resuming, read it back (grep for the topic, not the whole
file if it's grown) to recover exact state.

## What this does NOT govern

Prose style of final answers stays untouched — brevity/formatting is the
user's or another skill's business (deliberately, per upstream: aggressive
brevity prompts can hurt reasoning). This skill only routes *data*.

## Limits vs. the original

No automatic hook enforcement, no persistent cross-session SQLite/BM25 store,
no `ctx_*` MCP tools or savings statusline. Those need the context-mode
plugin in a hook-capable agent (Claude Code, Gemini CLI, Cursor, etc.).
