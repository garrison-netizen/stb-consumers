---
description: End-of-session pause — push code repos, delta-push changed memory to Notion, post a session FYI to the Cross-Agent Channel. Mirrors Architect/Advisor pause etiquette.
---

Run the end-of-session pause sequence.

All paths are machine-agnostic. Resolve once with PowerShell and reuse:
- Memory folder: `"$env:USERPROFILE\.claude\projects\C--Users-$env:USERNAME\memory"`
- Sentinel: memory folder + `\.last-push`
- Repo base: `"$env:USERPROFILE"`
- Machine: `$env:USERNAME` = `garrison` → "Machine A"; `garri` → "Machine B".

## Step 0 — Sync code repos (don't leave work stranded on this machine)

For each tracked repo (`stb-master-calendar`, `stb-private-event-calculator`, `stb-consumers`) whose folder exists, report its git state and push any committed work that isn't on GitHub yet:

```powershell
$base = $env:USERPROFILE
foreach ($r in @('stb-master-calendar','stb-private-event-calculator','stb-consumers')) {
  $p = Join-Path $base $r
  if (-not (Test-Path $p)) { continue }
  $dirty = git -C $p status --porcelain
  $ahead = git -C $p rev-list --count '@{u}..HEAD' 2>$null
  if ($ahead -and [int]$ahead -gt 0) {
    Write-Output "PUSHING  $r — $ahead commit(s) ahead of GitHub"
    git -C $p push 2>&1 | Out-Null
  }
  if ($dirty) {
    Write-Output "UNCOMMITTED  $r has local edits not committed:"
    Write-Output $dirty
  } elseif (-not $ahead -or [int]$ahead -eq 0) {
    Write-Output "CLEAN  $r — in sync with GitHub"
  }
}
```

Rules:
- **Push** any repo that is ahead (committed but not pushed) so the other machine can pull it. NOTE: both apps deploy from GitHub `main`, so pushing `main` triggers a production deploy — that's intended for committed work, but say so in the report.
- **Do NOT auto-commit** uncommitted edits — that could deploy half-finished work. Instead, list every repo with UNCOMMITTED changes prominently and ask Garrison whether to commit + push or leave them. Nothing should be silently left behind, but nothing half-done should silently ship either.

## Step 1 — Identify changed memory files (delta push)

1. Read the sentinel file (memory folder + `\.last-push`). It contains an ISO-8601 timestamp — the last time a push completed. If it doesn't exist, treat last push time as epoch (push all files).

2. List `.md` files in the memory folder newer than the sentinel:
   ```powershell
   $mem = "$env:USERPROFILE\.claude\projects\C--Users-$env:USERNAME\memory"
   $sentinel = if (Test-Path "$mem\.last-push") { [datetime](Get-Content "$mem\.last-push") } else { [datetime]::MinValue }
   Get-ChildItem "$mem\*.md" | Where-Object { $_.Name -ne "MEMORY.md" -and $_.LastWriteTime -gt $sentinel } | Select-Object Name, LastWriteTime
   ```

3. If no files are newer than the sentinel: report "No memory changes since last push — skipping Notion sync." and skip to Step 3.

## Step 2 — Push changed files to Notion

For each changed file only:

1. Read the file. Parse YAML frontmatter: `name`, `description`, `metadata.type`. Body = everything after the second `---`.
2. Detect machine: `$env:USERNAME` = "garrison" -> "Machine A"; "garri" -> "Machine B".
3. Search the Code Memory Store (`collection://3252204e-561d-47d5-82b8-6521ed678d43`) for a row matching the `name` slug.
   - If found: update Description, Type, Body, Source machine, Last synced (today's date).
   - If not found: create a new row with Status = Active, Load at startup = checked.
4. After all changed files are pushed, write the current ISO-8601 timestamp to the sentinel (memory folder + `\.last-push`).
5. Report: "Pushed N changed entr(y/ies) to Notion. Sentinel updated."

## Step 3 — Post session pause to Cross-Agent Channel

Post a row to the Cross-Agent Channel (data source `ecc8ead5-0855-424e-8f2c-33399f28c601`):

- From: Code
- To: Architect
- Type: FYI
- Status: Unread
- Subject: `Code session pause {YYYY-MM-DD} — {2-4 word summary of what was done}`
- Body: Brief summary of the session — what was built or decided, any open items, any memory entries added or updated. Keep it tight; this is orientation for the Architect, not a full transcript.

**Only post if the session actually touched the Brain or something the Architect owns.** Pure app/infra work (calendar, calculator, Vercel, GitHub) does not need a channel post — skip it and say so. When you do post, **draft it and present to Garrison for release before posting** (draft-then-release protocol). Do not post without explicit release.
