@echo off
title PojokAI Rust Backend Server
echo ========================================================
echo   Menjalankan PojokAI High-Performance Server (Rust)
echo ========================================================
cd /d "%~dp0backend-rs"
if not exist "target\release\backend-rs.exe" (
    echo [INFO] Mengkompilasi release binary Rust...
    cargo build --release
)
echo [INFO] Menjalankan server di http://127.0.0.1:8080 ...
target\release\backend-rs.exe
pause
