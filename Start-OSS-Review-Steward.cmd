@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 20.11 or newer and try again.
  pause
  exit /b 1
)
echo OSS Review Steward is starting at http://127.0.0.1:4173
echo Keep this window open. Press Ctrl+C to stop OSS Review Steward.
start "" http://127.0.0.1:4173
node server.mjs
pause
