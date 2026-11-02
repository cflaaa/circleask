/**
 * ui/tablet/index.js —— 平板界面
 *
 * 层：ui（界面层）
 * 布局：左右分栏。书页在左（2/3），问答在右（1/3），**问答不遮挡书页**。
 * 规矩：不 import phone / desktop。改平板只改本文件和 tablet.css。
 */

import { h, clear, toast } from '../shared/dom.js';
import { readBytes } from '../../shared/bytes.js';
import { createPageView } from '../shared/page-view.js';
import { setRichText } from '../shared/math.js';
import { EVT } from '../../core/bus.js';
import { bookMetaText, kindColor, kindLabel } from '../../core/domain/book.js';

export async function mount({ root, core }) {
  const fileInput = h('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });

  // ---------- 书架 ----------
  const shelfGrid = h('div', { class: 'shelf' });
  const shelfScreen = h(
    'section',
    { class: 'screen', dataset: { screen: 'shelf' } },
    h(
      'div',
      { class: 'topbar' },
      h('h1', { text: '圈问 · 书库' }),
      h('span', { class: 'sub', text: '圈一段，直接问' })
    ),
    shelfGrid,
    h('div', { class: 'fab-bar' }, h('button', { class: 'btn btn--primary', onClick: () => fileInput.click() }, '＋ 导入 PDF'))
  );

  // ---------- 阅读 ----------
  const pageHost = h('div', { class: 'stage' });
  const qaBody = h('div', { class: 'panel-body' });
  const pageIndicator = h('div', { class: 'page-indicator', text: '1 / 1' });
  const selBtn = h('button', { class: 'btn' }, '圈选');

  const readerScreen = h(
    'section',
    { class: 'screen', dataset: { screen: 'reader' }, hidden: true },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'btn btn--ghost', onClick: backToShelf }, '‹ 书库'),
      h('h1', { class: 'reader-title', text: '' }),
      h('span', { class: 'sub', text: '' })
    ),
    h(
      'div',
      { class: 'split' },
      pageHost,
      h(
        'aside',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, '问答'),
        qaBody,
        h(
          'div',
          { class: 'panel-foot' },
          h('button', { class: 'btn', onClick: () => go(-1) }, '‹ 上一页'),
          h('button', { class: 'btn', onClick: () => go(1) }, '下一页 ›'),
          pageIndicator,
          selBtn
        )
      )
    )
  );

  root.append(shelfScreen, readerScreen, fileInput);

  const pageView = createPageView({ core, onSelection: ({ rect }) => askSelection(rect) });
  pageHost.append(pageView.el);

  let books = [];
  let streamingCard = null;

  // ---------- 书架 ----------
  async function refreshShelf() {
    books = await core.library.list();
    clear(shelfGrid);
    if (!books.length) {
      shelfGrid.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, '书库是空的，先导入一本 PDF'));
      return;
    }
    for (const b of books) {
      shelfGrid.append(
        h(
          'div',
          { class: 'shelf-card', onClick: () => openBook(b) },
          h('div', { class: 'shelf-thumb', text: '📕' }),
          h('div', { class: 'shelf-title', text: b.title }),
          h(
            'div',
            { class: 'shelf-meta' },
            h('span', { class: 'dot', style: { background: kindColor(b.kind) } }),
            h('span', { text: bookMetaText(b, b.progressPage) })
          )
        )
      );
    }
  }

  // ---------- 打开 / 关闭 ----------
  async function openBook(book) {
    try {
      const data = await core.library.loadDocument(book.id);
      const state = await core.reader.open(book, { data });

      readerScreen.querySelector('.reader-title').textContent = state.book.title;
      readerScreen.querySelector('.topbar .sub').textContent =
        `${kindLabel(state.book.kind)} · ${state.pageCount} 页`;
      shelfScreen.hidden = true;
      readerScreen.hidden = false;

      clear(qaBody);
      qaBody.append(h('div', { class: 'panel-empty' }, '点右下「圈选」，', h('br'), '在书页上圈一块看不懂的地方'));

      await pageView.render(state.pageNo);
      updateIndicator();
      await core.reader.markRead();
    } catch (err) {
      toast(err.message || '打不开这本书');
    }
  }

  function backToShelf() {
    core.reader.close();
    pageView.setSelectMode(false);
    selBtn.classList.remove('is-on');
    readerScreen.hidden = true;
    shelfScreen.hidden = false;
    refreshShelf();
  }

  function updateIndicator() {
    const { pageNo, pageCount } = core.reader.current();
    pageIndicator.textContent = `${pageNo} / ${pageCount}`;
  }

  async function go(delta) {
    const { pageNo } = core.reader.current();
    await core.reader.goto(pageNo + delta);
    await pageView.render(core.reader.current().pageNo);
    updateIndicator();
  }

  // ---------- 圈选 ----------
  selBtn.addEventListener('click', () => {
    const on = !pageView.isSelecting();
    pageView.setSelectMode(on);
    selBtn.classList.toggle('is-on', on);
    if (on) toast('用手指在书页上圈一块');
  });

  function addQaCard(pageNo) {
    qaBody.querySelector('.panel-empty')?.remove();
    const thumb = h('img', { class: 'qa-thumb', alt: '选区' });
    const ans = h('div', { class: 'ans', text: '' });
    const card = h(
      'div',
      { class: 'qa' },
      h('div', { class: 'qa-q' }, h('span', { class: 'badge', text: `第 ${pageNo} 页` }), '圈选提问'),
      thumb,
      ans
    );
    qaBody.append(card);
    qaBody.scrollTop = qaBody.scrollHeight;
    return { card, ans, thumb };
  }

  async function askSelection(rect) {
    const { book, handle, pageNo } = core.reader.current();
    if (!book) return;
    pageView.setSelectMode(false);
    selBtn.classList.remove('is-on');

    const ui = addQaCard(pageNo);
    streamingCard = ui;
    ui.ans.append(h('span', { class: 'caret' }));

    try {
      const result = await core.ask.askSelection({ book, doc: handle, pageNo, rect });
      if (result?.imageUrl) ui.thumb.src = result.imageUrl;
      else ui.thumb.remove();
    } catch (err) {
      ui.thumb.remove();
      if (err.code === 'SELECTION_TOO_SMALL') {
        ui.ans.textContent = '圈得太小了，再圈大一点。';
        toast('圈得太小了，再圈大一点');
      } else {
        ui.ans.textContent = `提问失败：${err.message}`;
      }
    } finally {
      streamingCard = null;
      ui.ans.querySelector('.caret')?.remove();
    }
  }

  // ---------- 流式 ----------
  const offs = [
    core.bus.on(EVT.ANSWER_DELTA, ({ text }) => {
      if (!streamingCard) return;
      setRichText(streamingCard.ans, text);
      streamingCard.ans.append(h('span', { class: 'caret' }));
      qaBody.scrollTop = qaBody.scrollHeight;
    }),
  ];

  // ---------- 导入 ----------
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    toast('正在导入…', 4000);
    try {
      await core.library.importDocument({ name: file.name, data: await readBytes(file), blob: file });
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
      pageView.destroy();
      core.reader.close();
      root.innerHTML = '';
    },
    async openFirst() {
      if (books[0]) await openBook(books[0]);
    },
  };
}
