param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
$baseline=(Resolve-Path 'validation-fixtures/postpack-win.baseline.mjs').Path
$candidate=(Resolve-Path 'scripts/postpack-win.mjs').Path
$manifest=Get-Content runner-manifest.json -Raw | ConvertFrom-Json
$root=Join-Path $env:RUNNER_TEMP ('postpack-'+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $root,$EvidenceDir -Force | Out-Null
$checks=[ordered]@{}
$observations=[ordered]@{}
function Assert([bool]$Condition,[string]$Message){if(!$Condition){throw $Message}}
function Fixture([string]$Name){
  $dir=Join-Path $root $Name
  New-Item -ItemType Directory -Path (Join-Path $dir 'release'),(Join-Path $dir 'release/user-evidence') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $dir 'Resume Studio.exe'),'OLD_SYNTHETIC_EXE')
  [IO.File]::WriteAllText((Join-Path $dir 'release/Resume Studio.exe'),'NEW_SYNTHETIC_EXE')
  [IO.File]::WriteAllText((Join-Path $dir 'release/user-evidence/keep.txt'),'PRESERVE_EVIDENCE')
  [IO.File]::WriteAllText((Join-Path $dir 'Resume Studio（极速启动）.lnk'),'PRESERVE_SHORTCUT')
  return $dir
}
function InvokeScript([string]$Dir,[string]$Script){
  Push-Location $Dir
  try {
    # Intentionally failing child processes must not abort the evidence script.
    $PSNativeCommandUseErrorActionPreference=$false
    & node $Script *> (Join-Path $Dir 'process.log')
    return $LASTEXITCODE
  } finally {Pop-Location}
}
function Old([string]$d){return (Join-Path $d 'Resume Studio.exe')}
function New([string]$d){return (Join-Path $d 'release/Resume Studio.exe')}
function Keep([string]$d){
  return (([IO.File]::ReadAllText((Join-Path $d 'release/user-evidence/keep.txt')) -eq 'PRESERVE_EVIDENCE') -and ([IO.File]::ReadAllText((Join-Path $d 'Resume Studio（极速启动）.lnk')) -eq 'PRESERVE_SHORTCUT'))
}
function Report($ErrorText){
  [ordered]@{sourceSha=$manifest.sourceSha;runnerSha=$env:GITHUB_SHA;platform='win32';checks=$checks;observations=$observations;error=$ErrorText} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $EvidenceDir 'postpack-evidence.json')
}
try{
  $d=Fixture 'baseline-locked-source'
  $lock=[IO.File]::Open((New $d),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try{$exit=InvokeScript $d $baseline}finally{$lock.Dispose()}
  $observations.baselineLockedSource=[ordered]@{exitCode=$exit;oldExists=(Test-Path -LiteralPath (Old $d));newExists=(Test-Path -LiteralPath (New $d))}
  Assert ($exit -ne 0) 'Baseline locked source should fail'
  Assert (!(Test-Path -LiteralPath (Old $d))) 'Expected baseline to reproduce pre-delete of old executable'
  Assert (([IO.File]::ReadAllText((New $d))) -eq 'NEW_SYNTHETIC_EXE') 'Unexpected baseline new file change'
  $checks.baselineLockedSourceReproducedOldLoss=$true

  foreach($case in @('locked-source','locked-destination')){
    $d=Fixture $case
    $target=if($case -eq 'locked-source'){New $d}else{Old $d}
    $lock=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try{$exit=InvokeScript $d $candidate}finally{$lock.Dispose()}
    Assert ($exit -ne 0) ('Expected locked replacement failure: '+$case)
    Assert (([IO.File]::ReadAllText((Old $d))) -eq 'OLD_SYNTHETIC_EXE') 'Old launcher changed on failure'
    Assert (([IO.File]::ReadAllText((New $d))) -eq 'NEW_SYNTHETIC_EXE') 'New artifact changed on failure'
    Assert (Keep $d) 'Unrelated files changed'
    $checks[$case]=$true
  }
  foreach($case in @('missing','empty')){
    $d=Fixture $case
    if($case -eq 'missing'){Remove-Item -LiteralPath (New $d)}else{[IO.File]::WriteAllBytes((New $d),[byte[]]@())}
    $exit=InvokeScript $d $candidate
    Assert ($exit -ne 0) 'Invalid source accepted'
    Assert (([IO.File]::ReadAllText((Old $d))) -eq 'OLD_SYNTHETIC_EXE') 'Old launcher changed'
    Assert (Keep $d) 'Unrelated files changed'
    $checks[$case]=$true
  }
  $d=Fixture 'directory-destination'
  Remove-Item -LiteralPath (Old $d)
  New-Item -ItemType Directory -Path (Old $d) | Out-Null
  [IO.File]::WriteAllText((Join-Path (Old $d) 'keep.txt'),'KEEP_DIRECTORY')
  $exit=InvokeScript $d $candidate
  Assert ($exit -ne 0) 'Directory destination accepted'
  Assert (([IO.File]::ReadAllText((Join-Path (Old $d) 'keep.txt'))) -eq 'KEEP_DIRECTORY') 'Directory modified'
  Assert (([IO.File]::ReadAllText((New $d))) -eq 'NEW_SYNTHETIC_EXE') 'Artifact modified'
  $checks.directoryDestinationRejected=$true
  $d=Fixture 'successful-replace'
  $exit=InvokeScript $d $candidate
  Assert ($exit -eq 0) 'Normal replacement failed'
  Assert (([IO.File]::ReadAllText((Old $d))) -eq 'NEW_SYNTHETIC_EXE') 'Replacement bytes incorrect'
  Assert (!(Test-Path -LiteralPath (New $d))) 'Source not consumed'
  Assert (Keep $d) 'Unrelated release and shortcut must remain'
  $checks.normalReplacementPreservesOtherFiles=$true
  $d=Fixture 'first-install'
  Remove-Item -LiteralPath (Old $d)
  $exit=InvokeScript $d $candidate
  Assert ($exit -eq 0) 'First install failed'
  Assert (([IO.File]::ReadAllText((Old $d))) -eq 'NEW_SYNTHETIC_EXE') 'First install bytes incorrect'
  Assert (Keep $d) 'Unrelated release and shortcut must remain'
  $checks.firstInstall=$true
  Report $null
}catch{Report $_.Exception.Message;throw}finally{Remove-Item -LiteralPath $root -Recurse -Force}
