#!/usr/bin/env node
/**
 * 发布新版本：基于 package.json 的 version 创建 git tag 并推送到 GitHub
 * 用法: node release.js   （或双击 生成发布.bat）
 *
 * 流程:
 *   1. 从 package.json 读取 version
 *   2. 校验 package.json 没有未提交的改动（避免 tag 指向旧版本）
 *   3. git tag v<version>  (annotated, 含 "Release v<version>" 消息)
 *   4. git push <token-auth-url> v<version>  到 GitHub
 *
 * 鉴权走 .env 里的 GITHUB_REPO_URL / GITHUB_TOKEN，与 拉取.bat / 推送.bat 共用。
 * 报错时的 URL 会做脱敏 (token 替换为 ******).
 *
 * 注意: 本脚本不调任何打包命令。构建产物请先用 打包全部.bat（或 build.js），
 *     本脚本只负责"打 tag + 推送 tag"。
 *
 * @author RONGLINC <chenronglin1993@hotmail.com>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;

// 读取 .env 配置
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('[错误] 未找到 .env 文件，请先配置 GITHUB_REPO_URL 和 GITHUB_TOKEN');
    process.exit(1);
  }
  const env = {};
  fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  });
  return env;
}

const env = loadEnv();
const token = env.GITHUB_TOKEN || '';
const repoUrl = (env.GITHUB_REPO_URL || '').trim();
if (!repoUrl || !token) {
  console.error('[错误] .env 中缺少 GITHUB_REPO_URL 或 GITHUB_TOKEN');
  process.exit(1);
}
const authUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);
// 输出时隐藏令牌
const mask = (s) => s.split(token).join('******');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    console.error('[错误] git 命令执行失败：');
    console.error(mask(((e.stdout || '') + (e.stderr || '')).toString().trim()));
    process.exit(1);
  }
}

// 1. 从 package.json 读版本号
const pkgPath = path.join(ROOT, 'package.json');
let version = '';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  version = String(pkg.version || '').trim();
} catch (e) {
  console.error(`[错误] 读取 package.json 失败：${e.message}`);
  process.exit(1);
}
if (!version) {
  console.error('[错误] package.json 中 version 字段为空');
  process.exit(1);
}
const tagName = `v${version}`;
console.log(`准备发布版本: ${tagName}`);

// 2. 检查 package.json 是否已提交；未提交会指向旧 HEAD，发布出去会让线上版本与代码不符
const pkgStatus = git(['status', '--porcelain', '--', 'package.json']);
if (pkgStatus) {
  console.error('[错误] package.json 存在未提交的改动，请先 commit 后再打 tag');
  console.error(mask(pkgStatus));
  process.exit(1);
}

// 3. 检查本地是否已存在同名 tag
const existing = git(['tag', '-l', tagName]);
if (existing === tagName) {
  console.error(`[错误] 本地已存在 tag ${tagName}，请先删除（git tag -d ${tagName}）后重试`);
  process.exit(1);
}

// 4. 创建 annotated tag
git(['tag', '-a', tagName, '-m', `Release ${tagName}`]);
console.log(`已创建本地 tag: ${tagName}`);

// 5. 推送 tag 到 GitHub
console.log(`正在推送 tag ${tagName} 到 GitHub...`);
try {
  execFileSync('git', ['push', authUrl, tagName], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('tag 推送成功');
} catch (e) {
  console.error('[错误] tag 推送失败：');
  console.error(mask(((e.stdout || '') + (e.stderr || '')).toString().trim()));
  console.error(`提示：本地 tag 仍存在，可以重试推送（git push origin ${tagName}），或删除（git tag -d ${tagName}）`);
  process.exit(1);
}

console.log(`\n=== 发布完成 ===`);
console.log(`版本: ${tagName}`);
console.log(`提示: 到 GitHub 仓库的 Releases 页面可以基于此 tag 创建 Release 并上传 dist/ 下的产物`);