/**
 * tools/publish-github.mjs —— 把工程推到 GitHub
 *
 * 为什么要这个脚本：
 *   这台机器上没有 gh、没有 PAT，只有 WorkBuddy 的 GitHub 连接器（MCP 代理）。
 *   而 MCP 的 push_files 需要把文件内容放进请求体——如果靠人一个个复制粘贴，
 *   几千行代码必然出错。所以这里直接调本地 MCP 代理，文件从磁盘读，原样上传。
 *
 * 用法：
 *   node tools/publish-github.mjs --dry-run          # 只列出会传哪些文件
 *   node tools/publish-github.mjs --repo circleask   # 真推
 *
 * 认证来自环境变量 CODEBUDDY_MCP_CONFIG（连接器注入），不落盘、不硬编码。
 */

import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ---------- 哪些文件进仓库 ---------- */

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.gradle',
  'build',
  'assets', // android/app/src/main/assets —— cap sync 的产物
  'shots', // docs/shots —— 截图，二进制
]);

const SKIP_FILES = new Set([
  'local.properties',
  'gradle-wrapper.jar',
  'package-lock.json',
]);

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.ttf', '.woff', '.woff2', '.jar', '.apk', '.zip']);

/** vendor 是 npm run vendor 生成的第三方产物，不进仓库 */
const SKIP_PATHS = [/^public\/__dev\//, /^public\/vendor\//, /^public\/fixtures\//, /^android\/app\/src\/main\/assets\//, /^android\/app\/src\/main\/res\/mipmap/];

async function walk(dir, out = []) {
  for (const entry of await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PATHS.some((re) => re.test(rel + '/'))) continue;
      await walk(full, out);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    if (SKIP_PATHS.some((re) => re.test(rel))) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (SKIP_EXT.has(ext.toLowerCase())) continue;
    const size = (await stat(full)).size;
    out.push({ rel, full, size });
  }
  return out;
}

/* ---------- 最小 MCP 客户端（streamable HTTP） ---------- */

function mcpConfig() {
  const raw = process.env.CODEBUDDY_MCP_CONFIG;
  if (!raw) throw new Error('没有 CODEBUDDY_MCP_CONFIG，GitHub 连接器未注入');
  const cfg = JSON.parse(raw);
  const gh = cfg.mcpServers?.github;
  if (!gh) throw new Error('配置里没有 github 连接器');
  return gh;
}

function createClient() {
  const gh = mcpConfig();
  const baseHeaders = {
    ...gh.headers,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  let sessionId = null;
  let nextId = 0;

  /** SSE 响应里把 data 行拼起来；纯 JSON 直接解析 */
  function parseBody(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    const chunks = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) chunks.push(line.slice(5).trim());
    }
    for (const c of chunks.reverse()) {
      try {
        return JSON.parse(c);
      } catch {
        /* 继续找 */
      }
    }
    throw new Error('MCP 返回体无法解析：' + text.slice(0, 200));
  }

  async function post(payload) {
    const headers = { ...baseHeaders };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const res = await fetch(gh.url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (res.status === 202 || res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP ${res.status}: ${text.slice(0, 300)}`);
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    return parseBody(text);
  }

  async function init() {
    const res = await post({
      jsonrpc: '2.0',
      id: ++nextId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'circleask-publisher', version: '1' },
      },
    });
    if (res?.error) throw new Error('initialize 失败：' + JSON.stringify(res.error));
    // 握手后必须发这个通知，否则后续 tools/call 会被拒
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    return res?.result;
  }

  async function callTool(name, args) {
    const res = await post({
      jsonrpc: '2.0',
      id: ++nextId,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (res?.error) throw new Error(`${name} 失败：${JSON.stringify(res.error)}`);
    const content = res?.result?.content || [];
    const text = content.map((c) => c.text || '').join('\n');
    if (res?.result?.isError) throw new Error(`${name} 返回错误：${text.slice(0, 400)}`);
    return text;
  }

  return { init, callTool };
}

/* ---------- 主流程 ---------- */

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { repo: 'circleask', owner: 'cflaaa', private: true, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--dry-run') out.dryRun = true;
    else if (a[i] === '--repo') out.repo = a[++i];
    else if (a[i] === '--public') out.private = false;
  }
  return out;
}

/** 按体积和数量切批，避免单次请求过大 */
function batch(files, maxFiles = 25, maxBytes = 180 * 1024) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= maxFiles || bytes + f.size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function main() {
  const args = parseArgs();
  const files = await walk(ROOT);
  const total = files.reduce((s, f) => s + f.size, 0);

  console.log(`准备推送 ${files.length} 个文件，共 ${(total / 1024).toFixed(1)} KB`);
  const groups = batch(files);
  console.log(`分 ${groups.length} 批：${groups.map((g) => g.length).join(' / ')}`);

  if (args.dryRun) {
    for (const f of files) console.log('  ' + f.rel);
    return;
  }

  const client = createClient();
  await client.init();
  console.log('✓ MCP 已握手');

  // 建仓库。已存在就**停下**，不往上写——否则可能覆盖同名仓库的内容
  try {
    const r = await client.callTool('create_repository', {
      name: args.repo,
      description: '圈问 CircleAsk —— 在 PDF 上圈一段，直接问它。分层架构，手机/平板/桌面三端，兼容 Android 7 / WebView 72。',
      private: args.private,
      autoInit: true,
    });
    console.log('✓ 仓库已创建：' + r.slice(0, 160));
  } catch (e) {
    if (/exist|already/i.test(e.message)) {
      throw new Error(`仓库 ${args.owner}/${args.repo} 已存在，停止推送以免覆盖。换个名字用 --repo <name>`);
    }
    throw e;
  }

  let done = 0;
  for (const [i, g] of groups.entries()) {
    const payload = [];
    for (const f of g) payload.push({ path: f.rel, content: await readFile(f.full, 'utf8') });
    const msg = `chore: 导入代码（第 ${i + 1}/${groups.length} 批，${g.length} 个文件）`;
    const r = await client.callTool('push_files', {
      owner: args.owner,
      repo: args.repo,
      branch: 'main',
      files: payload,
      message: msg,
    });
    done += g.length;
    console.log(`  [${i + 1}/${groups.length}] ${g.length} 个文件 OK  (${done}/${files.length})  ${r.slice(0, 60).replace(/\n/g, ' ')}`);
  }

  console.log(`\n✓ 完成：https://github.com/${args.owner}/${args.repo}`);
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
