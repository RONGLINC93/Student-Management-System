#!/usr/bin/env bash
# ===========================================================================
#  Student Management System - 一键打包全部平台 (Linux / macOS)
#
#  依次执行:
#    1) 打包rar-linux.sh  生成 Linux 版 rar   (含 启动.sh)
#    2) 打包rar-win.sh    生成 Windows 版 rar (含 运行.bat)
#    3) 打包rar-mac.sh    生成 macOS 版 rar   (含 启动.command, Finder 双击即可)
#    4) fpk 步骤在 Linux/macOS 上跳过并提示
#       (fnpack.exe 是 Windows x86 二进制, fpk 只能在 Windows 上构建)
#
#  用法: ./打包全部.sh
#  前置: Node.js 14+, rar 命令可用
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

# 倒计时关闭: 倒数 N 秒后返回 (Ctrl+C 可中断)
countdown() {
    local n=${1:-5}
    echo
    echo "将在 $n 秒后关闭... (Ctrl+C 可取消)"
    for ((i = n; i >= 1; i--)); do
        echo "  $i..."
        sleep 1
    done
}

# 任意命令失败时, 统一输出 [错误] 提示并倒计时关闭
trap 'echo; echo "[错误] 打包失败，详见上方信息。"; countdown 5; exit 1' ERR

# 切换到脚本所在目录
cd "$(dirname "$0")"

echo "=== [1/3] RAR packages (Linux / Windows / macOS) ==="
echo
# 设置 PACKAGE_ALL 让子脚本不再倒计时 / 不再尝试打开文件管理器
echo "--- 打包 Linux 版 ---"
PACKAGE_ALL=1 ./打包rar-linux.sh
echo
echo "--- 打包 Windows 版 ---"
PACKAGE_ALL=1 ./打包rar-win.sh
echo
echo "--- 打包 macOS 版 ---"
PACKAGE_ALL=1 ./打包rar-mac.sh
echo

echo "=== [2/3] fnOS fpk package ==="
echo
case "$(uname -s)" in
    Linux*|Darwin*)
        echo "    [跳过] fpk 步骤在 $(uname -s) 上跳过"
        echo "           原因: fnpack.exe 是 Windows x86 二进制"
        echo "           如需 fpk 包, 请在 Windows 上运行 打包全部.bat"
        ;;
    *)
        echo "    [跳过] 当前平台不支持 fpk 构建"
        ;;
esac

echo
echo "=== [3/3] dev source package ==="
echo
PACKAGE_ALL=1 ./打包dev.sh

echo
echo "=== 全部打包完成. 输出目录: dist/ ==="
countdown 5