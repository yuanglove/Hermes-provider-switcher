@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ============================================================
echo  Hermes Provider Switcher - Windows 打包脚本
echo ============================================================
echo.

echo [1/4] 清理旧的 dist 和 release 目录...
if exist dist rmdir /s /q dist
if exist release rmdir /s /q release
echo 完成。
echo.

echo [2/4] 安装依赖（使用 npmmirror 镜像）...
call npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
if errorlevel 1 (
    echo [错误] npm install 失败，已中止。
    pause
    exit /b 1
)
echo 完成。
echo.

echo [3/4] 构建渲染进程和主进程...
call npm run build
if errorlevel 1 (
    echo [错误] 构建失败，已中止。
    pause
    exit /b 1
)
echo 完成。
echo.

echo [4/4] 打包 Windows 安装版和免安装版...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set CSC_IDENTITY_AUTO_DISCOVERY=false

call npx electron-builder --win --publish=never
if errorlevel 1 (
    echo [错误] electron-builder 打包失败，已中止。
    pause
    exit /b 1
)
echo 完成。
echo.

echo ============================================================
echo  打包成功，产物在 release\ 目录：
echo.
dir /b release\*.exe 2>nul
echo.
echo  解压版路径：
echo    release\win-unpacked\Hermes Provider Switcher.exe
echo ============================================================
echo.
echo 按任意键打开 release 目录...
pause >nul
explorer release
