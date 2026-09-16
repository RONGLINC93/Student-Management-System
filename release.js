#!/usr/bin/env node
/**
 * 发布新版本：基于 package.json 的 version 创建 git tag + 推送 + 创建 GitHub Release + 上传 dist/ 产物
 * 用法: node release.js   （或双击 生成发布.bat）
 *
 * 流程:
 *   1. 从 package.json 读取 version
 *   2. 校验 package.json 没有未提交的改动（避免 tag 指向旧版本）
 *   3. 校验本地无同名 tag
 *   4. git tag v<version>  (annotated, "Release v<version>")
 *   5. git push <token-auth-url> v<version>
 *   6. 从 CHANGELOG.md 提取 v<version> 段作为 Release body
 *   7. POST /repos/{owner}/{repo}/releases 创建 Release
 *   8. 上传 dist/ 下的 win/linux rar 与 fpk 到 Release
 *
 * 鉴权走 .env 里的 GITHUB_REPO_URL / GITHUB_TOKEN, 与 拉取.bat / 推送.bat 共用.
 * 报错时 URL 做脱敏 (token 替换为 ******).
 *
 * 退出码:
 *   0 = 全部成功
 *   1 = 失败 (tag / push / Release 创建)
 *   2 = Release 已创建但部分资产上传失败 (到 GitHub 页面手动重试)
 *
 * 副作用: Release 创建后会写一份结果摘要到 dist/.last-release.json,
 *         供 发布.bat 读取并显示给用户.
 *
 * @author RONGLINC <chenronglin1993@hotmail.com>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');
const { execFileSync } = require('child_process');

const ROOT = __dirname;

// ===========================================================================
//  1. 加载 .env
// ===========================================================================
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
const token = (env.GITHUB_TOKEN || '').trim();
const repoUrl = (env.GITHUB_REPO_URL || '').trim();
if (!repoUrl || !token) {
  console.error('[错误] .env 中缺少 GITHUB_REPO_URL 或 GITHUB_TOKEN');
  process.exit(1);
}
const authUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);
// 输出时隐藏令牌
const mask = (s) => s.split(token).join('******');

// ===========================================================================
//  2. 解析 owner / repo
// ===========================================================================
function parseRepo(u) {
  // https://github.com/owner/repo(.git)? 或 git@github.com:owner/repo.git
  let m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = u.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}
const repoInfo = parseRepo(repoUrl);
if (!repoInfo) {
  console.error('[错误] 无法从 GITHUB_REPO_URL 解析 owner/repo');
  console.error(`       URL: ${mask(repoUrl)}`);
  console.error('       期望格式: https://github.com/<owner>/<repo>.git');
  process.exit(1);
}
const { owner, repo } = repoInfo;

// ===========================================================================
//  3. git 工具
// ===========================================================================
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    console.error('[错误] git 命令执行失败：');
    console.error(mask(((e.stdout || '') + (e.stderr || '')).toString().trim()));
    process.exit(1);
  }
}

// ===========================================================================
//  4. https 请求封装 (Promise)
// ===========================================================================
function request(method, reqUrl, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new url.URL(reqUrl);
    } catch (e) {
      reject(new Error(`URL 解析失败: ${reqUrl}`));
      return;
    }
    const opts = {
      method,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || 443,
      headers: {
        'User-Agent': 'Student-Management-System-release',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...extraHeaders,
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          body: buf.toString('utf-8'),
          rawBody: buf,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      // body 可以是 string 或 Buffer
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8');
      req.write(buf);
    }
    req.end();
  });
}

// ===========================================================================
//  5. 读 package.json 版本号
// ===========================================================================
let version = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
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
console.log(`准备发布版本: ${tagName}  (${owner}/${repo})`);

// ===========================================================================
//  6. 校验 package.json 已 commit
// ===========================================================================
const pkgStatus = git(['status', '--porcelain', '--', 'package.json']);
if (pkgStatus) {
  console.error('[错误] package.json 存在未提交的改动，请先 commit 后再发布');
  console.error(mask(pkgStatus));
  process.exit(1);
}

// ===========================================================================
//  7. 校验本地无同名 tag
// ===========================================================================
const existing = git(['tag', '-l', tagName]);
if (existing === tagName) {
  console.error(`[错误] 本地已存在 tag ${tagName}，请先删除（git tag -d ${tagName}）后重试`);
  process.exit(1);
}

// ===========================================================================
//  8. 找出 dist/ 下的产物
// ===========================================================================
const distDir = path.join(ROOT, 'dist');
// win/linux/macos rar 大写, fpk 文件名小写 (跟 manifest 的 appname 一致)
const candidates = [
  path.join(distDir, `Student-Management-System-${version}-win.rar`),
  path.join(distDir, `Student-Management-System-${version}-linux.rar`),
  path.join(distDir, `Student-Management-System-${version}-macos.rar`),
  path.join(distDir, `student-management-system-${version}.fpk`),
];
const assets = [];
for (const p of candidates) {
  if (fs.existsSync(p)) {
    assets.push(p);
  } else {
    console.warn(`[警告] 产物不存在，跳过上传: ${path.basename(p)}`);
  }
}
if (assets.length === 0) {
  console.error('[错误] dist/ 下找不到任何产物 (win/linux rar 或 fpk)。请先运行 打包全部.bat');
  process.exit(1);
}

// ===========================================================================
//  9. 创建 tag
// ===========================================================================
git(['tag', '-a', tagName, '-m', `Release ${tagName}`]);
console.log(`已创建本地 tag: ${tagName}`);

// ===========================================================================
//  10. push tag
// ===========================================================================
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

// ===========================================================================
//  11. 从 CHANGELOG.md 提取 v<version> 段作为 Release body
// ===========================================================================
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractChangelog(v) {
  const clPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(clPath)) return null;
  const text = fs.readFileSync(clPath, 'utf-8');
  // 匹配 "## v<version> — ..." 段到下一个 "## " 之前
  const re = new RegExp(`^## v${escapeRegex(v)}\\b[\\s\\S]*?(?=^## |\\Z)`, 'm');
  const m = text.match(re);
  if (!m) return null;
  const block = m[0];
  const lines = block.split(/\r?\n/);
  // 跳过第一行 (## 标题) 与随后的空行，剩下作为 body
  let i = 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  const body = lines.slice(i).join('\n').trim();
  return body || null;
}

const releaseBody = extractChangelog(version) ||
  `## Release ${tagName}\n\n详见 [CHANGELOG.md](https://github.com/${owner}/${repo}/blob/main/CHANGELOG.md)`;

// ===========================================================================
//  12. 创建 GitHub Release
// ===========================================================================
async function createRelease() {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const body = JSON.stringify({
    tag_name: tagName,
    name: tagName,
    body: releaseBody,
    draft: false,
    prerelease: false,
  });
  const res = await request('POST', apiUrl, body, {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body, 'utf-8'),
  });
  if (res.status < 200 || res.status >= 300) {
    console.error(`[错误] 创建 Release 失败 (HTTP ${res.status}):`);
    console.error(mask(res.body));
    return null;
  }
  try {
    return JSON.parse(res.body);
  } catch (e) {
    console.error('[错误] 解析 Release 响应失败：', e.message);
    return null;
  }
}

// ===========================================================================
//  13. 上传资产到 Release
// ===========================================================================
async function uploadAsset(release, filePath) {
  const fileName = path.basename(filePath);
  // upload_url 形如 https://uploads.github.com/repos/.../releases/{id}/assets{?name,label}
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(fileName)}`);
  const fileBuf = fs.readFileSync(filePath);
  const res = await request('POST', uploadUrl, fileBuf, {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/octet-stream',
    'Content-Length': fileBuf.length,
  });
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, body: res.body, fileName };
  }
  return { ok: true, fileName };
}

// ===========================================================================
//  14. 主流程 (异步)
// ===========================================================================
async function main() {
  console.log(`正在创建 GitHub Release: ${tagName} ...`);
  const release = await createRelease();
  if (!release) {
    console.error('');
    console.error('Release 创建未成功，dist/ 产物未上传。');
    console.error('  - tag 已推送到 GitHub，但 Release 没建出来');
    console.error('  - 请到 GitHub 仓库 Releases 页面手动基于该 tag 创建 Release');
    console.error('  - 也可删除本地 tag 重试: git tag -d ' + tagName);
    process.exit(1);
  }
  console.log(`Release 创建成功: ${release.html_url}`);

  console.log(`开始上传 ${assets.length} 个产物到 Release:`);
  let okCount = 0;
  const fails = [];
  const assetResults = [];
  for (const p of assets) {
    process.stdout.write(`  上传 ${path.basename(p)} ... `);
    const r = await uploadAsset(release, p);
    if (r.ok) {
      console.log('OK');
      okCount++;
      assetResults.push({ name: r.fileName, ok: true });
    } else {
      console.log(`失败 (HTTP ${r.status})`);
      fails.push({ fileName: r.fileName, body: mask(r.body) });
      assetResults.push({ name: r.fileName, ok: false, status: r.status });
    }
  }

  // 把发布结果写到 dist/.last-release.json, 供 发布.bat 读取并显示
  try {
    fs.writeFileSync(
      path.join(distDir, '.last-release.json'),
      JSON.stringify({
        success: fails.length === 0,
        version,
        tagName,
        html_url: release.html_url,
        assets: assetResults,
        timestamp: new Date().toISOString(),
      }, null, 2) + '\n',
      'utf-8'
    );
  } catch (e) {
    console.warn(`[警告] 写 dist/.last-release.json 失败: ${e.message}`);
  }

  console.log('');
  console.log('=== 发布完成 ===');
  console.log(`版本:    ${tagName}`);
  console.log(`Release: ${release.html_url}`);
  console.log(`资产:    ${okCount}/${assets.length} 上传成功`);
  if (fails.length) {
    console.log('');
    console.log('[警告] 以下资产上传失败，可到 Release 页面手动重试：');
    for (const f of fails) {
      console.log(`  - ${f.fileName}`);
      console.log(`    ${f.body}`);
    }
    process.exit(2);  // Release 已建，部分资产失败
  }
}

main().catch((e) => {
  console.error('[错误] 未预期的异常：', e.stack || e.message);
  process.exit(1);
});