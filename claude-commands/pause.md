---
description: End-of-session pause — push code repos, delta-push changed memory to Notion, post a session FYI to the Cross-Agent Channel. Mirrors Architect/Advisor pause etiquette.
---

Run the end-of-session pause sequence.

**Paths resolve dynamically** (works from the internal drive or the T7). Resolve once and reuse:

```powershell
$CFG  = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { "$env:USERPROFILE\.claude" }
$REPO = if ($env:STB_REPOS)         { $env:STB_REPOS }         else { $env:USERPROFILE }
$SLUG = (Get-Location).Path -replace '[:\\]','-'   # C--Users-garrison (internal) or E--repos (T7)
$MEM  = Join-Path $CFG "projects\$SLUG\memory"
$SENT = Join-Path $MEM '.last-push'
```
Machine tag: `$env:USERNAME` = `garrison` → "Machine A"; `garri` → "Machine B".

## Step 0 — Sync code repos (don't leave work stranded on this machine)

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
foreach ($r in @('stb-master-calendar','stb-private-event-calculator','stb-consumers','stb-exec-console')) {
  $p = Join-Path $REPO $r
  if (-not (Test-Path $p)) { continue }
  $dirty = git -C $p status --porcelain
  $ahead = git -C $p rev-list --count '@{u}..HEAD' 2>$null
  if ($ahead -and [int]$ahead -gt 0) { Write-Output "PUSHING  $r — $ahead commit(s) ahead"; git -C $p push 2>&1 | Out-Null }
  if ($dirty) { Write-Output "UNCOMMITTED  $r:"; Write-Output $dirty }
  elseif (-not $ahead -or [int]$ahead -eq 0) { Write-Output "CLEAN  $r" }
}
```

Rules:
- **Push** any repo that is ahead (committed but unpushed). NOTE: both apps deploy from GitHub `main`, so pushing `main` triggers a production deploy — intended for committed work, but say so in the report.
- **Do NOT auto-commit** uncommitted edits (could deploy half-finished work). List every repo with UNCOMMITTED changes prominently and ask Garrison whether to commit + push or leave them.
- **Release claims:** delete any `<repo>\.session-lock.json` owned by this session, and `git worktree remove` any worktree this session created (after its work is committed).

## Step 1 — Identify changed memory files (delta push)

1. Read the sentinel `$SENT`. It holds an ISO-8601 timestamp of the last push. If absent, treat as epoch (push all).
2. List `.md` files in `$MEM` newer than the sentinel:
   ```powershell
   $sentinel = if (Test-Path $SENT) { [datetime](Get-Content $SENT) } else { [datetime]::MinValue }
   Get-ChildItem "$MEM\*.md" | Where-Object { $_.Name -ne "MEMORY.md" -and $_.LastWriteTime -gt $sentinel } | Select-Object Name, LastWriteTime
   ```
3. If none are newer: report "No memory changes since last push — skipping Notion sync." and skip to Step 3.

## Step 2 — Push changed files to Notion

For each changed file only:
1. Read it. Parse YAML frontmatter: `name`, `description`, `metadata.type`. Body = everything after the second `---`.
2. Detect machine: `$env:USERNAME` = "garrison" → "Machine A"; "garri" → "Machine B".
3. Search the Code Memory Store (`collection://3252204e-561d-47d5-82b8-6521ed678d43`) for a row matching the `name` slug.
   - Found: **conflict check first** (concurrent sessions push too): if the row's "Last synced" is NEWER than this session's sentinel AND its Body differs from what this session last saw, another session updated it mid-flight — read the row's current Body and MERGE (union of the two, newest facts win) instead of overwriting; note the merge in the report. Never push an empty Body over a non-empty row. Then update Description, Type, Body, Source machine, Last synced (today).
   - Not found: create a row with Status = Active, Load at startup = checked.
4. After all pushes, write the current ISO-8601 timestamp to `$SENT`.
5. Report: "Pushed N changed entr(y/ies) to Notion. Sentinel updated."

## Step 3 — Post session pause to Cross-Agent Channel

**Only post if the session touched the Brain or something the Architect owns.** Pure app/infra work (calendar, calculator, Vercel, GitHub, the machine-sync setup) does NOT need a channel post — skip it and say so.

When you do post, add a row to the Cross-Agent Channel (data source `ecc8ead5-0855-424e-8f2c-33399f28c601`): From = Code, To = Architect, Type = FYI, Status = Unread, Subject = `Code session pause {YYYY-MM-DD} — {2-4 word summary}`, Body = tight orientation summary. **Draft it and present to Garrison for release before posting** (draft-then-release). Do not post without explicit release.
