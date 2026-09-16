#!/usr/bin/env bash
# ============================================================================
#  学生管理系统 - Linux/macOS 启动脚本
#  使用：把脚本设为可执行后直接运行
#        chmod +x 启动.sh && ./启动.sh
#  说明：本项目是纯 Node.js 零依赖应用，无需 npm install。
#        Node.js >= 14 即可运行。
# ============================================================================

set -e

# 切到脚本所在目录（无论从哪里调用，都运行脚本所在目录下的 server.js）
cd "$(dirname "$0")"

# 端口（可通过环境变量覆盖，如 PORT=8080 ./启动.sh）
PORT="${PORT:-3000}"

# ---- 检查 Node.js ----
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 Node.js，请先安装 Node.js（建议 14 或更高版本）。"
  echo "        Ubuntu/Debian:  sudo apt-get install -y nodejs"
  echo "        CentOS/RHEL:    sudo yum install -y nodejs"
  echo "        macOS:          brew install node"
  exit 1
fi

NODE_VER="$(node -v)"
echo "[INFO] Node 版本: ${NODE_VER}"

# ---- 检查端口是否被占用 ----
if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "(^|:)${PORT}$" >/dev/null 2>&1; then
    echo "[WARN] 端口 ${PORT} 似乎已被占用，如启动失败请尝试：PORT=8080 ./启动.sh"
  fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[WARN] 端口 ${PORT} 似乎已被占用，如启动失败请尝试：PORT=8080 ./启动.sh"
  fi
fi

# ---- 打开浏览器（跨平台尽力而为，失败也不影响服务启动）----
open_browser() {
  local URL="http://localhost:${PORT}"
  if command -v xdg-open >/dev/null 2>&1; then
    (xdg-open "$URL" >/dev/null 2>&1 &) || true
  elif command -v open >/dev/null 2>&1; then
    (open "$URL" >/dev/null 2>&1 &) || true
  fi
}

echo "[INFO] 启动服务（端口 ${PORT}）…"
echo "[INFO] 浏览器访问地址: http://localhost:${PORT}"
echo "[INFO] 默认账号: admin / admin123（登录后请尽快在「系统设置 → 账号与安全」中修改）"
echo "[INFO] 按 Ctrl+C 停止服务"
echo "----------------------------------------------------------------"

open_browser

# 使用 exec 让 node 继承前台信号（Ctrl+C 能干净退出）
exec node server.js