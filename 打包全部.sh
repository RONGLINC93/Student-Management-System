#!/usr/bin/env bash
# ===========================================================================
#  Student Management System - 一键打包全部平台 (Linux / macOS)
#
#  依次执行:
#    1) 打包rar.sh   生成 Linux + Windows 的 rar 包
#                    (Linux/macOS 上只会真正产出 linux rar;
#                     win rar 需要在 Windows 上跑 打包全部.bat 才能产出)
#    2) fpk 步骤在 Linux/macOS 上跳过并提示
#       (fnpack.exe 是 Windows x86 二进制, fpk 只能在 Windows 上构建)
#
#  用法: ./打包全部.sh
#  前置: Node.js 14+, rar 命令可用
# ===========================================================================

set -e

# 任意命令失败时, 统一输出 [ERROR] 提示
trap 'echo; echo "[ERROR] Build failed. See messages above."; exit 1' ERR

# 切换到脚本所在目录
cd "$(dirname "$0")"

echo "=== [1/2] RAR packages (Linux / Windows) ==="
echo
# 设置 PACKAGE_ALL 让 打包rar.sh 不再尝试打开文件管理器
PACKAGE_ALL=1 ./打包rar.sh
echo

echo "=== [2/2] fnOS fpk package ==="
echo
case "$(uname -s)" in
    Linux*|Darwin*)
        echo "    [SKIP] fpk 步骤在 $(uname -s) 上跳过"
        echo "           原因: fnpack.exe 是 Windows x86 二进制"
        echo "           如需 fpk 包, 请在 Windows 上运行 打包全部.bat"
        ;;
    *)
        echo "    [SKIP] 当前平台不支持 fpk 构建"
        ;;
esac

echo
echo "=== All packages built. 输出目录: dist/ ==="