# Get-EkosToken.ps1 - print a valid Ekos EDW access token to stdout (nothing else).
# Uses the same DPAPI cache as Invoke-EkosQuery.ps1; pops a browser sign-in if expired.
# Used by sync-mirror.js to authenticate its SQL connection.

$ErrorActionPreference = 'Stop'

$tenantId  = '6a616d1f-8baa-475f-9e35-4ccaa6566210'
$clientId  = '04b07795-8ddb-461a-bbee-02f9e1bf7b46'
$scopeUrl  = 'https://database.windows.net/.default'
$cacheFile = Join-Path $env:USERPROFILE 'Documents\Ekos\.ekos-token.clixml'

if (Test-Path $cacheFile) {
    try {
        $cached = Import-Clixml $cacheFile
        if ((Get-Date) -lt $cached.Expires.AddMinutes(-5)) {
            $ss = $cached.Token | ConvertTo-SecureString
            Write-Output ([System.Net.NetworkCredential]::new('', $ss)).Password
            exit 0
        }
    } catch { }
}

$mod = Get-Module SqlServer -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
if (-not $mod) { throw "SqlServer module not found. Run: Install-Module SqlServer -Scope CurrentUser" }
$dll = Get-ChildItem $mod.ModuleBase -Recurse -Filter 'Microsoft.Identity.Client.dll' |
    Where-Object { $_.FullName -notmatch 'coreclr' } | Select-Object -First 1
Add-Type -Path $dll.FullName

$app = [Microsoft.Identity.Client.PublicClientApplicationBuilder]::Create($clientId).
    WithAuthority("https://login.microsoftonline.com/$tenantId").
    WithRedirectUri('http://localhost').
    Build()
Write-Host "Browser sign-in required - use spindletap.bev@gmail.com ..." -ForegroundColor Yellow
$scopes = [string[]]@($scopeUrl)
$result = $app.AcquireTokenInteractive($scopes).ExecuteAsync().GetAwaiter().GetResult()

$enc = ConvertTo-SecureString $result.AccessToken -AsPlainText -Force | ConvertFrom-SecureString
[pscustomobject]@{ Token = $enc; Expires = $result.ExpiresOn.LocalDateTime } | Export-Clixml $cacheFile
Write-Output $result.AccessToken
