#!/bin/bash
# ============================================================================
#  学生管理系统 - macOS 启动脚本（Finder 双击即可运行）
#
#  使用: 在 Finder 里双击 "启动.command"
#  说明: macOS Finder 对 .command 后缀会自动 chmod +x 并打开 Terminal 执行,
#        无需手动 chmod / 打开 Terminal.
#        本项目是纯 Node.js 零依赖应用, 无需 npm install.
#        Node.js >= 14 即可运行.
# ============================================================================

# 切到脚本所在目录（无论从哪里调用, 都运行脚本所在目录下的 server.js）
cd "$(dirname "$0")"

# 端口（可通过环境变量覆盖, 如 PORT=8080 双击之前在 Terminal 里 export）
PORT="${PORT:-3000}"

# ---- 检查 Node.js ----
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "未检测到 Node.js" message "请先从 https://nodejs.org 安装 Node.js 14 或更高版本, 安装完成后再双击 启动.command 重试。" as critical buttons {"好的"} default button "好的"' >/dev/null 2>&1 &
  echo "[ERROR] 未检测到 Node.js。请先安装 Node.js (https://nodejs.org, 建议 14+)。"
  echo "        安装方式一: 官方安装包 (推荐)"
  echo "        安装方式二: brew install node"
  echo
  echo "按任意键关闭..."
  read -n 1
  exit 1
fi

NODE_VER="$(node -v)"
echo "[INFO] Node 版本: ${NODE_VER}"

# ---- 检查端口占用（lsof 是 macOS 自带的）----
if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[WARN] 端口 ${PORT} 似乎已被占用, 如启动失败请先释放端口或设置 PORT=<其他端口>"
    echo "       例: 在 Terminal 里执行 PORT=8080 \"$(pwd)/启动.command\""
  fi
fi

# ---- 打开浏览器（macOS 用 open）----
URL="http://localhost:${PORT}"
(sleep 1.5 && open "${URL}" >/dev/null 2>&1) &

echo "[INFO] 启动服务（端口 ${PORT}）…"
echo "[INFO] 浏览器访问地址: ${URL}"
echo "[INFO] 默认账号: admin / admin123（首次登录后请尽快在「系统设置 → 账号与安全」中修改）"
echo "[INFO] 按 Ctrl+C 停止服务, 直接关闭 Terminal 窗口亦可"
echo "----------------------------------------------------------------"

# 使用 exec 让 node 继承前台信号（Ctrl+C 能干净退出）
exec node server.js