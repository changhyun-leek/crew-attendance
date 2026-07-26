@echo off
setlocal
cd /d "%~dp0"

if /I "%~1"=="--check" (
  echo ATTENDANCE_LAUNCHER_OK
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Installation failed.
    pause
    exit /b 1
  )
)

start "Attendance Dev Server" /min npm.cmd run dev -- --host 127.0.0.1
powershell -NoProfile -Command "$limit=(Get-Date).AddSeconds(20); while((Get-Date)-lt $limit){try{$r=Invoke-WebRequest 'http://127.0.0.1:5173/crew-attendance/?demo=1' -UseBasicParsing -TimeoutSec 1;if($r.StatusCode -eq 200){exit 0}}catch{};Start-Sleep -Milliseconds 400};exit 1"
if errorlevel 1 (
  echo The preview server did not start. Check the minimized server window.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:5173/crew-attendance/?demo=1"
exit /b 0
