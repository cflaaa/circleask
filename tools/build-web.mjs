/**
 * tools/build-web.mjs —— 把工程拼成 Capacitor 能吃的静态目录 dist/
 *
 * 目标机是 Android 7.1 / WebView 72（Chrome 72），所以这里不只是「搬文件」，
 * 还要把源码转译到 chrome72 语法：
 *   - `?.` 和 `??` 是 Chrome 80 才有的，72 上直接 SyntaxError（整个 App 白屏）
 *   - 模块合并成一个 IIFE，顺便减少老机器上的请求数
 *
 * 开发时仍然跑原生 ESM（dev-server 直接吐 src/），只有出包才转译。
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'dist');

/** 不搬进安装包的东西：开发探针 */
const SKIP = new Set(['__dev']);

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    if (SKIP.has(name)) continue;
    const src = join(from, name);
    const dst = join(to, name);
    const s = await stat(src);
    if (s.isDirectory()) await copyDir(src, dst);
    else await cp(src, dst);
  }
}

/** 只挑 CSS：JS 走打包，源码不必进包 */
async function copyCss(from, to) {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    const s = await stat(src);
    if (s.isDirectory()) await copyCss(src, dst);
    else if (name.endsWith('.css')) await cp(src, dst);
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await copyDir(join(ROOT, 'public'), OUT);
  await copyCss(join(ROOT, 'src'), join(OUT, 'src'));

  // ---- 打包 + 转译 ----
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'src/app/bootstrap.js')],
    outfile: join(OUT, 'src/app/bundle.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome72'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
  });

  const bytes = Object.values(result.metafile.outputs)[0]?.bytes || 0;
  console.log(`[build-web] bundle.js ${(bytes / 1024).toFixed(1)} KB（target: chrome72）`);

  // ---- index.html 换成打包产物 ----
  const indexPath = join(OUT, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const next = html.replace(
    /<script type="module" src="\/src\/app\/bootstrap\.js"><\/script>/,
    '<script defer src="/src/app/bundle.js"></script>'
  );
  if (next === html) throw new Error('index.html 里没找到 bootstrap 的 module 标签，打包脚本该更新了');
  await writeFile(indexPath, next, 'utf8');

  // ---- 自检：产物里不能残留 chrome72 不认的语法 ----
  const bundle = await readFile(join(OUT, 'src/app/bundle.js'), 'utf8');
  const bad = [];
  if (/\?\./.test(bundle)) bad.push('?.');
  if (/\?\?/.test(bundle)) bad.push('??');
  if (bad.length) throw new Error(`产物仍含 ${bad.join(' / ')}，chrome72 会直接语法错误`);
  console.log('[build-web] 语法自检通过（无 ?. / ??）');

  // ---- vendor 自检：pdf.js 必须是 chrome72 能解析的版本 ----
  // 不能用「文件里有没有 ?.」来判：2.16 的压缩产物里 `(\?.*)?` 这类正则会误伤。
  // 交给 esbuild 真解析一遍，解析得过就是语法兼容。
  const pdfPath = join(OUT, 'vendor/pdf.min.js');
  let pdf;
  try {
    pdf = await readFile(pdfPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('缺少 dist/vendor/pdf.min.js，先跑 npm run vendor');
    throw e;
  }
  try {
    await esbuild.transform(pdf, { target: 'chrome72', loader: 'js' });
  } catch (e) {
    throw new Error(`vendor/pdf.min.js 在 chrome72 下解析失败（换成 pdfjs-dist 2.x 的 legacy 构建）：${e.message}`);
  }

  console.log('[build-web] dist 就绪 →', OUT);
}

main().catch((e) => {
  console.error('[build-web] 失败：', e.message);
  process.exit(1);
});
