/**
 * tools/check-layers.mjs —— 分层体检
 *
 * 边界不靠自觉。这个脚本扫 src/core/**，命中就退出码 1。
 * 接进 CI 或 pre-commit，能挡住「顺手在 core 里写个 innerHTML」。
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const RULES = [
  { re: /\bdocument\./g, why: 'core 里不许碰 DOM' },
  { re: /\bwindow\./g, why: 'core 里不许碰 window' },
  { re: /\blocalStorage\b/g, why: 'core 里不许直接读存储' },
  { re: /\binnerHTML\b/g, why: 'core 里不许改 DOM' },
  { re: /\bclassList\b/g, why: 'core 里不许改样式' },
  { re: /\bfetch\s*\(/g, why: '网络请求属于适配器' },
  { re: /\bXMLHttpRequest\b/g, why: '网络请求属于适配器' },
  { re: /from\s+['"][^'"]*adapters\//g, why: 'core 不能依赖适配器（依赖方向反了）' },
  { re: /from\s+['"][^'"]*\/ui\//g, why: 'core 不能依赖界面' },
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = await walk(join(ROOT, 'src', 'core'));
let problems = 0;

for (const file of files) {
  const code = await readFile(file, 'utf8');
  const lines = code.split('\n');
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code))) {
      const lineNo = code.slice(0, m.index).split('\n').length;
      const line = lines[lineNo - 1] || '';
      // 注释行放过（架构文档里会提到这些词）
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      console.error(`${relative(ROOT, file)}:${lineNo}  ${rule.why}\n    ${line.trim()}`);
      problems++;
    }
  }
}

if (problems) {
  console.error(`\n✗ 发现 ${problems} 处越界`);
  process.exit(1);
}

/* ==========================================================
   第二关：Chrome 72 兼容
   目标机是 Android 7.1 / WebView 72，下面这些写法在老机器上
   不报错、也不生效，只会让布局悄悄塌掉，所以必须在提交前拦住。
   ========================================================== */

const CSS_FILES = ['src/ui/shared/base.css', 'src/ui/phone/phone.css', 'src/ui/tablet/tablet.css', 'src/ui/desktop/desktop.css'];

const JS_RULES = [
  { re: /\breplaceChildren\s*\(/g, why: 'Chrome 86+ 才有，老 WebView 用 while-remove 代替' },
  { re: /\.at\s*\(/g, why: 'Array.prototype.at 是 Chrome 92+' },
  { re: /\bObject\.hasOwn\s*\(/g, why: 'Object.hasOwn 是 Chrome 93+' },
  { re: /\bstructuredClone\s*\(/g, why: 'structuredClone 是 Chrome 98+' },
  { re: /\bPromise\.allSettled\s*\(/g, why: 'allSettled 是 Chrome 76+' },
  { re: /\.replaceAll\s*\(/g, why: 'replaceAll 是 Chrome 85+' },
];

let compat = 0;

for (const rel of CSS_FILES) {
  const css = await readFile(join(ROOT, rel), 'utf8');
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selector, decls] of blocks) {
    if (/\binset\s*:/.test(decls)) {
      console.error(`${rel}  ${selector.trim()} 用了 inset 简写（Chrome 87+），改成 top/right/bottom/left`);
      compat++;
    }
    if (/display\s*:\s*(inline-)?flex/.test(decls) && /(^|[\s;])gap\s*:/.test(decls)) {
      console.error(`${rel}  ${selector.trim()} 在 flex 里用 gap（Chrome 84+），改成相邻兄弟外边距`);
      compat++;
    }
  }
}

const jsFiles = await walk(join(ROOT, 'src'));
for (const file of jsFiles) {
  const code = await readFile(file, 'utf8');
  for (const rule of JS_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code))) {
      const lineNo = code.slice(0, m.index).split('\n').length;
      console.error(`${relative(ROOT, file)}:${lineNo}  ${rule.why}`);
      compat++;
    }
  }
}

if (compat) {
  console.error(`\n✗ 发现 ${compat} 处 Chrome 72 不兼容`);
  process.exit(1);
} else {
  console.log(`✓ core 层干净（${files.length} 个文件）· Chrome 72 兼容（${jsFiles.length} 个 js / ${CSS_FILES.length} 个 css）`);
}
