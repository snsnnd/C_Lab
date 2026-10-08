#!/usr/bin/env bash
# 启动课堂同步服务：老师用它共享屏幕状态，学生用浏览器打开即可跟随。
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "课堂同步功能需要 Node.js。"
  echo "请安装 Node.js LTS（https://nodejs.org）后重新运行本文件。"
  read -r -p "按回车键退出..."
  exit 1
fi
echo "正在启动课堂同步服务，请保持此窗口打开；按 Ctrl+C 停止。"
exec node server/serve.mjs
