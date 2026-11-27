param([Parameter(Mandatory=$true)][int]$OwnerPid,[Parameter(Mandatory=$true)][string]$Title,[Parameter(Mandatory=$true)][string]$Button,[string]$ButtonId='none')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE=[System.Windows.Automation.AutomationElement]
$root=$AE::RootElement
$scope=[System.Windows.Automation.TreeScope]::Descendants
$byPid=[System.Windows.Automation.PropertyCondition]::new($AE::ProcessIdProperty,$OwnerPid)
$byName=[System.Windows.Automation.PropertyCondition]::new($AE::NameProperty,$Title)
$byType=[System.Windows.Automation.PropertyCondition]::new($AE::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)
$cond=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@($byPid,$byName,$byType))
$deadline=[DateTime]::UtcNow.AddSeconds(18)
do {
  $window=$root.FindFirst($scope,$cond)
  if($null -ne $window) {
    $buttons=$window.FindAll($scope,[System.Windows.Automation.PropertyCondition]::new($AE::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button))
    foreach($b in $buttons) {
      if($b.Current.IsEnabled -and ($b.Current.Name -eq $Button -or ($ButtonId -ne 'none' -and $b.Current.AutomationId -eq $ButtonId))) {
        $pattern=$null
        if($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
          $pattern.Invoke()
          Write-Output ('Invoked: '+$Title+' / '+$Button)
          exit 0
        }
      }
    }
  }
  Start-Sleep -Milliseconds 250
} while([DateTime]::UtcNow -lt $deadline)
$names=@($root.FindAll([System.Windows.Automation.TreeScope]::Children,$byPid)|ForEach-Object {$_.Current.Name})
throw ('Native dialog/button not found: '+$Title+' / '+$Button+'; process windows: '+($names -join ' | '))
