@echo off
echo ===========================================
echo   Deploying PojokAI to Vercel (Production)
echo ===========================================
set NODE_OPTIONS=--dns-result-order=ipv4first
call node build.mjs
call npx vercel --prod --yes
pause
