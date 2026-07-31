<#
  check-deploy-drift.ps1 -- STB Apps Script deploy-drift gate

  WHY THIS EXISTS
  The GAS pipelines do NOT auto-deploy from main. The repo and the live script
  project are separate claims, and on 2026-07-31 they had been separate for two
  days without anyone knowing: the live vip-marts loader was missing
  VM_chainStoreKey_, the carve-class support and the corrected airport predicate,
  all committed and verified on 07-29/07-30 and never pushed. The next run would
  have re-split 15 adjudicated Goody Goody merges and written Mart A rows with no
  Carve class. It was caught by hand, minutes before a run window.

  That is the failure this gate exists to make impossible to miss. A merge
  ruling, a carve correction, a flag fix -- none of them are real until the live
  project carries them, and nothing else in the system checks that.

  WHAT IT REPORTS, per pipeline and per file
    DRIFT     file differs between repo and live   -> the live pipeline is NOT what you think it is
    ONLY-REPO file committed but absent live       -> never deployed
    ONLY-LIVE file live but absent from the repo   -> edited in the GAS editor, will be lost on next push
    OK        identical

  It deliberately does NOT push. Auto-deploying whatever is in the working tree
  is how an unreviewed half-finished change reaches production; the same reason
  check-design-tokens.ps1 reports rather than rewrites. A human decides.

  Line endings and the .gs/.js extension difference are normalized before
  comparing, because neither is a real difference.

  EXIT CODES  0 clean | 1 drift found | 2 could not verify (clasp missing/unauthed)

  USAGE
    pwsh check-deploy-drift.ps1                 # all pipelines
    pwsh check-deploy-drift.ps1 -Pipeline vip-marts
    pwsh check-deploy-drift.ps1 -Quiet          # problems only
#>

param([string]$Pipeline, [switch]$Quiet)

$ErrorActionPreference = 'Stop'

$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$root = Join-Path $REPO 'stb-consumers\pipelines'
if (-not (Test-Path $root)) { Write-Output "No pipelines directory at $root"; exit 2 }

# clasp is the only way to read the live project. Without it this gate cannot
# make any claim at all -- say so loudly rather than exiting clean.
$clasp = (Get-Command clasp -ErrorAction SilentlyContinue)
if (-not $clasp) {
  Write-Output "CANNOT VERIFY -- clasp is not installed, so live pipeline state is unknown."
  Write-Output "  Install with: npm i -g @google/clasp   then: clasp login"
  exit 2
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("stb-deploy-drift-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
$norm = { param($p) (Get-Content -Raw -Encoding UTF8 $p) -replace "`r`n", "`n" }

$targets = Get-ChildItem $root -Directory | Where-Object {
  (Test-Path (Join-Path $_.FullName '.clasp.json')) -and (-not $Pipeline -or $_.Name -eq $Pipeline)
}
if (-not $targets) { Write-Output "No clasp-configured pipelines found$(if($Pipeline){" matching '$Pipeline'"})."; exit 2 }

$problems = 0
$unverified = 0

foreach ($t in $targets) {
  $cfg = Get-Content -Raw (Join-Path $t.FullName '.clasp.json') | ConvertFrom-Json
  $scriptId = $cfg.scriptId
  $rootDir = if ($cfg.rootDir) { $cfg.rootDir } else { '.' }
  if (-not $scriptId) {
    Write-Output "SKIP   $($t.Name) -- .clasp.json has no scriptId"
    $unverified++
    continue
  }

  $srcDir = Join-Path $t.FullName $rootDir
  if (-not (Test-Path $srcDir)) { Write-Output "SKIP   $($t.Name) -- rootDir '$rootDir' not found"; $unverified++; continue }

  $work = Join-Path $tmp $t.Name
  New-Item -ItemType Directory -Path (Join-Path $work 'src') -Force | Out-Null
  @{ scriptId = $scriptId; rootDir = 'src' } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $work '.clasp.json')

  # clasp is invoked through a PowerShell shim whose exit code does not survive,
  # so success is judged by whether files actually landed. A wrong or revoked
  # scriptId reports "Requested entity was not found" and pulls nothing.
  # $ErrorActionPreference is relaxed across the call on purpose: PowerShell 5.1
  # wraps a native command's stderr lines in ErrorRecords, which under 'Stop'
  # kills the whole gate on the FIRST unreachable script instead of reporting it
  # and checking the rest. A pipeline we cannot reach is a finding, not a crash.
  Push-Location $work
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $pull = try { (& clasp pull 2>&1 | Out-String) } catch { "$_" } finally { $ErrorActionPreference = $prevEAP }
  Pop-Location
  $pulled = @(Get-ChildItem (Join-Path $work 'src') -File -ErrorAction SilentlyContinue).Count -gt 0

  if (-not $pulled) {
    Write-Output "CANNOT VERIFY  $($t.Name) -- clasp pull returned no files, so live state is unknown."
    Write-Output "    scriptId $scriptId"
    ($pull -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 2) | ForEach-Object { Write-Output "    $($_.Trim())" }
    Write-Output "    If this reads 'Requested entity was not found' the scriptId is wrong or access was revoked."
    $unverified++
    continue
  }

  # Index both sides by extension-insensitive name: clasp writes .js for what
  # the repo stores as .gs, which is not a difference worth reporting.
  $liveFiles = @{}
  Get-ChildItem (Join-Path $work 'src') -File | ForEach-Object {
    $liveFiles[[IO.Path]::GetFileNameWithoutExtension($_.Name) + ($(if ($_.Extension -eq '.json') { '.json' } else { '' }))] = $_.FullName
  }
  $repoFiles = @{}
  Get-ChildItem $srcDir -File | Where-Object { $_.Extension -in '.gs', '.js', '.json', '.html' } | ForEach-Object {
    $repoFiles[[IO.Path]::GetFileNameWithoutExtension($_.Name) + ($(if ($_.Extension -eq '.json') { '.json' } else { '' }))] = $_.FullName
  }

  $lines = @()
  foreach ($k in ($repoFiles.Keys + $liveFiles.Keys | Sort-Object -Unique)) {
    if (-not $liveFiles.ContainsKey($k)) { $lines += "  ONLY-REPO  $k  -- committed but never deployed"; $problems++; continue }
    if (-not $repoFiles.ContainsKey($k)) { $lines += "  ONLY-LIVE  $k  -- edited in the GAS editor; a push will delete it"; $problems++; continue }
    if ((& $norm $repoFiles[$k]).TrimEnd() -ne (& $norm $liveFiles[$k]).TrimEnd()) {
      $lines += "  DRIFT      $k  -- live differs from repo"
      $problems++
    } elseif (-not $Quiet) {
      $lines += "  OK         $k"
    }
  }

  $bad = ($lines | Where-Object { $_ -notmatch '  OK  ' }).Count
  if ($bad -gt 0 -or -not $Quiet) { Write-Output "`n$($t.Name)  [$scriptId]" ; $lines | ForEach-Object { Write-Output $_ } }
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Output ""
if ($problems -gt 0) {
  Write-Output "DEPLOY DRIFT: $problems file(s) differ between repo and live."
  Write-Output "The live pipelines are not running the code in this repo. Deploy with:"
  Write-Output "  cd pipelines/<name>; clasp push"
  Write-Output "Do NOT assume a commit means a pipeline changed."
  exit 1
}
if ($unverified -gt 0) { Write-Output "Checked what it could; $unverified pipeline(s) could not be verified."; exit 2 }
Write-Output "All deployed pipelines match the repo."
exit 0
