# Claude Code command files — canonical, machine-synced

These are the **single source of truth** for the `/refresh` and `/pause` slash
commands used by STB Code on every machine (Machine A = `garrison`, Machine B =
`garri`). The files are machine-agnostic (all paths derive from
`$env:USERPROFILE` / `$env:USERNAME`), so the same file works everywhere.

## How sync works (no per-machine reapply)
- `/refresh` Step 0 pulls every tracked repo (including this one) current.
- `/refresh` Step 0.5 copies `refresh.md` / `pause.md` from here into
  `~/.claude/commands/` whenever they differ.

So changing a command propagates to every machine automatically on its next
`/refresh`.

## To change a command
Edit the copy **here** (`stb-consumers/claude-commands/`) and commit + push.
**Never** edit the live copy in `~/.claude/commands/` directly — `/refresh`
Step 0.5 overwrites it from this repo.

## First-time bootstrap on a machine
If a machine's `~/.claude/commands/` predates this system, run once:
`Copy-Item "$env:USERPROFILE\stb-consumers\claude-commands\*.md" "$env:USERPROFILE\.claude\commands\" -Force`
After that, Step 0.5 keeps it current automatically.
