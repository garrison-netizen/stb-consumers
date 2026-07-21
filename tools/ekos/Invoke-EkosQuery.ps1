# Invoke-EkosQuery.ps1 - run a read-only SQL query against the Ekos "Craft Insights" EDW.
#
# Prereqs (see memory: reference-ekos-edw-access):
#   1. Azure VPN Client CONNECTED (profile: Documents\Ekos\Ekos-EDWaaS_azurevpnconfig.xml)
#   2. First run per ~hour pops a browser sign-in - use spindletap.bev@gmail.com
#      (NOT @spindletap.com - GoDaddy federation breaks Azure guest auth)
#   3. SqlServer PowerShell module installed CurrentUser (ships the MSAL DLL we borrow)
#
# Usage:  .\Invoke-EkosQuery.ps1 -Query "SELECT TOP 5 * FROM edw.FactBatch"

param(
    [Parameter(Mandatory = $true)][string]$Query,
    [int]$Timeout = 120
)

$ErrorActionPreference = 'Stop'

$server    = 'sql-ekos-rpt.database.windows.net'
$database  = 'SpindletapBrewery_rpt'
$tenantId  = '6a616d1f-8baa-475f-9e35-4ccaa6566210'   # Next Glass tenant
$clientId  = '04b07795-8ddb-461a-bbee-02f9e1bf7b46'   # Azure CLI public client id
$scopeUrl  = 'https://database.windows.net/.default'
$cacheFile = Join-Path $env:USERPROFILE 'Documents\Ekos\.ekos-token.clixml'  # DPAPI-protected, user+machine bound

function Get-EkosAccessToken {
    if (Test-Path $cacheFile) {
        try {
            $cached = Import-Clixml $cacheFile
            if ((Get-Date) -lt $cached.Expires.AddMinutes(-5)) {
                $ss = $cached.Token | ConvertTo-SecureString
                return ([System.Net.NetworkCredential]::new('', $ss)).Password
            }
        } catch { }  # unreadable/expired cache -> re-acquire
    }

    $mod = Get-Module SqlServer -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $mod) { throw "SqlServer module not found. Run: Install-Module SqlServer -Scope CurrentUser" }
    $dll = Get-ChildItem $mod.ModuleBase -Recurse -Filter 'Microsoft.Identity.Client.dll' |
        Where-Object { $_.FullName -notmatch 'coreclr' } | Select-Object -First 1
    if (-not $dll) { throw "Microsoft.Identity.Client.dll not found under $($mod.ModuleBase)" }
    Add-Type -Path $dll.FullName

    $app = [Microsoft.Identity.Client.PublicClientApplicationBuilder]::Create($clientId).
        WithAuthority("https://login.microsoftonline.com/$tenantId").
        WithRedirectUri('http://localhost').
        Build()
    Write-Host "Browser sign-in required - use spindletap.bev@gmail.com ..."
    $scopes = [string[]]@($scopeUrl)
    $result = $app.AcquireTokenInteractive($scopes).ExecuteAsync().GetAwaiter().GetResult()

    $enc = ConvertTo-SecureString $result.AccessToken -AsPlainText -Force | ConvertFrom-SecureString
    [pscustomobject]@{ Token = $enc; Expires = $result.ExpiresOn.LocalDateTime } | Export-Clixml $cacheFile
    return $result.AccessToken
}

$token = Get-EkosAccessToken

$conn = New-Object System.Data.SqlClient.SqlConnection
$conn.ConnectionString = "Server=tcp:$server,1433;Database=$database;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30"
$conn.AccessToken = $token
try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $Query
    $cmd.CommandTimeout = $Timeout
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)
    $table
} finally {
    $conn.Close()
}
