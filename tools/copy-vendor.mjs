/**
 * tools/copy-vendor.mjs —— 把 node_modules 里的第三方产物拷进 public/vendor
 *
 * 为什么 pdf.js 用 2.x 而不是最新的 4.x：
 *   目标机是 Android 7.1 / WebView 72（Chrome 72）。
 *   4.x 连 legacy 构建都含上万处 `?.`；3.x legacy 也还有上百处；
 *   只有 2.16 的 legacy 构建是真正的 ES2015 级别，72 能跑。
 *   老工程用的就是 2.x，这边保持一致，省得两边渲染结果对不上。
 *
 * 这里会校验版本号，防止哪天 `npm i pdfjs-dist@latest` 之后悄悄拷进 4.x。
 */

import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NM = join(ROOT, 'node_modules');
const OUT = join(ROOT, 'public/vendor');

const EXPECT_PDFJS = /^2\./;

async function versionOf(pkg) {
  const raw = await readFile(join(NM, pkg, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

async function main() {
  const pdfVer = await versionOf('pdfjs-dist');
  if (!EXPECT_PDFJS.test(pdfVer)) {
    throw new Error(`pdfjs-dist 是 ${pdfVer}，但目标机只跑得动 2.x。先 npm i pdfjs-dist@2.16.105`);
  }

  await mkdir(join(OUT, 'katex'), { recursive: true });

  // pdf.js：legacy 构建才是给老浏览器的
  await cp(join(NM, 'pdfjs-dist/legacy/build/pdf.min.js'), join(OUT, 'pdf.min.js'));
  await cp(join(NM, 'pdfjs-dist/legacy/build/pdf.worker.min.js'), join(OUT, 'pdf.worker.min.js'));

  // KaTeX
  await cp(join(NM, 'katex/dist/katex.min.css'), join(OUT, 'katex/katex.min.css'));
  await cp(join(NM, 'katex/dist/katex.min.js'), join(OUT, 'katex/katex.min.js'));
  await rm(join(OUT, 'katex/fonts'), { recursive: true, force: true });
  await cp(join(NM, 'katex/dist/fonts'), join(OUT, 'katex/fonts'), { recursive: true });

  console.log(`[vendor] pdf.js ${pdfVer}（legacy）+ katex ${await versionOf('katex')}`);
}

main().catch((e) => {
  console.error('[vendor] 失败：', e.message);
  process.exit(1);
});
