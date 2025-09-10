@echo off
echo Starting Chrome with CORS disabled for development...
echo.
echo WARNING: This Chrome instance has security features disabled!
echo Only use for local development with trusted content.
echo.
echo Starting in 3 seconds...
timeout /t 3 /nobreak >nul

REM Create temp directory if it doesn't exist
if not exist "C:\temp\chrome_dev" mkdir "C:\temp\chrome_dev"

REM Start Chrome with security disabled
start "Chrome Dev" "C:\Program Files\Google\Chrome\Application\chrome.exe" --disable-web-security --disable-features=VizDisplayCompositor --user-data-dir="C:\temp\chrome_dev" --allow-running-insecure-content --disable-site-isolation-trials "http://localhost:3000"

echo Chrome started with CORS disabled!
echo Browser window should open shortly...
pause
