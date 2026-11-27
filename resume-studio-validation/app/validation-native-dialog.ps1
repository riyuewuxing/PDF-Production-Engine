param([Parameter(Mandatory=$true)][int]$OwnerPid,[Parameter(Mandatory=$true)][string]$Title64,[Parameter(Mandatory=$true)][string]$Button64,[string]$ButtonId='none')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$Title=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Title64))
$Button=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Button64))
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NativeDialog {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder text,int max);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  public class Win {public IntPtr Handle;public uint Pid;public uint OwnerPid;public string Name;public string Class;public int Id;public bool Visible;public bool Enabled;}
  static uint Pid(IntPtr h){uint p=0;if(h!=IntPtr.Zero)GetWindowThreadProcessId(h,out p);return p;}
  static Win Describe(IntPtr h){var b=new StringBuilder(2048);GetWindowText(h,b,b.Capacity);string n=b.ToString();b.Clear();GetClassName(h,b,b.Capacity);return new Win{Handle=h,Pid=Pid(h),OwnerPid=Pid(GetWindow(h,4)),Name=n,Class=b.ToString(),Id=GetDlgCtrlID(h),Visible=IsWindowVisible(h),Enabled=IsWindowEnabled(h)};}
  public static Win[] Windows(){var list=new List<Win>();EnumWindows((h,l)=>{list.Add(Describe(h));return true;},IntPtr.Zero);return list.ToArray();}
  public static Win[] Children(IntPtr h){var list=new List<Win>();EnumChildWindows(h,(c,l)=>{list.Add(Describe(c));return true;},IntPtr.Zero);return list.ToArray();}
  public static bool Click(IntPtr h){return PostMessage(h,0x00F5,IntPtr.Zero,IntPtr.Zero);}
}
'@
$AE=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]::Descendants
$buttonCondition=[System.Windows.Automation.PropertyCondition]::new($AE::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
$deadline=[DateTime]::UtcNow.AddSeconds(20)
do {
  $windows=[NativeDialog]::Windows()
  $target=@($windows|Where-Object {$_.Visible -and ($_.Pid -eq $OwnerPid -or $_.OwnerPid -eq $OwnerPid) -and $_.Name -eq $Title})
  if($target.Count -gt 1){throw 'Multiple matching native dialogs; refusing ambiguous selection'}
  if($target.Count -eq 1){
    $window=$target[0]
    $children=[NativeDialog]::Children($window.Handle)
    $buttons=@($children|Where-Object {$_.Visible -and $_.Enabled -and $_.Class -eq 'Button' -and ($_.Name.Replace('&','') -eq $Button -or ($ButtonId -ne 'none' -and $_.Id.ToString() -eq $ButtonId))})
    if($buttons.Count -eq 1){
      if(-not [NativeDialog]::Click($buttons[0].Handle)){throw 'Win32 button dispatch failed'}
      Write-Output ('Win32: '+$Title+' / '+$Button);exit 0
    }
    if($buttons.Count -gt 1){throw 'Multiple matching Win32 buttons; refusing ambiguous selection'}
    $element=$AE::FromHandle($window.Handle)
    $items=@($element.FindAll($scope,$buttonCondition)|Where-Object {$_.Current.IsEnabled -and ($_.Current.Name.Replace('&','') -eq $Button -or ($ButtonId -ne 'none' -and $_.Current.AutomationId -eq $ButtonId))})
    if($items.Count -eq 1){
      $pattern=$null
      if($items[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
        $pattern.Invoke();Write-Output ('UIA: '+$Title+' / '+$Button);exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 250
} while([DateTime]::UtcNow -lt $deadline)
$observed=@([NativeDialog]::Windows()|Where-Object {$_.Visible -and ($_.Pid -eq $OwnerPid -or $_.OwnerPid -eq $OwnerPid)}|ForEach-Object {
  [ordered]@{name=$_.Name;class=$_.Class;pid=$_.Pid;ownerPid=$_.OwnerPid;children=@([NativeDialog]::Children($_.Handle)|Where-Object {$_.Visible -and $_.Class -eq 'Button'}|ForEach-Object {[ordered]@{name=$_.Name;id=$_.Id}})}
})
Write-Output ($observed|ConvertTo-Json -Depth 5 -Compress)
throw ('Exact owned native dialog/button not found: '+$Title+' / '+$Button)
