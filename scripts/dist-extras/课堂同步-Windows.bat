@echo off
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo 正在启动课堂同步服务，请保持此窗口打开；按 Ctrl+C 停止。
node server\serve.mjs
echo 课堂同步服务已停止。
pause
goto :done

:nonode
echo 课堂同步功能需要 Node.js。
echo 请安装 Node.js LTS（https://nodejs.org）后重新双击本文件。
pause

:done
popd
