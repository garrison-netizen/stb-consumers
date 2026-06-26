---
description: Refresh context — pull code repos current, pull memory from Notion, regenerate local cache, walk the Cross-Agent Channel. Use at start of every session.
---

Refresh context for this session.

All paths are machine-agnostic. Resolve them once with PowerShell and reuse:
- Memory folder: `"$env:USERPROFILE\.claude\projects\C--Users-$env:USERNAME\memory"`
- Commands folder: `"$env:USERPROFILE\.claude"` + `\commands`
- Repo base: `"$env:USERPROFILE"`
- Machine: `$env:USERNAME` = `garrison` → Machine A; `garri` → Machine B.

## Step 0 — Sync code repos (do this FIRST, before any work)

Tracked repos (clone lives at `$env:USERPROFILE\<name>`):
- `stb-master-calendar`
- `stb-private-event-calculator`
- `stb-consumers`

For each tracked repo whose folder exists on this machine, bring it current:

```powershell
$base = $env:USERPROFILE
foreach ($r in @('stb-master-calendar','stb-private-event-calculator','stb-consumers')) {
  $p = Join-Path $base $r
  if (-not (Test-Path $p)) { Write-Output "SKIP  $r (not on this machine)"; continue }
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
- **OK** — pulled current (or already current). Safe to work/deploy.
- **OFFLINE** — couldn't reach GitHub (network/SSH timeout), *not* a divergence. Local copy is whatever it was; warn, and **re-pull + verify before any deploy** so you don't ship stale code while offline.
- **BLOCKED** — local genuinely diverged from GitHub. **STOP and surface to Garrison before any work or deploy** on that repo; resolve first.

This is the mechanism that guarantees this machine never silently works on or deploys stale code. (Both apps deploy from GitHub `main`, so `main` is the single source of truth.)

## Step 0.5 — Self-heal the command files

The CANONICAL copies of `refresh.md` and `pause.md` live in the **stb-consumers** repo at `claude-commands/` (pulled current in Step 0). Sync the live command files from there:

```powershell
$src = Join-Path $env:USERPROFILE 'stb-consumers\claude-commands'
$dst = Join-Path $env:USERPROFILE '.claude\commands'
if (Test-Path $src) {
  foreach ($f in @('refresh.md','pause.md')) {
    $s = Join-Path $src $f; $d = Join-Path $dst $f
    if ((Test-Path $s) -and (-not (Test-Path $d) -or (Get-FileHash $s).Hash -ne (Get-FileHash $d).Hash)) {
      Copy-Item $s $d -Force; Write-Output "Updated command file: $f"
    }
  }
}
```

This keeps `/pause` and `/refresh` identical on every machine automatically — no per-machine reapply, ever. **To CHANGE a command, edit the copy in `stb-consumers/claude-commands/` and commit it — never the live copy in `.claude\commands\` (this step overwrites it from the repo).**

## Step 1 — Pull memory from Notion

Query the Code Memory Store (Notion data source `collection://3252204e-561d-47d5-82b8-6521ed678d43`) for all rows where Status = Active.

**If Notion is reachable:**
- For each row, write a local file to the memory folder with this exact format:
  ```
  ---
  name: {Name}
  description: {Description}
  metadata:
    type: {Type}
  ---

  {Body}
  ```
  Filename = `{Type}_{Name-minus-type-prefix}.md` — strip the leading `{type}-` from the Name slug, then prepend `{type}_`. Example: Name=`feedback-talk-to-garrison-plainly`, Type=`feedback` -> `feedback_talk-to-garrison-plainly.md`. Name=`user-garrison`, Type=`user` -> `user_garrison.md`.
- Regenerate MEMORY.md as an index: one line per row where "Load at startup" is checked, format `- [{Name}]({filename}) — {Description}`.
- Report: "Memory pulled from Notion — {N} entries, last synced {most recent Last synced date}."

**If Notion is unreachable:**
- ALERT prominently: "WARNING: Notion unreachable. Running on cached memory. Cache last modified: {most recent file modification date in the memory folder}. Memory may be stale."
- Proceed with whatever is on disk.

## Step 2 — Channel walk

Read the Cross-Agent Channel (data source `ecc8ead5-0855-424e-8f2c-33399f28c601`) for rows where `To = Code` AND `Status ∈ {Unread, Acknowledged}`.

If nothing is waiting, say so in one line.

If there is an inbound row: acknowledge it (set Status = Acknowledged, add a brief Reply), report what it contains, and wait for Garrison's direction before acting.

## Step 3 — Report and wait

Briefly report the state: code-repo sync result (Step 0), what's in memory that matters for the current session, what (if anything) is waiting on the channel. Then wait for Garrison's direction. Do not start work.
