@echo off
rem IHOP Operations Dashboard launcher for Windows. Double-click to start; close the window to stop.
cd /d "%~dp0server"
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again. & start https://nodejs.org & pause & exit /b 1)
for /f %%v in ('node -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a>22||(a===22&&b>=9)?'yes':'no')"') do set NODE_OK=%%v
if not "%NODE_OK%"=="yes" (echo Node.js is too old. Version 22.9 or newer is needed: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo First run: installing components, needs internet... & call npm install --omit=dev || (pause & exit /b 1))
if not exist .env copy .env.example .env >nul
echo Starting the dashboard at http://localhost:4000  (leave this window open)
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:4000"
node --experimental-sqlite --env-file-if-exists=.env src/index.js
pause
