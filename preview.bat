@echo off
title Preview - Site Dra. Lais Caroline Hahmed
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado.
  echo   Sem problema: de dois cliques em index.html para abrir direto no navegador.
  echo.
  pause
  exit /b
)

start "" http://127.0.0.1:4173/
node preview-server.cjs
pause

