@echo off
rem Wings setup (double-click): the engine, the back end, the launcher and the interface. See setup.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
