/**
 * tools/make-sample-pdf.mjs —— 生成测试用最小 PDF
 *
 * 为什么自己造：验证「PDF → img」这条链路需要一份真实的 PDF，
 * 但不能借用别的工程的资料文件。这里手写一个 1 页的合法 PDF（xref 偏移逐字节算准）。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const content = `BT /F1 22 Tf 60 760 Td (CircleAsk render test) Tj ET
BT /F1 14 Tf 60 720 Td (If you can read this as an image, the pipeline works.) Tj ET
0.9 0.95 1 rg 60 560 300 120 re f
0 0 0 rg BT /F1 14 Tf 70 620 Td (selection area) Tj ET`;

const objects = [
  '<</Type/Catalog/Pages 2 0 R>>',
  '<</Type/Pages/Kids[3 0 R]/Count 1>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
];

let pdf = '%PDF-1.4\n';
const offsets = [];

objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefStart = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) {
  pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

await mkdir(resolve(ROOT, 'public/fixtures'), { recursive: true });
const out = resolve(ROOT, 'public/fixtures/sample.pdf');
await writeFile(out, Buffer.from(pdf, 'latin1'));
console.log(`已生成 ${out}（${Buffer.byteLength(pdf)} 字节）`);
