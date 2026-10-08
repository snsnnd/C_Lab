@echo off
chcp 65001 >nul
pushd "%~dp0"
where py >nul 2>nul
if not errorlevel 1 goto :py
where python >nul 2>nul
if not errorlevel 1 goto :python
where node >nul 2>nul
if not errorlevel 1 goto :node
echo 没有找到 Python 或 Node.js。
echo 请安装其中之一（Python 3 或 Node.js LTS）后重新双击本文件，
echo 或使用任意静态服务器托管本文件夹。详见 使用说明.txt。
pause
goto :done

:py
echo 正在启动本地服务器，浏览器将自动打开 http://localhost:8000
echo 请保持此窗口打开；按 Ctrl+C 停止。
start "" http://localhost:8000
py -m http.server 8000 --bind 127.0.0.1
goto :done

:python
echo 正在启动本地服务器，浏览器将自动打开 http://localhost:8000
echo 请保持此窗口打开；按 Ctrl+C 停止。
start "" http://localhost:8000
python -m http.server 8000 --bind 127.0.0.1
goto :done

:node
echo 正在启动本地服务器，浏览器将自动打开 http://localhost:8000
echo 请保持此窗口打开；按 Ctrl+C 停止。
set HOST=127.0.0.1
start "" http://localhost:8000
node server\serve.mjs
goto :done

:done
popd
