/**
 * ui/phone/index.js —— 手机界面
 *
 * 层：ui（界面层）
 * 布局：单栏。书架 ↔ 阅读器两个屏幕切换，回答用底部抽屉。
 * 规矩：不 import tablet / desktop；不写业务判断（选区大小、页数合法化都在 core）。
 */

import { h, clear, toast } from '../shared/dom.js';
import { readBytes } from '../../shared/bytes.js';
import { createPageView } from '../shared/page-view.js';
import { setRichText } from '../shared/math.js';
import { EVT } from '../../core/bus.js';
import { bookMetaText, kindColor, kindLabel } from '../../core/domain/book.js';

export async function mount({ root, core }) {
  const fileInput = h('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });

  // ---------- 书架屏 ----------
  const shelfList = h('div', { class: 'shelf' });
  const shelfScreen = h(
    'section',
    { class: 'screen', dataset: { screen: 'shelf' } },
    h('div', { class: 'topbar' }, h('h1', { text: '圈问' }), h('span', { class: 'sub', text: '圈一段，直接问' })),
    shelfList,
    h('div', { class: 'fab-bar' }, h('button', { class: 'btn btn--primary', onClick: () => fileInput.click() }, '导入 PDF'))
  );

  // ---------- 阅读屏 ----------
  const pageHost = h('div', { class: 'reader-scroll' });
  const pageLabel = h('div', { class: 'page-num', text: '1 / 1' });
  const selBtn = h('button', { class: 'btn' }, '圈选');

  const sheetThumb = h('img', { class: 'sheet-thumb', alt: '选区' });
  const sheetBody = h('div', { class: 'sheet-body' });
  const sheet = h(
    'div',
    { class: 'sheet' },
    h('div', { class: 'sheet-head' }, h('div', { class: 'grip' })),
    sheetBody
  );

  const readerScreen = h(
    'section',
    { class: 'screen', dataset: { screen: 'reader' }, hidden: true },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'btn btn--ghost', onClick: backToShelf }, '‹ 书架'),
      h('h1', { class: 'reader-title', text: '' }),
      h('span', { class: 'sub', text: '' })
    ),
    pageHost,
    h(
      'div',
      { class: 'bottombar' },
      h('button', { class: 'btn', onClick: () => go(-1) }, '‹'),
      pageLabel,
      h('button', { class: 'btn', onClick: () => go(1) }, '›'),
      selBtn
    )
  );

  root.append(shelfScreen, readerScreen, sheet, fileInput);

  // ---------- 页面视图 ----------
  const pageView = createPageView({
    core,
    onSelection: ({ rect }) => askSelection(rect),
  });
  pageHost.append(pageView.el);

  // ---------- 状态 ----------
  let books = [];
  let current = null;

  // ---------- 书架 ----------
  async function refreshShelf() {
    books = await core.library.list();
    clear(shelfList);

    if (!books.length) {
      shelfList.append(
        h('div', { class: 'empty' }, '书架是空的', h('br'), '点下面「导入 PDF」加一本教材')
      );
      return;
    }

    for (const b of books) {
      const card = h(
        'div',
        { class: 'shelf-card', onClick: () => openBook(b) },
        h('div', { class: 'shelf-thumb', text: '📕' }),
        h(
          'div',
          { class: 'shelf-info' },
          h('div', { class: 'shelf-title', text: b.title }),
          h(
            'div',
            { class: 'shelf-meta' },
            h('span', { class: 'dot', style: { background: kindColor(b.kind) } }),
            h('span', { text: bookMetaText(b, b.progressPage) })
          )
        )
      );
      shelfList.append(card);
    }
  }

  // ---------- 打开 / 关闭 ----------
  async function openBook(book) {
    try {
      const data = await core.library.loadDocument(book.id);
      const state = await core.reader.open(book, { data });
      current = state.book;

      readerScreen.querySelector('.reader-title').textContent = state.book.title;
      readerScreen.querySelector('.topbar .sub').textContent = `${kindLabel(state.book.kind)} · ${state.pageCount} 页`;
      shelfScreen.hidden = true;
      readerScreen.hidden = false;

      await pageView.render(state.pageNo);
      updatePageLabel();
      await core.reader.markRead();
    } catch (err) {
      toast(err.message || '打不开这本书');
    }
  }

  function backToShelf() {
    core.reader.close();
    current = null;
    pageView.setSelectMode(false);
    selBtn.classList.remove('is-on');
    readerScreen.hidden = true;
    shelfScreen.hidden = false;
    refreshShelf();
  }

  function updatePageLabel() {
    const { pageNo, pageCount } = core.reader.current();
    pageLabel.textContent = `${pageNo} / ${pageCount}`;
  }

  async function go(delta) {
    const { pageNo } = core.reader.current();
    await core.reader.goto(pageNo + delta);
    await pageView.render(core.reader.current().pageNo);
    updatePageLabel();
  }

  // ---------- 圈选 ----------
  selBtn.addEventListener('click', () => {
    const on = !pageView.isSelecting();
    pageView.setSelectMode(on);
    selBtn.classList.toggle('is-on', on);
    if (on) toast('用手指在页面上圈一块');
  });

  async function askSelection(rect) {
    const { book, handle, pageNo } = core.reader.current();
    if (!book) return;
    pageView.setSelectMode(false);
    selBtn.classList.remove('is-on');

    openSheet('');
    try {
      const result = await core.ask.askSelection({
        book,
        doc: handle,
        pageNo,
        rect,
      });
      if (result?.imageUrl) {
        sheetThumb.src = result.imageUrl;
        sheetBody.prepend(sheetThumb);
      }
    } catch (err) {
      if (err.code === 'SELECTION_TOO_SMALL') toast('圈得太小了，再圈大一点');
      else toast(err.message || '提问失败');
    }
  }

  // ---------- 回答抽屉 ----------
  let streaming = null;

  function openSheet(initialText) {
    sheetBody.innerHTML = '';
    sheetBody.append(h('div', { class: 'ans' }));
    setRichText(sheetBody.firstChild, initialText);
    sheet.classList.add('is-open');
  }

  const offs = [
    core.bus.on(EVT.ANSWER_START, () => {
      streaming = { text: '' };
    }),
    core.bus.on(EVT.ANSWER_DELTA, ({ text }) => {
      if (!streaming) return;
      streaming.text = text;
      const ans = sheetBody.querySelector('.ans');
      if (ans) setRichText(ans, text);
    }),
    core.bus.on(EVT.ANSWER_END, () => {
      streaming = null;
    }),
    core.bus.on(EVT.ANSWER_ERROR, () => {
      streaming = null;
    }),
  ];

  // 点抽屉外面收起
  const offSheet = (() => {
    const handler = (e) => {
      if (sheet.classList.contains('is-open') && !sheet.contains(e.target)) {
        sheet.classList.remove('is-open');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  })();

  // ---------- 导入 ----------
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    toast('正在导入…', 4000);
    try {
      await core.library.importDocument({
        name: file.name,
        data: await readBytes(file),
        blob: file,
      });
      await refreshShelf();
      toast('导入成功');
    } catch (err) {
      toast(`导入失败：${err.message}`);
    }
  });

  await refreshShelf();

  return {
    unmount() {
      offs.forEach((off) => off());
      offSheet();
      pageView.destroy();
      core.reader.close();
      root.innerHTML = '';
    },
    async openFirst() {
      if (books[0]) await openBook(books[0]);
    },
  };
}
