#!/usr/bin/env bash
# C Lab 本地启动脚本：用系统自带的 Python 或 Node.js 托管本文件夹。
cd "$(dirname "$0")" || exit 1
PORT=8000
open_browser() {
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
  fi
}
if command -v python3 >/dev/null 2>&1; then
  echo "正在启动本地服务器（Python）：http://localhost:$PORT"
  echo "保持此窗口打开；按 Ctrl+C 停止。"
  open_browser
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v node >/dev/null 2>&1; then
  echo "正在启动本地服务器（Node.js）：http://localhost:$PORT"
  echo "保持此窗口打开；按 Ctrl+C 停止。"
  open_browser
  exec env HOST=127.0.0.1 node server/serve.mjs
else
  echo "没有找到 Python 3 或 Node.js。"
  echo "请安装其中之一后重新运行，或使用任意静态服务器托管本文件夹。详见 使用说明.txt。"
  read -r -p "按回车键退出..."
fi
