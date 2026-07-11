---
name: codebase-memory
description: >
  Structural codebase exploration instead of file-by-file reading — a lite,
  script-based port of codebase-memory-mcp (github.com/DeusData/codebase-memory-mcp).
  Build a persistent symbol map (functions, classes, types with file:line),
  then answer architecture, call-chain, impact, and dead-code questions by
  querying the map, loading only the exact lines needed. Use when exploring an
  unfamiliar or large codebase, or when asked "index this project", "map the
  codebase", "where is X defined", "who calls X", "impact of changing X", or
  "find dead code".
license: MIT
---

# Codebase Memory (lite)

The original is a local MCP server (single C binary, tree-sitter, 158
languages, <1ms graph queries) that cannot run inside Claude.ai. This skill
preserves its working principle: **one structural query replaces dozens of
grep/read cycles.** Index once, then query the index — never page whole files
into context.

## Workflow

1. **Index once per session:**
   `python3 scripts/index_codebase.py <repo_dir> /tmp/symbols.tsv`
   (regex-based; covers Python, JS/TS, Go, Rust, Java/Kotlin/C#, PHP, C/C++, Ruby).
2. **Query the map, not the files:**
   - Definition: `python3 scripts/index_codebase.py --query Name /tmp/symbols.tsv`
   - Callers: `python3 scripts/index_codebase.py --callers Name <repo_dir>`
   - Architecture overview: `cut -f3 /tmp/symbols.tsv | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head`
3. **Read surgically:** once the map gives `file:line`, open only that range
   (`sed -n 'X,Yp'`), never the whole file.
4. **Impact analysis:** callers of X + callers of those callers (repeat
   `--callers` one hop at a time); report the chain as `a() -> b() -> c()`.
5. **Dead code:** a symbol in the map with zero caller hits outside its own
   definition is a dead-code candidate — verify exports/entry points before
   claiming it.

## Rules

- Re-index after large edits; the map is cheap (seconds) and staleness causes
  wrong answers.
- Answer structural questions from the map with `file:line` citations.
- Total context loaded for a structural question should be the map hits plus
  a few dozen source lines — if you're about to read a third full file,
  query the map instead.

## Limits vs. the original

No semantic type resolution (LSP), no persistent cross-session graph, no
Cypher queries, no HTTP route linking, no 3D UI. For those, install the real
codebase-memory-mcp binary with a local agent (Claude Code, etc.).
