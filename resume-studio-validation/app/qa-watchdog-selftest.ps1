# Windows native process/watchdog selftest, no project dependencies.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'qa-watched-process.ps1')
$root=Join-Path $env:RUNNER_TEMP ('qa watchdog spaces '+[guid]::NewGuid().ToString())
$log=Join-Path $env:GITHUB_WORKSPACE 't16-watchdog-evidence'
$null=New-Item -ItemType Directory -Path $root
$null=New-Item -ItemType Directory -Path $log
$node=(Get-Command node.exe -ErrorAction Stop).Source
$fixture=Join-Path $root 'fixture with spaces.cjs'
@'
const fs=require("node:fs"),cp=require("node:child_process");
const mode=process.argv[2],extra=process.argv[3];
if(mode==="ok"){if(extra!=="argument with spaces")process.exit(13);console.log("ok with spaces");process.exit(0)}
if(mode==="fail"){console.error("synthetic nonzero");process.exit(7)}
if(mode==="hang"){
 const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true});
 fs.writeFileSync("fixture-pids.json",JSON.stringify({parent:process.pid,child:child.pid}));
 console.log("parent and child started");setInterval(()=>{},1000);
}
'@ | Set-Content -LiteralPath $fixture -Encoding utf8
$rows=[System.Collections.Generic.List[object]]::new()
$passed=$false
try {
  $ok=Invoke-QaWatchedProcess -Name 'ok' -Exe $node -Arguments @(('"' + $fixture + '"'),'ok','"argument with spaces"') -WorkingDirectory $root -LogDirectory $log -Seconds 10
  $rows.Add($ok)
  if ($ok.exitCode -ne 0 -or $ok.timedOut -or $ok.error -or -not $ok.terminationConfirmed -or (Get-Content -LiteralPath (Join-Path $log $ok.stdout) -Raw) -notmatch 'ok with spaces') { throw 'success/quoting gate failed' }
  $fail=Invoke-QaWatchedProcess -Name 'nonzero' -Exe $node -Arguments @(('"' + $fixture + '"'),'fail') -WorkingDirectory $root -LogDirectory $log -Seconds 10
  $rows.Add($fail)
  if ($fail.exitCode -ne 7 -or $fail.timedOut -or $fail.error -or -not $fail.terminationConfirmed -or (Get-Content -LiteralPath (Join-Path $log $fail.stderr) -Raw) -notmatch 'synthetic nonzero') { throw 'nonzero exit gate failed' }
  $cmd=Invoke-QaWatchedProcess -Name 'cmd' -Exe $env:ComSpec -Arguments @('/d','/c','echo synthetic-cmd-okay') -WorkingDirectory $root -LogDirectory $log -Seconds 10
  $rows.Add($cmd)
  if ($cmd.exitCode -ne 0 -or $cmd.error -or $cmd.timedOut -or (Get-Content -LiteralPath (Join-Path $log $cmd.stdout) -Raw) -notmatch 'synthetic-cmd-okay') { throw 'cmd invocation gate failed' }
  $hung=Invoke-QaWatchedProcess -Name 'timeout' -Exe $node -Arguments @(('"' + $fixture + '"'),'hang') -WorkingDirectory $root -LogDirectory $log -Seconds 4
  $rows.Add($hung)
  $pids=Get-Content -LiteralPath (Join-Path $root 'fixture-pids.json') -Raw | ConvertFrom-Json
  if ($pids.parent -ne $hung.pid -or -not $hung.timedOut -or -not $hung.terminationConfirmed -or $hung.killExitCode -ne 0 -or $hung.error -or $hung.durationMs -gt 30000) { throw 'timeout termination gate failed' }
  $end=[DateTime]::UtcNow.AddSeconds(3)
  do {
    $remaining=@(Get-Process -Id @($pids.parent,$pids.child) -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $end)
  if ($remaining.Count -ne 0) { throw 'test process descendants remain' }
  $passed=$true
} finally {
  @{complete=$passed;sourceSha=$env:GITHUB_SHA;platform=$env:OS;cases=@($rows.ToArray());parentAndChildGone=$passed} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $log 'watchdog-selftest.json') -Encoding utf8
  # Preserve an unconfirmed synthetic fixture for the failed job's diagnosis.
  if ($passed) { Remove-Item -LiteralPath $root -Recurse -Force }
}
