# Ephemeral public Windows runner only. Enumerate real modes, test before changing, restore.
param([ValidateSet('prepare','restore')][string]$Phase='prepare',[Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RunnerDisplay {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct DEVMODE {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
  public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
  public int dmFields;
  public int dmPositionX,dmPositionY,dmDisplayOrientation,dmDisplayFixedOutput;
  public short dmColor,dmDuplex,dmYResolution,dmTTOption,dmCollate;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
  public short dmLogPixels;
  public int dmBitsPerPel,dmPelsWidth,dmPelsHeight,dmDisplayFlags,dmDisplayFrequency,dmICMMethod,dmICMIntent,dmMediaType,dmDitherType,dmReserved1,dmReserved2,dmPanningWidth,dmPanningHeight;
 }
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool EnumDisplaySettings(string device,int mode,ref DEVMODE dm);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int ChangeDisplaySettings(ref DEVMODE dm,int flags);
 public static DEVMODE Blank(){var d=new DEVMODE();d.dmSize=(short)Marshal.SizeOf(typeof(DEVMODE));return d;}
 public static DEVMODE Current(){var d=Blank();if(!EnumDisplaySettings(null,-1,ref d))throw new InvalidOperationException("current display unavailable");return d;}
 public static DEVMODE[] Modes(){var list=new System.Collections.Generic.List<DEVMODE>();for(int i=0;i<512;i++){var d=Blank();if(!EnumDisplaySettings(null,i,ref d))break;list.Add(d);}return list.ToArray();}
 public static int Test(DEVMODE d){return ChangeDisplaySettings(ref d,2);}
 public static int Apply(DEVMODE d){return ChangeDisplaySettings(ref d,0);}
}
'@
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
$state=Join-Path $Evidence 'display-mode.json'
function Row($m){[ordered]@{width=$m.dmPelsWidth;height=$m.dmPelsHeight;bits=$m.dmBitsPerPel;frequency=$m.dmDisplayFrequency;orientation=$m.dmDisplayOrientation}}
if($Phase -eq 'prepare'){
 $original=[RunnerDisplay]::Current()
 $modes=@([RunnerDisplay]::Modes())
 $report=[ordered]@{original=(Row $original);modes=@($modes | ForEach-Object { Row $_ });attempts=@();changed=$false}
 $candidates=@($modes | Where-Object {$_.dmPelsWidth -ge 1940 -and $_.dmPelsHeight -ge 1150 -and $_.dmBitsPerPel -eq $original.dmBitsPerPel} | Sort-Object @{Expression={$_.dmPelsWidth*$_.dmPelsHeight}},@{Expression={$_.dmDisplayFrequency};Descending=$true})
 foreach($m in $candidates){
  $test=[RunnerDisplay]::Test($m);$attempt=[ordered]@{mode=(Row $m);test=$test;apply=$null}
  if($test -eq 0){$attempt.apply=[RunnerDisplay]::Apply($m);if($attempt.apply -eq 0){$report.changed=$true;$report.attempts+= $attempt;break}}
  $report.attempts+= $attempt
 }
 Start-Sleep -Milliseconds 600
 $report.actual=Row ([RunnerDisplay]::Current())
 $report.sufficientForLargeViewport=($report.actual.width -ge 1940 -and $report.actual.height -ge 1150)
 $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $state
 Write-Output ($report | ConvertTo-Json -Depth 8)
}else{
 if(!(Test-Path $state)){throw 'missing preparation record'}
 $report=Get-Content -Raw $state | ConvertFrom-Json
 $modes=@([RunnerDisplay]::Modes())
 $original=@($modes | Where-Object {$_.dmPelsWidth -eq $report.original.width -and $_.dmPelsHeight -eq $report.original.height -and $_.dmBitsPerPel -eq $report.original.bits -and $_.dmDisplayFrequency -eq $report.original.frequency})
 $restore=$null
 if($report.changed){if($original.Count -eq 0){throw 'original mode not enumerated'};$restore=[RunnerDisplay]::Apply($original[0]);if($restore -ne 0){throw "restore failed $restore"}}
 [ordered]@{restoreCode=$restore;actual=(Row ([RunnerDisplay]::Current()))} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $Evidence 'display-restore.json')
}
