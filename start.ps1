$ErrorActionPreference = 'Stop'
$taskBackend = Join-Path $PSScriptRoot 'admin_backend'
$taskPython = Join-Path $taskBackend '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw '请先按照 README.md 安装管理后台依赖。'
}
Set-Location -LiteralPath $taskBackend
& $taskPython -m uvicorn main:app --host 127.0.0.1 --port 8765 --workers 1
