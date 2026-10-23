@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "Ciudad Abierta 3D" cmd /k "cd /d "%~dp0" && py -m http.server 8000"
  timeout /t 2 /nobreak >nul
  start "" "http://localhost:8000"
  exit /b
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "Ciudad Abierta 3D" cmd /k "cd /d "%~dp0" && python -m http.server 8000"
  timeout /t 2 /nobreak >nul
  start "" "http://localhost:8000"
  exit /b
)
echo No se encontro Python instalado.
echo Instala Python desde https://www.python.org/downloads/ y marca "Add Python to PATH" durante la instalacion.
echo Despues vuelve a ejecutar INICIAR_JUEGO.bat.
pause
