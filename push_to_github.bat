@echo off
echo ===================================================
echo   Pushing ENTIRE BookGuard Codebase to GitHub...
echo ===================================================
cd /d "%~dp0"

echo [1/5] Initializing Git repository...
git init

echo [2/5] Staging ALL files across the entire project (backend, frontend, db, etc.)...
git add .

echo [3/5] Creating commit with full application codebase...
git commit -m "feat: complete BookGuard real-time multi-modal travel platform and booking integrity engine"

echo [4/5] Setting main branch and remote origin...
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/29-codeee/BookGuard.git

echo [5/5] Pushing entire codebase to https://github.com/29-codeee/BookGuard...
git push -u origin main --force

echo.
echo ===================================================
echo   Push Complete! Visit:
echo   https://github.com/29-codeee/BookGuard
echo ===================================================
pause
