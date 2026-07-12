@echo off
title ERPSOFT - Grossiste Livres
cd /d "%~dp0"

echo ============================================
echo   ERPSOFT - ERP Grossiste Livres
echo ============================================
echo.

rem --- Verification de Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe sur ce PC.
  echo.
  echo Telechargez la version LTS ici : https://nodejs.org/fr
  echo Installez-la puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

for /f "delims=v. tokens=1" %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 22 (
  echo [ERREUR] Votre version de Node.js est trop ancienne :
  node -v
  echo Il faut Node.js 22.5 ou plus recent : https://nodejs.org/fr
  echo.
  pause
  exit /b 1
)

echo Node.js detecte :
node -v
echo.
echo Demarrage du serveur...
echo   Back-office        : http://localhost:3000   (admin / admin)
echo   Portail libraires  : http://localhost:3000/portal   (librairie / livre)
echo.
echo Laissez cette fenetre OUVERTE. Fermez-la (ou Ctrl+C) pour arreter le serveur.
echo.

rem --- Ouvre le navigateur apres 2 secondes, en parallele du serveur ---
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

node server.js
if errorlevel 1 (
  echo.
  echo [ERREUR] Le serveur s'est arrete avec une erreur.
  echo Si le message indique "EADDRINUSE", le port 3000 est deja utilise :
  echo fermez l'autre fenetre ERPSOFT deja ouverte, puis relancez.
  echo.
  pause
)
