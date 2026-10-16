@echo off
echo ===========================================
echo   Deploying PojokAI to Vercel (Production)
echo ===========================================
call node build.mjs
call npx vercel --prod --yes
pause
