#!/usr/bin/env bash
# ============================================================================
# 飞牛 fpk 打包脚本（Linux / macOS / WSL / 飞牛 NAS 本机）
#   用法：./build-fpk.sh
#   前置：fnpack 已放入 PATH，或放在本目录下名为 fnpack
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(cd "${HERE}/.." && pwd)"
PKG="${HERE}/student-management-system"
SERVER="${PKG}/app/server"

echo "=== 飞牛 fpk 打包：学生管理系统 ==="

echo "[1/4] 复制程序文件到打包目录 ..."
rm -rf "${SERVER}"
mkdir -p "${SERVER}"
cp "${PROJ}/server.js" "${PROJ}/package.json" "${SERVER}/"
cp -r "${PROJ}/public" "${SERVER}/public"

echo "[2/4] 统一换行符为 LF，并赋予脚本可执行权限 ..."
while IFS= read -r -d '' f; do
  case "${f}" in
    *.png|*.jpg|*.jpeg|*.ico|*.gif) continue ;;
  esac
  sed -i 's/\r$//' "${f}"
done < <(find "${PKG}" -type f ! -path "*/app/server/*" -print0)
chmod 0755 "${PKG}"/cmd/* 2>/dev/null || true

echo "[3/4] 查找 fnpack ..."
FNPACK="${FNPACK:-}"
if [ -z "${FNPACK}" ] && [ -x "${HERE}/fnpack" ]; then
  FNPACK="${HERE}/fnpack"
fi
if [ -z "${FNPACK}" ]; then
  FNPACK="$(command -v fnpack || true)"
fi
if [ -z "${FNPACK}" ]; then
  echo "未找到 fnpack。请从 https://developer.fnnas.com/docs/cli/fnpack/ 下载对应平台的版本，"
  echo "放入 PATH，或命名为 fnpack 放在 ${HERE} 下。"
  exit 1
fi
echo "    使用 ${FNPACK}"

echo "[4/4] 打包并重命名产物（带版本号） ..."
( cd "${PKG}" && "${FNPACK}" build )

# 读取 manifest 中的字段（去掉首尾空白）
read_field() {
  awk -F= -v k="$1" '
    $1 ~ "^[[:space:]]*" k "[[:space:]]*$" {
      v = $2
      sub(/^[[:space:]]+/, "", v)
      sub(/[[:space:]]+$/, "", v)
      print v
      exit
    }
  ' "${PKG}/manifest"
}

APPNAME="$(read_field appname)"
VERSION="$(read_field version)"
APPNAME="${APPNAME:-student-management-system}"

RAW="${PKG}/${APPNAME}.fpk"
OUT="${RAW}"
if [ -f "${RAW}" ] && [ -n "${VERSION}" ]; then
  VPKG="${PKG}/${APPNAME}-${VERSION}.fpk"
  if [ "${VPKG}" != "${RAW}" ]; then
    mv -f "${RAW}" "${VPKG}"
  fi
  OUT="${VPKG}"
fi

echo
echo "打包完成：${OUT}"
echo "  应用：${APPNAME}   版本：${VERSION:-未知}"
echo "安装：把 fpk 上传到飞牛应用中心，或 SSH 登录后执行："
echo "  appcenter-cli install-fpk $(basename "${OUT}")"
