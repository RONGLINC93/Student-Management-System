#!/usr/bin/env bash
# ===========================================================================
#  Student Management System - Windows 版 RAR 打包 (Linux / macOS 调用)
#
#  真正的打包逻辑在 build.js（Node.js 跨平台脚本）。
#  这个 .sh 只是为了方便 Linux / macOS 用户单独打 Windows 版。
#
#  同时打多个平台请用 ./打包全部.sh。
#  Linux 版请用 ./打包rar-linux.sh。
#
#  前置: Node.js 14+ 已安装; rar 命令可用
# ===========================================================================

# 切到 UTF-8 locale, 避免中文输出乱码 (若系统已是 UTF-8 则不动)
case "${LC_ALL:-${LANG:-}}" in
    *UTF-8|*utf8) ;;
    *)
        for loc in C.UTF-8 en_US.UTF-8 zh_CN.UTF-8; do
            if locale -a 2>/dev/null | grep -qx "$loc"; then
                export LC_ALL="$loc" LANG="$loc"
                break
            fi
        done
        ;;
esac

set -e

# 倒计时关闭: 倒数 N 秒后返回 (Ctrl+C 可中断).
# 仅在脚本独立运行 (非 PACKAGE_ALL 嵌套) 时调用.
countdown() {
    local n=${1:-5}
    echo
    echo "将在 $n 秒后关闭... (Ctrl+C 可取消)"
    for ((i = n; i >= 1; i--)); do
        echo "  $i..."
        sleep 1
    done
}

# 错误统一处理: 输出 [错误] 提示, 嵌套调用时不倒计时 (外层统一负责)
err_handler() {
    echo
    echo "[错误] 打包失败，详见上方信息。"
    if [ -z "${PACKAGE_ALL:-}" ]; then
        countdown 5
    fi
    exit 1
}

# 任意命令失败时, 触发 err_handler
trap 'err_handler' ERR

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 固定只打 Windows 版
node ./build.js win

# 成功提示
# PACKAGE_ALL 由 打包全部.sh 在嵌套调用前设置, 此时不再倒计时 / 不再打开文件管理器
if [ -z "${PACKAGE_ALL:-}" ]; then
    echo
    echo "=== 完成. 输出目录: $(pwd)/dist ==="
    # 在桌面环境下尝试弹出文件管理器 (非阻塞, 失败不影响流程)
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$(pwd)/dist" 2>/dev/null &
    elif command -v open >/dev/null 2>&1; then
        open "$(pwd)/dist" 2>/dev/null &
    fi
    countdown 5
fi