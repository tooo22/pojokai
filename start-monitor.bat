@echo off
title PojokAI Watchdog - Live System Monitor (Update 5 Detik)
color 0C
cls
echo ================================================================
echo       POJOKAI WATCHDOG - LIVE SYSTEM DASHBOARD (5 DETIK)
echo ================================================================
echo.
echo Menjalankan live monitoring Web PojokAI dan Bot Telegram...
echo Dashboard diperbarui setiap 5 detik pada 1 pesan Telegram (tanpa spam).
echo.

:start
node monitor-bot.mjs

if %errorlevel% neq 0 (
  echo.
  echo [!] Monitor terhenti dengan error code %errorlevel%.
  echo Menunggu 5 detik sebelum restart otomatis...
  timeout /t 5 >nul
  goto :start
)
pause
