/**
 * tools/chrome72-gap.mjs —— 把 flex 容器里的 gap 换成相邻兄弟外边距
 *
 * 为什么需要：目标机 Android 7.1 / WebView 72，
 * flex 的 gap 要 Chrome 84 才支持（grid 的 gap 从 66 就有）。
 * 在 72 上 gap 被静默忽略，元素会全挤在一起，不报错、很难查。
 *
 * 做法：找出「display:flex 且有 gap」的规则，删掉 gap，
 * 在文件末尾追加 `选择器 > * + * { margin-left: Npx }`（纵向则 margin-top）。
 * 带 @supports 的写法在这里不管用：老浏览器认为 gap 是合法属性，
 * `@supports (gap: 1px)` 会返回 true，兜底根本不会生效。
 *
 * 幂等：已经处理过的规则没有 gap 了，再跑一次不会重复追加。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILES = ['src/ui/shared/base.css', 'src/ui/phone/phone.css', 'src/ui/tablet/tablet.css', 'src/ui/desktop/desktop.css'];
const MARK = '/* ---- 兼容层：flex gap → 相邻兄弟外边距 ---- */';

/** 只处理扁平的规则块，够用；我们的 CSS 没有嵌套规则 */
const RULE = /([^{}]+)\{([^{}]*)\}/g;

function process(text) {
  const added = [];
  const body = text.replace(RULE, (whole, selector, decls) => {
    if (!/display\s*:\s*(inline-)?flex/.test(decls)) return whole;
    const m = decls.match(/(^|[\s;])gap\s*:\s*([\d.]+)px\s*;/);
    if (!m) return whole;

    const px = m[2];
    const column = /flex-direction\s*:\s*column/.test(decls);
    const prop = column ? 'margin-top' : 'margin-left';

    // 去掉 gap 声明；顺手收掉留下的空行，别让文件里出现一行空白
    const cleaned = decls.replace(m[0], m[1] === ';' ? ';' : '').replace(/[ \t]*\r?\n[ \t]*(?=\r?\n)/g, '');
    // 选择器可能带前置注释（正则把注释一起吞了），这里剥掉，避免注释被复制到文件尾
    const sel = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    for (const one of sel.split(',')) {
      const name = one.trim();
      if (name) added.push(`${name} > * + * { ${prop}: ${px}px; }`);
    }
    return `${selector}{${cleaned}}`;
  });

  if (!added.length) return null;
  return body.trimEnd() + '\n\n' + MARK + '\n' + added.join('\n') + '\n';
}

let changed = 0;
for (const rel of FILES) {
  const full = join(ROOT, rel);
  const src = await readFile(full, 'utf8');
  const out = process(src);
  if (!out) {
    console.log(`[gap] 跳过 ${rel}（没有需要处理的 flex gap）`);
    continue;
  }
  await writeFile(full, out, 'utf8');
  changed += 1;
  console.log(`[gap] 处理 ${rel}`);
}
console.log(`[gap] 完成，改动 ${changed} 个文件`);
