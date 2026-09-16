#!/usr/bin/env bash
# ===========================================================================
#  Student Management System - Linux / macOS 调用器
#
#  真正的打包逻辑在 build.js（Node.js 跨平台脚本）。
#  这个 .sh 只是为了方便 Linux / macOS 用户使用。
#
#  用法（与 build.js 一致）：
#     ./打包rar.sh                同时打两个平台
#     ./打包rar.sh win            只打 Windows 版（含 运行.bat）
#     ./打包rar.sh linux          只打 Linux 版（含 启动.sh）
#     ./打包rar.sh all            同不传参数
#
#  前置：Node.js 14+ 已安装；rar 命令可用（apt install rar / brew install --cask rar）
# ===========================================================================

set -e

# 倒计时关闭: 倒数 N 秒后返回 (Ctrl+C 可中断).
# 仅在脚本独立运行 (非 PACKAGE_ALL 嵌套) 时调用.
countdown() {
    local n=${1:-5}
    echo
    echo "Closing in $n seconds... (Ctrl+C to cancel)"
    for ((i = n; i >= 1; i--)); do
        echo "  $i..."
        sleep 1
    done
}

# 任意命令失败时, 统一输出 [ERROR] 提示并倒计时关闭
trap 'echo; echo "[ERROR] Build failed. See messages above."; countdown 5; exit 1' ERR

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 透传所有参数给 build.js
node ./build.js "$@"

# 成功提示
# PACKAGE_ALL 由 打包全部.sh 在嵌套调用前设置, 此时不再倒计时 / 不再打开文件管理器
if [ -z "${PACKAGE_ALL:-}" ]; then
    echo
    echo "=== Done. 输出目录: $(pwd)/dist ==="
    # 在桌面环境下尝试弹出文件管理器 (非阻塞, 失败不影响流程)
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$(pwd)/dist" 2>/dev/null &
    elif command -v open >/dev/null 2>&1; then
        open "$(pwd)/dist" 2>/dev/null &
    fi
    countdown 5
fi