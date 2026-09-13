# Resin.tools — Project Guide for Codex

**`CLAUDE.md` is the canonical project guide. Read it in full before doing any
work in this repository, and treat every rule in it as applying to you.**

This file exists because Codex reads `AGENTS.md`, not `CLAUDE.md`. It is
deliberately a pointer rather than a copy: an earlier version of this file was
a 727-line search-and-replace mirror of `CLAUDE.md`, and it had already drifted
(it referred to a `.Codex/agents/` directory and a "Codex in Chrome" integration
that do not exist). Keeping one source of truth means the two cannot disagree.

## How to read `CLAUDE.md` as Codex

- Where it says "Claude", read "the assistant working in this repository."
- The diagnostic subagents it describes live in `.claude/agents/*.md`. The Codex
  equivalents live in `.codex/agents/*.toml`, which is local-only (`.codex/` is
  gitignored because its `config.toml` holds an MCP access token). Keep the two
  sets of agent definitions in step by hand when one changes.
- "Claude in Chrome" is a Claude-specific browser integration. For Codex, use
  the Playwright MCP server configured in `.codex/config.toml` under the same
  restrictions listed in the "Browser Preview and UI Testing" section.

Everything else — product concepts, data-model boundaries, Supabase and RT Sync
rules, testing expectations, Git/workflow rules, security rules, and the list of
deferred future ideas — applies unchanged.
