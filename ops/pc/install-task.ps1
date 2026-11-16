# Installs « Démarrer Impera » at the logon of the current Windows account (ADR 0125 § 1 and § 7), without
# administrator rights: a scheduled task for this account alone, run only while it is logged on, with the rights of a
# standard user. Where Windows refuses the task to a standard account, a shortcut in its Startup folder does the same.
# Windows PowerShell 5.1. Run again at will: the task is replaced, never doubled.
$ErrorActionPreference = 'Stop'

$taskName = 'Démarrer Impera'
$launcher = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*marrer Impera.cmd' | Select-Object -First 1
if ($null -eq $launcher) { throw "« Démarrer Impera.cmd » introuvable dans $PSScriptRoot" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

try {
    # cmd /c ""…"": the path has spaces, cmd.exe strips the outer pair of quotes.
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$($launcher.FullName)`"`"" -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
    # Docker Desktop starts at the same logon: half a minute for it; the program then waits up to 3 minutes more.
    $trigger.Delay = 'PT30S'
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal `
        -Settings $settings -Description 'Met Impera à jour puis démarre le CRM (ops/pc/README.md).' -Force | Out-Null
    Write-Host "Tâche « $taskName » installée : Impera démarrera à chaque ouverture de session de $me."
}
catch {
    Write-Host "Windows refuse la tâche planifiée ($($_.Exception.Message)) : raccourci de démarrage à la place."
    $startup = [Environment]::GetFolderPath('Startup')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $startup "$taskName.lnk"))
    $shortcut.TargetPath = $launcher.FullName
    $shortcut.WorkingDirectory = $repo
    $shortcut.Save()
    Write-Host "Raccourci posé dans le dossier Démarrage : Impera démarrera à chaque ouverture de session."
}
