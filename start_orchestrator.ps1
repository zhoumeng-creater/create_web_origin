param(
  [int]$Port = 8000,
  [string]$RuntimeDir = "runtime",
  [switch]$NoReload
)

Set-Location $PSScriptRoot

$env:DIFFUSION360_DISABLE_XFORMERS = "0"
$env:ORCH_RUNTIME_DIR = $RuntimeDir
$env:DIFFUSION360_PYTHON = "/home/zhou/miniconda3/envs/360PanoImage/bin/python"
$env:ANIMATIONGPT_PYTHON = "/home/zhou/miniconda3/envs/mgpt/bin/python"
$env:PYTHON_MP4_EXE = $env:ANIMATIONGPT_PYTHON
$env:FFMPEG_BIN = "D:\ffmpeg-2025-12-22-git-c50e5c7778-essentials_build\bin\ffmpeg.exe"
$env:NUMPY_EXPERIMENTAL_DTYPE_API = "1"
if (-not $env:WSL_DISTRO) {
  $env:WSL_DISTRO = "Ubuntu"
}

$orchestratorPython = "E:\Anaconda\envs\animind\python.exe"

function Test-PathHint {
  param(
    [string]$Name,
    [string]$PathValue
  )
  if (-not $PathValue) {
    Write-Warning "$Name is not set."
    return
  }
  if ($PathValue -match '^/' -or $PathValue -match '^\\\\wsl\.localhost\\' -or $PathValue -match '^\\\\wsl\\$\\') {
    Write-Host "$Name uses a WSL path. Ensure the $env:WSL_DISTRO distro is installed."
    return
  }
  if (-not (Test-Path $PathValue)) {
    Write-Warning "$Name path not found: $PathValue"
  }
}

Test-PathHint -Name "DIFFUSION360_PYTHON" -PathValue $env:DIFFUSION360_PYTHON
Test-PathHint -Name "ANIMATIONGPT_PYTHON" -PathValue $env:ANIMATIONGPT_PYTHON
Test-PathHint -Name "PYTHON_MP4_EXE" -PathValue $env:PYTHON_MP4_EXE
Test-PathHint -Name "FFMPEG_BIN" -PathValue $env:FFMPEG_BIN

if (-not (Test-Path $orchestratorPython)) {
  Write-Error "Orchestrator python not found: $orchestratorPython"
  exit 1
}

$reloadFlag = @()
if (-not $NoReload) {
  $reloadFlag = @("--reload")
}

Write-Host "Starting Orchestrator on http://127.0.0.1:$Port"
& $orchestratorPython -m uvicorn services.orchestrator.src.main:app --port $Port @reloadFlag
