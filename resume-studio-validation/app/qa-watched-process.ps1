# Generic QA subprocess runner. No project data, secrets or global process kills.
function Invoke-QaWatchedProcess {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Exe,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [Parameter(Mandatory=$true)][string]$LogDirectory,
    [Parameter(Mandatory=$true)][ValidateRange(1,3600)][int]$Seconds
  )
  if ($Name -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid task log name' }
  $stdout=Join-Path $LogDirectory ($Name+'.stdout.log')
  $stderr=Join-Path $LogDirectory ($Name+'.stderr.log')
  if ((Test-Path -LiteralPath $stdout) -or (Test-Path -LiteralPath $stderr)) { throw 'Refusing to overwrite task logs' }
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $process=$null
  $killer=$null
  $row=[ordered]@{name=$Name;pid=$null;timeoutSeconds=$Seconds;durationMs=$null;exitCode=$null;timedOut=$false;terminationConfirmed=$false;killExitCode=$null;error=$null;stdout=[IO.Path]::GetFileName($stdout);stderr=[IO.Path]::GetFileName($stderr)}
  try {
    $process=Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -ErrorAction Stop
    $row.pid=$process.Id
    if ($process.WaitForExit($Seconds*1000)) {
      $process.Refresh()
      $row.exitCode=$process.ExitCode
      $row.terminationConfirmed=$true
    } else {
      $row.timedOut=$true
      # The cleanup operation has its own bound. Never kill by name or touch
      # processes not descended from this invocation's original PID.
      $killer=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/taskkill.exe') -ArgumentList @('/PID',[string]$process.Id,'/T','/F') -RedirectStandardOutput (Join-Path $LogDirectory ($Name+'.kill.stdout.log')) -RedirectStandardError (Join-Path $LogDirectory ($Name+'.kill.stderr.log')) -PassThru -ErrorAction Stop
      if ($killer.WaitForExit(10000)) {
        $killer.Refresh();$row.killExitCode=$killer.ExitCode
      } else {
        $killer.Kill()
        $null=$killer.WaitForExit(3000)
        $row.error='taskkill watchdog exceeded'
      }
      $rootExited=$process.WaitForExit(10000)
      if ($rootExited) { $process.Refresh();$row.exitCode=$process.ExitCode }
      $row.terminationConfirmed=$rootExited -and $row.killExitCode -eq 0
      if (-not $row.terminationConfirmed -and -not $row.error) { $row.error='Process-tree termination not confirmed; retain fixture' }
    }
  } catch {
    $row.error=$_.Exception.Message
    # A start failure has no child. Otherwise keep the state conservative:
    # do not report confirmed termination after an unverified exception.
    if ($null -eq $process) { $row.terminationConfirmed=$true }
  } finally {
    $watch.Stop();$row.durationMs=$watch.ElapsedMilliseconds
    if ($null -ne $killer) { $killer.Dispose() }
    if ($null -ne $process) { $process.Dispose() }
  }
  return [pscustomobject]$row
}
