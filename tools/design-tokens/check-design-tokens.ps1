<#
  check-design-tokens.ps1 — STB design-token drift gate

  WHY THIS EXISTS
  The apps cannot import the canonical stylesheet: each is its own repo, built
  independently by Vercel from its own checkout, so stb-consumers is not on the
  build machine. They therefore carry VENDORED copies of the token block, and a
  vendored copy drifts. On 2026-07-31 it drifted twice in one day — the Master
  Calendar introduced a whole coffee palette the canonical file did not know
  about, and --muted sat below the contrast floor in two live apps for weeks.

  This script is the mechanical guard against both, and it deliberately does NOT
  rewrite anything. Blind-copying a token block into a live app can delete a
  variable that app's rules still reference, which fails silently at runtime as
  an unstyled element. Reporting drift is safe; auto-fixing it is not. A human
  decides which side is right — sometimes the app is (that is how coffee got
  adopted).

  WHAT IT REPORTS
    DRIFT    token in both, values differ        -> one of them is wrong
    UNKNOWN  token in an app, absent canonical   -> new palette work to adopt
    OK       values agree

  Exit code 0 = clean, 1 = drift or unknowns found. Safe to gate on.

  USAGE
    pwsh check-design-tokens.ps1            # report
    pwsh check-design-tokens.ps1 -Quiet     # only problems + exit code
#>

param([switch]$Quiet)

$ErrorActionPreference = 'Stop'

$REPO = if ($env:STB_REPOS) { $env:STB_REPOS } else { $env:USERPROFILE }
$canonicalPath = Join-Path $REPO 'stb-consumers\design-system\stb-tokens.css'

# Apps carrying a vendored CSS-variable copy.
$targets = @(
  @{ Name = 'stb-master-calendar'; Path = 'stb-master-calendar\src\styles.css' },
  @{ Name = 'stb-exec-console';    Path = 'stb-exec-console\src\styles.css' }
)

# Surfaces this script CANNOT check, named out loud so they are not mistaken
# for passing. Silence here would read as coverage.
$unchecked = @(
  'stb-private-event-calculator — palette lives in an inline Tailwind config (src/calculator.html), not CSS variables',
  'public/*.html notices — inline :root blocks, checked by eye at 2026-07-31'
)

function Get-Tokens([string]$file) {
  $map = @{}
  if (-not (Test-Path $file)) { return $null }
  $text = [System.IO.File]::ReadAllText($file)
  # strip comments so a hex quoted inside prose is never read as a value
  $text = [regex]::Replace($text, '/\*.*?\*/', '', 'Singleline')
  $m = [regex]::Match($text, ':root\s*\{(.*?)\}', 'Singleline')
  if (-not $m.Success) { return $map }
  foreach ($d in [regex]::Matches($m.Groups[1].Value, '(--[a-z0-9-]+)\s*:\s*([^;]+);')) {
    $map[$d.Groups[1].Value.Trim()] = ($d.Groups[2].Value.Trim() -replace '\s+', ' ')
  }
  return $map
}

if (-not (Test-Path $canonicalPath)) {
  Write-Output "FAIL  canonical token file not found: $canonicalPath"
  exit 1
}

$canon = Get-Tokens $canonicalPath
if (-not $Quiet) { Write-Output "Canonical: $($canon.Count) tokens  ($canonicalPath)`n" }

# Colors/fonts only — radii and shadows are treatment-level, not brand truth.
$brandish = { param($k) $k -match '^--(navy|brass|coffee|cream|white|ink|muted|line|ok|warn|bad|mark|font)' }

$problems = 0

foreach ($t in $targets) {
  $full = Join-Path $REPO $t.Path
  $app = Get-Tokens $full
  if ($null -eq $app) { Write-Output "SKIP  $($t.Name) — not present at $full"; continue }

  $drift = @(); $unknown = @(); $agree = 0

  foreach ($k in ($app.Keys | Where-Object { & $brandish $_ } | Sort-Object)) {
    if ($canon.ContainsKey($k)) {
      if ($canon[$k] -ieq $app[$k]) { $agree++ }
      else { $drift += "    DRIFT    $k`n               app       $($app[$k])`n               canonical $($canon[$k])" }
    }
    else { $unknown += "    UNKNOWN  $k = $($app[$k])   (in app, absent from canonical — adopt or remove)" }
  }

  $problems += $drift.Count + $unknown.Count

  if ($drift.Count -or $unknown.Count) {
    Write-Output "$($t.Name):  $agree agree, $($drift.Count) drift, $($unknown.Count) unknown"
    $drift   | ForEach-Object { Write-Output $_ }
    $unknown | ForEach-Object { Write-Output $_ }
    Write-Output ""
  }
  elseif (-not $Quiet) {
    Write-Output "$($t.Name):  OK — $agree brand tokens agree with canonical`n"
  }
}

if (-not $Quiet) {
  Write-Output "Not checked by this script (verify by hand):"
  $unchecked | ForEach-Object { Write-Output "  - $_" }
  Write-Output ""
}

if ($problems -gt 0) {
  Write-Output "DRIFT DETECTED — $problems item(s). Reconcile before shipping brand work."
  Write-Output "Decide which side is right: update the app to match canonical, OR adopt the"
  Write-Output "app's value into stb-tokens.css if the app is the one that got it right."
  exit 1
}

if (-not $Quiet) { Write-Output "Design tokens clean." }
exit 0
