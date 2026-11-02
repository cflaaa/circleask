/**
 * tests/core.test.js —— 只测功能层
 *
 * 注意这里**没有浏览器**：没有 jsdom、没有 canvas、没有 IndexedDB。
 * 能这样测，是分层带来的直接好处。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCore } from '../src/core/index.js';
import { createMemoryStorage } from '../src/adapters/storage/memory-storage.js';
import { createFakeRenderer } from '../src/adapters/render/fake-renderer.js';
import { createFixedClock } from '../src/adapters/clock.js';
import { EVT } from '../src/core/bus.js';
import { createBook, BOOK_KIND, bookMetaText } from '../src/core/domain/book.js';
import { rectFromPoints, isSelectionUsable, labelFromAnswer } from '../src/core/domain/mark.js';

function makeCore({ vision, pageCount = 10 } = {}) {
  let n = 0;
  const said = { text: '' };
  const stubVision = vision || {
    async ask({ onDelta }) {
      const chunks = ['这块讲', '的是 $V_{bi}$'];
      let full = '';
      for (const c of chunks) {
        full += c;
        onDelta?.(c);
      }
      said.text = full;
      return full;
    },
  };
  const core = createCore({
    storage: createMemoryStorage(),
    renderer: createFakeRenderer({ pageCount }),
    vision: stubVision,
    clock: createFixedClock(),
    ids: { next: () => `id${++n}` },
  });
  return { core, said };
}

// ---------------- 领域 ----------------

test('createBook 拒绝非法数据', () => {
  assert.throws(() => createBook({ id: 'a', title: '', pageCount: 3 }), /书名不能为空/);
  assert.throws(() => createBook({ id: 'a', title: 'x', pageCount: 0 }), /页数不合法/);
  assert.throws(() => createBook({ id: 'a', title: 'x', pageCount: 3, kind: 'zzz' }), /未知类型/);
});

test('createBook 正常建书并补全字段', () => {
  const b = createBook({ id: 'a', title: ' 半导体物理 ', pageCount: 200, kind: BOOK_KIND.TEXT });
  assert.equal(b.title, '半导体物理');
  assert.equal(b.pageCount, 200);
  assert.equal(b.lastReadAt, 0);
});

test('bookMetaText 区分读过与没读过', () => {
  const b = createBook({ id: 'a', title: 't', pageCount: 200 });
  assert.equal(bookMetaText(b, 1), '教材 · 200 页');
  assert.equal(bookMetaText(b, 65), '教材 · 65/200 页');
});

test('rectFromPoints 支持反向拖动', () => {
  const r = rectFromPoints({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 });
  assert.equal(r.x, 0.2);
  assert.equal(r.y, 0.3);
  assert.ok(Math.abs(r.w - 0.6) < 1e-9);
  assert.ok(Math.abs(r.h - 0.6) < 1e-9);
});

test('rectFromPoints 夹到 0~1', () => {
  const r = rectFromPoints({ x: -0.5, y: -2 }, { x: 1.4, y: 3 });
  assert.deepEqual(r, { x: 0, y: 0, w: 1, h: 1 });
});

test('isSelectionUsable 拦住误触', () => {
  assert.equal(isSelectionUsable({ x: 0, y: 0, w: 0.001, h: 0.001 }), false);
  assert.equal(isSelectionUsable({ x: 0, y: 0, w: 0.3, h: 0.1 }), true);
});

test('labelFromAnswer 去掉公式符号', () => {
  assert.equal(labelFromAnswer('$V_{bi}$ 是内建电势'), 'V bi 是内建');
  assert.equal(labelFromAnswer(''), '问 1');
});

// ---------------- 书架 ----------------

test('导入 → 出现在书架，页数来自渲染端口', async () => {
  const { core } = makeCore({ pageCount: 42 });
  const book = await core.library.importDocument({
    name: '半导体物理.pdf',
    data: new ArrayBuffer(8),
  });
  assert.equal(book.pageCount, 42);
  assert.equal(book.title, '半导体物理'); // 去掉 .pdf

  const list = await core.library.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].progressPage, 1);
});

test('删除书会级联清掉标记和进度', async () => {
  const { core } = makeCore();
  const book = await core.library.importDocument({ name: 'a.pdf', data: new ArrayBuffer(8) });
  await core.reader.open(book, { data: new ArrayBuffer(8) });
  await core.reader.goto(5);

  const { handle } = core.reader.current();
  await core.ask.askSelection({ book, doc: handle, pageNo: 5, rect: { x: .1, y: .1, w: .3, h: .2 } });
  assert.equal((await core.ask.listMarks(book.id)).length, 1);

  await core.library.remove(book.id);
  assert.equal((await core.ask.listMarks(book.id)).length, 0);
});

// ---------------- 阅读 ----------------

test('翻页会夹在 1..pageCount 之间并记住进度', async () => {
  const { core } = makeCore({ pageCount: 3 });
  const book = await core.library.importDocument({ name: 'a.pdf', data: new ArrayBuffer(8) });
  await core.reader.open(book, { data: new ArrayBuffer(8) });

  assert.equal(await core.reader.goto(99), 3);
  assert.equal(await core.reader.goto(-5), 1);
  assert.equal(await core.reader.goto(2), 2);

  const reopened = await core.reader.open(book, { data: new ArrayBuffer(8) });
  assert.equal(reopened.pageNo, 2); // 进度确实落库了
});

test('renderPage 返回的是图片地址，不是 canvas', async () => {
  const { core } = makeCore();
  const book = await core.library.importDocument({ name: 'a.pdf', data: new ArrayBuffer(8) });
  await core.reader.open(book, { data: new ArrayBuffer(8) });
  const out = await core.reader.renderPage(1, { width: 800 });
  assert.equal(typeof out.url, 'string');
  assert.ok(out.url.startsWith('data:image/svg+xml'));
  assert.ok(out.width > 0 && out.height > 0);
});

// ---------------- 提问 ----------------

test('圈太小直接拒绝，不浪费一次模型调用', async () => {
  let called = false;
  const { core } = makeCore({
    vision: { async ask() { called = true; return ''; } },
  });
  const book = await core.library.importDocument({ name: 'a.pdf', data: new ArrayBuffer(8) });
  await core.reader.open(book, { data: new ArrayBuffer(8) });
  const { handle } = core.reader.current();

  await assert.rejects(
    () => core.ask.askSelection({ book, doc: handle, pageNo: 1, rect: { x: .5, y: .5, w: .001, h: .001 } }),
    (err) => err.code === 'SELECTION_TOO_SMALL'
  );
  assert.equal(called, false);
});

test('圈选提问：流式事件齐全，回答落成标记', async () => {
  const { core } = makeCore();
  const book = await core.library.importDocument({ name: 'a.pdf', data: new ArrayBuffer(8) });
  await core.reader.open(book, { data: new ArrayBuffer(8) });
  const { handle } = core.reader.current();

  const seen = [];
  core.bus.on(EVT.ANSWER_START, () => seen.push('start'));
  core.bus.on(EVT.ANSWER_DELTA, () => seen.push('delta'));
  core.bus.on(EVT.ANSWER_END, () => seen.push('end'));

  const res = await core.ask.askSelection({
    book,
    doc: handle,
    pageNo: 1,
    rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.2 },
  });

  assert.equal(seen[0], 'start');
  assert.ok(seen.includes('delta'));
  assert.equal(seen.at(-1), 'end');
  assert.ok(res.text.includes('V_{bi}'));
  assert.ok(res.mark, '应该留下一条标记');

  const marks = await core.ask.listMarks(book.id);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].pageNo, 1);
});

test('提示词里必须要求 LaTeX（这是业务规则，不是界面的事）', async () => {
  let captured = '';
  const { core } = makeCore({
    vision: { async ask({ prompt }) { captured = prompt; return 'ok'; } },
  });
  const book = await core.library.importDocument({ name: 'a.pdf', data: new ArrayBuffer(8) });
  await core.reader.open(book, { data: new ArrayBuffer(8) });
  const { handle } = core.reader.current();
  await core.ask.askSelection({ book, doc: handle, pageNo: 2, rect: { x: .1, y: .1, w: .4, h: .3 } });

  assert.match(captured, /LaTeX/);
  assert.match(captured, /第 2 页/);
});
