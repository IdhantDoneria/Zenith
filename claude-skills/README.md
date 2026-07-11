# Claude Skills — converted from six GitHub repos

Upload-ready ZIPs live in [`dist/`](dist/); editable sources in [`src/`](src/).
Upload each ZIP at claude.ai → Settings → Capabilities → Skills.

## Conversion summary

| Repository | Project type | Converted | ZIP | Notes / limitations |
|---|---|---|---|---|
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | Native skill (+ Claude Code plugin) | ✅ Yes | `Caveman.zip` | Upstream's own packaged `dist/caveman.skill` SKILL.md, verbatim. `/caveman-stats`, statusline, hooks, and `caveman-shrink` MCP middleware are Claude Code–only and excluded. |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | Native skills (6) + plugin | ✅ Yes | `Ponytail.zip` | Six upstream skills consolidated into one: core ladder in SKILL.md; review/audit/debt as on-demand references (verbatim bodies). `ponytail-gain`/`ponytail-help` (display-only marketing cards) dropped to save tokens. |
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | Rust CLI proxy (agent hook integration) | ⚠️ Closest achievable | `RTK-Lean-Shell.zip` | The binary intercepts shell commands via local hooks — impossible on claude.ai. Skill re-encodes its filtering rules as prompt-level command recipes. No auto-rewrite, no `rtk gain` stats. (The repo's `.claude/skills/` are internal dev skills for building rtk itself, not the product.) |
| [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | MCP server (C binary + LSP daemon) | ⚠️ Closest achievable | `Codebase-Memory.zip` | MCP servers can't be packaged as skills. Skill preserves the paradigm (index once, query the graph, read surgically) via a bundled Python indexer. No tree-sitter/LSP semantics, no persistent graph, no Cypher/UI. |
| [mksglu/context-mode](https://github.com/mksglu/context-mode) | MCP server + multi-agent hook plugin | ⚠️ Closest achievable | `Context-Mode.zip` | Requires an MCP server, SQLite/FTS5 store, and lifecycle hooks — none exist on claude.ai. Skill ports the "Think in Code" paradigm + scratch indexing + session-notes continuity. No enforcement hooks or `ctx_*` tools. |
| [lamb92009/claude-skill-loader](https://github.com/lamb92009/claude-skill-loader) | Native skills (2) | ✅ Yes (format) | `Skill-Loader.zip`, `Skill-Cleanup.zip` | Packaged verbatim; spec-valid. **Functionally Claude Code–only**: they manage `~/.claude/skills/` via the `gh` CLI, neither of which exists on claude.ai, and both contain placeholder config (`your-github-username`) you must edit before use. |

## Working together

No conflicting instructions: each skill governs a disjoint layer —
**caveman** = prose style of replies, **ponytail** = how much code gets written,
**rtk-lean-shell** = which shell commands run, **codebase-memory** = how code is
explored, **context-mode-lite** = how bulky data is processed. context-mode-lite
explicitly defers prose style to caveman; ponytail explicitly pairs with caveman;
rtk-lean-shell (per-command flags) and context-mode-lite (script-first for bulk
data) reference complementary scopes. Descriptions use distinct trigger phrases.

## Token notes

Only each skill's `description` sits in context permanently (~100–250 tokens
each); bodies load on trigger. Expected savings once triggered, from upstream
measurements: caveman ~65% output tokens (upstream adds the caveat that the
skill itself costs ~1–1.5k input tokens/turn when active); ponytail ~54% less
code / ~22% fewer tokens; rtk ~60–90% on command output (prompt port will be
lower — no enforcement); codebase-memory-mcp claims ~10× fewer exploration
tokens (lite port smaller but same direction); context-mode up to ~98% on bulk
data reads when the script path is taken. skill-loader/skill-cleanup save
tokens only in Claude Code (lean skill directory), none on claude.ai.
