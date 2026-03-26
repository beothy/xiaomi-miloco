# Start the PoC backend and frontend.
# Run from anywhere: .\poc-xiaomi-camera-integration\start.ps1
# Or from inside the poc directory: .\start.ps1

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = "$repoRoot\.venv\bin\python"
$backendDir = "$PSScriptRoot\backend"
$frontendDir = "$PSScriptRoot\frontend"

# Convert Windows paths to WSL paths
function ToWslPath($winPath) {
    $drive = $winPath[0].ToString().ToLower()
    $rest  = $winPath.Substring(2).Replace('\', '/')
    return "/mnt/$drive$rest"
}

$wslBackendDir  = ToWslPath $backendDir
$wslFrontendDir = ToWslPath $frontendDir
$wslPython      = ToWslPath $venvPython

Write-Host "Starting PoC backend  -> http://localhost:8080"
Write-Host "Starting PoC frontend -> http://localhost:5173"
Write-Host ""

# Free port 8080 if something is already holding it
wsl -d Ubuntu -- bash -c "fuser -k 8080/tcp 2>/dev/null; true"

# Helper: launch a command in a new PowerShell window using base64-encoded command
# to avoid all quoting/escaping issues.
function StartInNewWindow($title, $command) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process powershell -ArgumentList "-NoExit", "-EncodedCommand", $encoded
}

# Start backend in a new PowerShell window
StartInNewWindow "PoC Backend" "wsl -d Ubuntu -- bash -c `"cd $wslBackendDir ; $wslPython main.py`""

# Give the backend a moment to bind the port
Start-Sleep -Seconds 2

# Start frontend in a new PowerShell window
StartInNewWindow "PoC Frontend" "wsl -d Ubuntu -- bash -c `"cd $wslFrontendDir ; npm run dev`""

Write-Host "Both services launched in separate windows."
Write-Host "Backend:  http://localhost:8080"
Write-Host "Frontend: http://localhost:5173"
