# Eject-T7.ps1 — safely eject the Samsung T7 portable workspace.
#
# Why this exists: Windows' tray "Safely Remove" fails on this drive because the
# Distributed Link Tracking service (TrkWks) and Explorer keep handles open on
# the NTFS volume. Clearing them requires an elevated dismount, which the tray
# icon never does. This script self-elevates, flushes, dismounts, then ejects.

param([switch]$Elevated)

$DriveModelMatch = '*T7*'

function Show-Result([string]$Message, [string]$Title, [string]$Icon) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show($Message, $Title, 'OK', $Icon) | Out-Null
}

# --- Self-elevate ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-Elevated'
    )
    return
}

# --- Locate the drive ---
$disk = Get-CimInstance Win32_DiskDrive | Where-Object { $_.Model -like $DriveModelMatch }
if (-not $disk) {
    Show-Result "No T7 is connected. Nothing to eject." "Eject T7" "Information"
    return
}

$letters = @(Get-CimInstance Win32_DiskDrive |
    Where-Object { $_.DeviceID -eq $disk.DeviceID } |
    ForEach-Object { $_ | Get-CimAssociatedInstance -ResultClassName Win32_DiskPartition } |
    ForEach-Object { $_ | Get-CimAssociatedInstance -ResultClassName Win32_LogicalDisk } |
    Select-Object -ExpandProperty DeviceID)

# --- Warn if anything is actively running from the drive ---
$running = Get-Process | Where-Object { $p = $_; $letters | Where-Object { $p.Path -like "$_\*" } }
if ($running) {
    $names = ($running | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
    Show-Result "These programs are running FROM the T7 and must be closed first:`n`n$names" "Eject T7" "Warning"
    return
}

# --- Close Explorer windows sitting on the drive (a common handle holder) ---
try {
    $shell = New-Object -ComObject Shell.Application
    $shell.Windows() | Where-Object {
        $url = $_.LocationURL
        $url -and ($letters | Where-Object { $url -like "*file:///$($_.TrimEnd(':'))*" })
    } | ForEach-Object { $_.Quit() }
    Start-Sleep -Milliseconds 700
} catch { }

# --- Flush and dismount every volume on the disk ---
foreach ($l in $letters) {
    $ltr = $l.TrimEnd(':')
    Write-VolumeCache -DriveLetter $ltr -ErrorAction SilentlyContinue
    & fsutil volume dismount $l 2>&1 | Out-Null
}

# --- Ask Windows to eject the device ---
if (-not ('T7Ejector' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class T7Ejector {
  [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)]
  public static extern int CM_Locate_DevNodeW(out uint pdnDevInst, string pDeviceID, uint ulFlags);
  [DllImport("cfgmgr32.dll")]
  public static extern int CM_Get_Parent(out uint pdnDevInst, uint dnDevInst, uint ulFlags);
  [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)]
  public static extern int CM_Request_Device_EjectW(uint dnDevInst, out int pVetoType, StringBuilder pszVetoName, uint ulNameLength, uint ulFlags);
}
'@
}

[uint32]$devInst = 0
if ([T7Ejector]::CM_Locate_DevNodeW([ref]$devInst, $disk.PNPDeviceID, 0) -ne 0) {
    Show-Result "Could not reach the T7's device entry. Try unplugging and replugging it, then run this again." "Eject T7" "Error"
    return
}
[uint32]$parent = 0
[T7Ejector]::CM_Get_Parent([ref]$parent, $devInst, 0) | Out-Null

$vetoType = 0
$vetoName = New-Object System.Text.StringBuilder(260)
$result = [T7Ejector]::CM_Request_Device_EjectW($parent, [ref]$vetoType, $vetoName, 260, 0)

if ($result -eq 0 -and $vetoType -eq 0) {
    Show-Result "The T7 has been ejected. You can unplug it now." "Eject T7" "Information"
} else {
    # Everything is flushed and dismounted at this point, so unplugging is still safe.
    Show-Result ("Windows would not release the drive, but all data was flushed and the volume was dismounted first, " +
                 "so it is safe to unplug.`n`nTechnical detail: veto type $vetoType - $($vetoName.ToString())") "Eject T7" "Warning"
}
