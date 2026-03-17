@echo off
echo Killing stale Electron and Vite processes...
taskkill /F /IM electron.exe 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173.*LISTENING"') do taskkill /F /PID %%p 2>nul
timeout /t 1 /nobreak >nul

echo Starting Vite dev server...
cd /d "%~dp0"
start "BoilerDeck Vite" cmd /c "npm run dev:client"

echo Waiting for Vite to be ready...
:wait
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":5173.*LISTENING" >nul 2>&1
if errorlevel 1 goto wait

echo Starting Electron...
cd client
start "BoilerDeck Electron" cmd /c "..\node_modules\.bin\electron ."
