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

Canonical copies of `refresh.md`/`pause.md`/`watch.md` live in **stb-consumers/claude-commands/** (pulled current in Step 0). Sync the live commands from there:

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$CFG  = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { "$env:USERPROFILE\.claude" }
$src = Join-Path $REPO 'stb-consumers\claude-commands'
$dst = Join-Path $CFG 'commands'
if (Test-Path $src) {
  foreach ($f in @('refresh.md','pause.md','watch.md')) {
    $s = Join-Path $src $f; $d = Join-Path $dst $f
    if ((Test-Path $s) -and (-not (Test-Path $d) -or (Get-FileHash $s).Hash -ne (Get-FileHash $d).Hash)) {
      Copy-Item $s $d -Force; Write-Output "Updated command file: $f"
    }
  }
  # Desktop utilities (tools\*.ps1) + their shortcuts
  $tsrc = Join-Path $src 'tools'
  $tdst = Join-Path $env:USERPROFILE 'Tools'
  if (Test-Path $tsrc) {
    if (-not (Test-Path $tdst)) { New-Item -ItemType Directory -Path $tdst -Force | Out-Null }
    foreach ($t in Get-ChildItem $tsrc -Filter *.ps1) {
      $d = Join-Path $tdst $t.Name
      if (-not (Test-Path $d) -or (Get-FileHash $t.FullName).Hash -ne (Get-FileHash $d).Hash) {
        Copy-Item $t.FullName $d -Force; Write-Output "Updated tool: $($t.Name)"
      }
    }
    $ejt = Join-Path $tdst 'Eject-T7.ps1'
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Eject T7.lnk'
    if ((Test-Path $ejt) -and -not (Test-Path $lnk)) {
      $ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut($lnk)
      $sc.TargetPath = 'powershell.exe'
      $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ejt`""
      $sc.WorkingDirectory = $tdst; $sc.IconLocation = 'shell32.dll,222'
      $sc.Description = 'Safely eject the Samsung T7'; $sc.Save()
      Write-Output "Created desktop shortcut: Eject T7"
    }
  }
}
```

Keeps `/pause`, `/refresh` and `/watch` identical on every machine automatically. **To CHANGE a command, edit the copy in `stb-consumers/claude-commands/` and commit — never the live copy (this step overwrites it).**

## Step 0.6 — Design-token drift gate

The apps cannot import the canonical stylesheet — each is its own repo built independently by Vercel from its own checkout — so they carry **vendored copies** of the brand token block, and vendored copies drift. On 2026-07-31 it drifted twice in one day: the Master Calendar introduced a whole coffee palette the canonical file did not know about, and `--muted` sat below the WCAG contrast floor in two live apps. Both were found by hand, late. This is the mechanical guard.

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$gate = Join-Path $REPO 'stb-consumers\tools\design-tokens\check-design-tokens.ps1'
if (Test-Path $gate) { & $gate } else { Write-Output "SKIP — token gate not present (stb-consumers may predate it)" }
```

Reports three states per app: **DRIFT** (token in both, values differ), **UNKNOWN** (token in an app but absent from canonical — new palette work that needs adopting), **OK**. Exit code 1 on any problem.

It deliberately does NOT auto-fix. Blind-copying a token block into a live app can delete a variable that app's rules still reference, which fails silently at runtime as an unstyled element. When it reports drift, decide which side is right and say so — sometimes the app is, which is how the coffee palette became canonical.

If it reports drift, surface it in the Step 3 report. Do not start brand or UI work on a drifting app without resolving it first.

## Step 0.65 — Deploy-drift gate (Apps Script pipelines)

**The GAS pipelines do NOT auto-deploy from main.** Repo state and live-pipeline state are separate claims, and on 2026-07-31 they had been separate for two days across *two* pipelines without anyone knowing — the live `vip-marts` loader was missing the chain-store merge key, the carve-class support and the corrected airport predicate; `vip-marts-weekly` was missing carve class entirely and would have written Mart C rows with none. Both were committed and verified days earlier and simply never pushed. The next scheduled run would have re-split 15 adjudicated account merges.

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$gate = Join-Path $REPO 'stb-consumers\tools\deploy-drift\check-deploy-drift.ps1'
if (Test-Path $gate) { & $gate -Quiet } else { Write-Output "SKIP — deploy gate not present" }
```

Reports **DRIFT** (live differs from repo), **ONLY-REPO** (committed, never deployed), **ONLY-LIVE** (edited in the GAS editor; a push will delete it). Exit 0 clean, 1 drift, 2 could not verify.

It deliberately does NOT push — auto-deploying a working tree is how half-finished work reaches production. When it reports drift, read the diff before pushing: confirm live is strictly *behind* rather than carrying edits made in the GAS editor, then `cd pipelines/<name>; clasp push`.

**Never treat a commit as evidence that a pipeline changed.** If this gate cannot verify a pipeline, say so in the Step 3 report rather than implying it is clean.

## Step 0.66 — Category-semantics gate

STB deliberately repurposes POS category codes — Arryved's `RETAIL_CIDER` holds **THC**, not cider, because STB sells no cider and that was the only clean way to split THC out from beer. Sound decision, but the label lies about its contents, and on 2026-07-31 it reached an analysis spec written as "RETAIL_BEER + RETAIL_CIDER" that would have flipped Feb-2025 from −25% to +23% and scored a promo a success on THC volume.

```powershell
$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$gate = Join-Path $REPO 'stb-consumers\tools\category-gate\check-category-semantics.mjs'
if (Test-Path $gate) { node $gate --quiet } else { Write-Output "SKIP — category gate not present" }
```

The conventions live in `tools/category-gate/category-conventions.json` as machine-readable data. The gate classifies from **item names**, never the category label, and fails when an item lands somewhere the convention says it should not.

**Read the register before writing any analysis that groups by category.** Adding a convention there is how an intentional repurposing is made safe; deleting one to silence the gate reintroduces the bug.

## Step 0.7 — Multi-session protocol (repo claims + presence)

Garrison runs multiple Code sessions at once. Three collisions have actually happened (commit-sweeps via the shared git index ×2, a memory-file clobber via blind sync), so these guards are mandatory, not etiquette:

1. **Presence:** list other CCD sessions (`list_sessions`); report any with activity in the last 6 hours by title. If one is plausibly working in a repo you need, message it (`send_message`) before touching that repo.
2. **Claims:** before the session's FIRST write in a repo, check `<repo>\.session-lock.json`. If it exists with a heartbeat under 4 hours old and another session's id → that repo is CLAIMED: either coordinate a handoff via `send_message`, or work in a worktree (`git -C <repo> worktree add <repo>-wt-<yourslug> main`, copy `.env`/`.clasp.json` in manually if needed; remove the worktree at /pause). If unclaimed, write your own lock `{ "session": "<id>", "title": "<title>", "heartbeat": "<ISO now>" }` and refresh the heartbeat when convenient. Locks are gitignored (ensure `.session-lock.json` is in the repo's `.gitignore` on first use).
3. **Commit hygiene in ANY shared clone:** stage explicit paths, never `git add -A`/`git commit -a`, and read `git status --short` for foreign staged files before every commit. The index is shared; a foreign `A`/`M` line means another session is mid-work — stop and coordinate.

## Step 1 — Pull memory from Notion

Query the Code Memory Store (Notion data source `collection://3252204e-561d-47d5-82b8-6521ed678d43`) for all rows where Status = Active.

**If Notion is reachable — MERGE-SAFE rules (a blind overwrite destroyed a session's memory on 2026-07-22; never again):**
- **Keep-local-if-newer:** before overwriting an existing file, compare the local file's LastWriteTime against the row's "Last synced" date. If local is NEWER and the content differs, KEEP the local file and log `KEPT-LOCAL {name}` — the local edits will delta-push at /pause.
- **Never empty-over-content:** if the row's Body is empty/whitespace and the local file has a non-empty body, keep the local file and log `SKIPPED-EMPTY {name}`.
- Otherwise, for each row, write a file to `$MEM` with this exact format:
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

## Step 2 — Channel walk (BOTH DIRECTIONS — this is not optional)

The Cross-Agent Channel is data source `ecc8ead5-0855-424e-8f2c-33399f28c601`.

**Query A — inbound.** Rows where `To = Code` AND `Status ∈ {Unread, Acknowledged}`.

**Query B — replies on Code's OWN outbound rows.** Rows where `From = Code`, created in roughly the last 14 days, where the **`Reply` property is non-empty** OR `Status ∈ {Acknowledged, Acted on}`. **Read the `Reply` property, not just the Body.**

> ⚠️ **Query B is where the Architect's rulings actually arrive.** He answers by writing into the `Reply` property of the row Code sent him and flipping that row's status — he often does *not* create a new inbound row. A `To = Code` query structurally cannot see those answers. Skipping Query B produced two false "blocked on Architect" reports in one session on 2026-07-29, cost Garrison two relay trips he didn't need to make, and forced the Architect to send a row titled *"UNBLOCK — you are not blocked on me."* Never report a block without having run Query B in the same turn.

Handling:
- Inbound rows (A): acknowledge (Status = Acknowledged, brief Reply), report the contents, and wait for Garrison's direction before acting.
- Replies (B): report the ruling and treat it as **received** — do not re-ask, and do not describe yourself as waiting on it.

**Report the result as explicit ownership lines, never as narrative Garrison has to decode:**

```
Waiting on Architect: <items, or "nothing">
Waiting on Code:      <items, or "nothing">
Waiting on Garrison:  <items, or "nothing">
```

If nothing is waiting on Garrison, say that outright — it is the single most useful line in the report.

## Step 3 — Report and wait

Briefly report: code-repo sync result (Step 0), what's in memory that matters this session, and the three ownership lines from Step 2. Then wait for Garrison's direction. Do not start work.
