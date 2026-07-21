---
description: Refresh context — pull code repos current, pull memory from Notion, regenerate local cache, walk the Cross-Agent Channel. Use at start of every session.
---

Refresh context for this session.

**Paths resolve dynamically** — the same command works whether Code runs from the internal drive or the T7 (no hardcoding). Resolve once in PowerShell and reuse:

```powershell
$CFG  = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { "$env:USERPROFILE\.claude" }
$REPO = if ($env:STB_REPOS)         { $env:STB_REPOS }         else { $env:USERPROFILE }
$SLUG = (Get-Location).Path -replace '[:\\]','-'   # e.g. C--Users-garrison (internal) or E--repos (T7)
$MEM  = Join-Path $CFG "projects\$SLUG\memory"
```
- `$CFG` = Claude config dir (commands live at `$CFG\commands`)
- `$REPO` = base folder holding the git repos
- `$MEM` = this project's memory folder
- Machine tag (for Source-machine on push): `$env:USERNAME` = `garrison` → Machine A; `garri` → Machine B.

## Step 0 — Sync code repos (do this FIRST, before any work)

Tracked repos (each clone lives at `$REPO\<name>`): `stb-master-calendar`, `stb-private-event-calculator`, `stb-consumers`, `stb-exec-console`.

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
foreach ($r in @('stb-master-calendar','stb-private-event-calculator','stb-consumers','stb-exec-console')) {
  $p = Join-Path $REPO $r
  if (-not (Test-Path $p)) { Write-Output "SKIP  $r (not present)"; continue }
  $pull = (git -C $p pull --ff-only 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -eq 0) { Write-Output "OK    $r — $pull"; continue }
  if ($pull -match 'timed out|Could not read from remote|could not resolve host|Connection (closed|reset)') {
    Write-Output "OFFLINE  $r — couldn't reach GitHub (network). Using local copy; re-pull and verify before ANY deploy."
  } else {
    Write-Output "BLOCKED  $r — local diverged from GitHub; resolve (commit+push or reset) before working/deploying:`n$pull"
  }
}
```

Three outcomes per repo:
- **OK** — pulled current. Safe to work/deploy.
- **OFFLINE** — couldn't reach GitHub (network), *not* a divergence. Warn, and **re-pull + verify before any deploy**.
- **BLOCKED** — local genuinely diverged. **STOP and surface to Garrison** before any work/deploy on that repo.

This guarantees the machine never silently works on or deploys stale code. (Both apps deploy from GitHub `main`, the single source of truth.)

## Step 0.5 — Self-heal the command files

Canonical copies of `refresh.md`/`pause.md` live in **stb-consumers/claude-commands/** (pulled current in Step 0). Sync the live commands from there:

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$CFG  = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { "$env:USERPROFILE\.claude" }
$src = Join-Path $REPO 'stb-consumers\claude-commands'
$dst = Join-Path $CFG 'commands'
if (Test-Path $src) {
  foreach ($f in @('refresh.md','pause.md')) {
    $s = Join-Path $src $f; $d = Join-Path $dst $f
    if ((Test-Path $s) -and (-not (Test-Path $d) -or (Get-FileHash $s).Hash -ne (Get-FileHash $d).Hash)) {
      Copy-Item $s $d -Force; Write-Output "Updated command file: $f"
    }
  }
}
```

Keeps `/pause` and `/refresh` identical on every machine automatically. **To CHANGE a command, edit the copy in `stb-consumers/claude-commands/` and commit — never the live copy (this step overwrites it).**

## Step 1 — Pull memory from Notion

Query the Code Memory Store (Notion data source `collection://3252204e-561d-47d5-82b8-6521ed678d43`) for all rows where Status = Active.

**If Notion is reachable:**
- For each row, write a file to `$MEM` with this exact format:
  ```
  ---
  name: {Name}
  description: {Description}
  metadata:
    type: {Type}
  ---

  {Body}
  ```
  Filename = `{Type}_{Name-minus-type-prefix}.md` (strip the leading `{type}-` from the Name slug, prepend `{type}_`). E.g. Name=`user-garrison`, Type=`user` → `user_garrison.md`.
- Regenerate `$MEM\MEMORY.md` as an index: one line per row where "Load at startup" is checked, format `- [{Name}]({filename}) — {Description}`.
- Report: "Memory pulled from Notion — {N} entries, last synced {most recent Last synced date}."

**If Notion is unreachable:**
- ALERT prominently: "WARNING: Notion unreachable. Running on cached memory. Cache last modified: {most recent file mtime in `$MEM`}. Memory may be stale."
- Proceed with whatever is on disk.

## Step 2 — Channel walk

Read the Cross-Agent Channel (data source `ecc8ead5-0855-424e-8f2c-33399f28c601`) for rows where `To = Code` AND `Status ∈ {Unread, Acknowledged}`.

If nothing is waiting, say so in one line. If there is an inbound row: acknowledge it (set Status = Acknowledged, add a brief Reply), report what it contains, and wait for Garrison's direction before acting.

## Step 3 — Report and wait

Briefly report: code-repo sync result (Step 0), what's in memory that matters this session, anything waiting on the channel. Then wait for Garrison's direction. Do not start work.
