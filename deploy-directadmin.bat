@echo off
title PojokAI - Bundle for DirectAdmin
echo ===================================================
echo   POJOKAI - BUILD & PACKAGE FOR DIRECTADMIN
echo ===================================================
echo.
echo [1/2] Menjalankan build katalog static...
node build.mjs --directadmin

echo.
echo [2/2] Mengompresi file ke pojokai-directadmin-ready.zip...
powershell -NoProfile -Command "if (Test-Path 'pojokai-directadmin-ready.zip') { Remove-Item 'pojokai-directadmin-ready.zip' -Force }; Compress-Archive -Path 'index.html', '.htaccess', 'assets', 'api', 'data' -DestinationPath 'pojokai-directadmin-ready.zip' -CompressionLevel Optimal"

echo.
echo ===================================================
echo   SELESAI!
echo   File siap upload: pojokai-directadmin-ready.zip
echo ===================================================
pause
