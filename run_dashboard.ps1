# Starts EcoBrief using whichever Python 3 is installed (no hard-coded paths).
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$python = $null
foreach ($candidate in @("py", "python", "python3")) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) { $python = $command.Source; break }
}
if (-not $python) {
    Write-Error "Python 3.9+ was not found. Install it from https://www.python.org/downloads/ and tick 'Add python.exe to PATH'."
    exit 1
}

& $python src\app.py 8765
