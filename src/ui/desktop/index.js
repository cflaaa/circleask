/**
 * ui/desktop/index.js —— 桌面界面
 *
 * 层：ui（界面层）
 * 布局：三栏常驻（书库 / 书页 / 问答），配键盘：← → 翻页，S 圈选，Esc 关书。
 * 规矩：不 import phone / tablet。
 */

import { h, clear, toast } from '../shared/dom.js';
import { readBytes } from '../../shared/bytes.js';
import { createPageView } from '../shared/page-view.js';
import { setRichText } from '../shared/math.js';
import { EVT } from '../../core/bus.js';
import { bookMetaText, kindColor, kindLabel } from '../../core/domain/book.js';

export async function mount({ root, core }) {
  const fileInput = h('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });

  // ---------- 左栏 ----------
  const sideList = h('div', { class: 'side-list' });
  const side = h(
    'aside',
    { class: 'side' },
    h('div', { class: 'side-head' }, h('h1', { text: '圈问' }), h('div', { class: 'sub', text: '圈一段，直接问' })),
    sideList,
    h('div', { class: 'side-foot' }, h('button', { class: 'btn', style: { width: '100%' }, onClick: () => fileInput.click() }, '＋ 导入 PDF'))
  );

  // ---------- 中栏 ----------
  const stageBody = h('div', { class: 'stage-body' });
  const stageTitle = h('div', { class: 'title', text: '未打开' });
  const stagePage = h('div', { class: 'pageno', text: '' });
  const selBtn = h('button', { class: 'btn' }, '圈选 (S)');
  const stageEmpty = h(
    'div',
    { class: 'stage-empty' },
    h('div', { text: '从左边选一本书打开' }),
    h(
      'div',
      { class: 'keys' },
      h('kbd', { text: '←' }),
      ' ',
      h('kbd', { text: '→' }),
      ' 翻页 · ',
      h('kbd', { text: 'S' }),
      ' 圈选 · ',
      h('kbd', { text: 'Esc' }),
      ' 关闭'
    )
  );

  const stage = h(
    'main',
    { class: 'stage' },
    h(
      'div',
      { class: 'stage-bar' },
      stageTitle,
      h('button', { class: 'btn btn--ghost', onClick: () => go(-1) }, '‹'),
      h('button', { class: 'btn btn--ghost', onClick: () => go(1) }, '›'),
      stagePage,
      selBtn
    ),
    stageEmpty,
    stageBody
  );

  // ---------- 右栏 ----------
  const qaBody = h('div', { class: 'panel-body' });
  const panel = h(
    'aside',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, '问答'),
    qaBody,
    h(
      'div',
      { class: 'panel-foot' },
      h('button', { class: 'btn', onClick: () => go(-1) }, '上一页'),
      h('button', { class: 'btn', onClick: () => go(1) }, '下一页')
    )
  );

  root.append(side, stage, panel, fileInput);

  // 没打开书之前不显示页面容器，否则会露出 <img> 的破图占位
  stageBody.hidden = true;
  qaBody.append(h('div', { class: 'panel-empty' }, '打开一本书后，', h('br'), '按 S 圈选提问'));

  const pageView = createPageView({ core, onSelection: ({ rect }) => askSelection(rect) });
  stageBody.append(pageView.el);

  let books = [];
  let activeId = null;
  let streamingCard = null;

  // ---------- 书库 ----------
  async function refreshShelf() {
    books = await core.library.list();
    clear(sideList);
    if (!books.length) {
      sideList.append(h('div', { class: 'empty' }, '还没有书'));
      return;
    }
    for (const b of books) {
      sideList.append(
        h(
          'div',
          {
            class: `side-item${b.id === activeId ? ' is-active' : ''}`,
            onClick: () => openBook(b),
          },
          h('span', { class: 'dot', style: { background: kindColor(b.kind) } }),
          h('span', { class: 't', text: b.title }),
          h('span', { class: 'm', text: `${b.pageCount}p` })
        )
      );
    }
  }

  // ---------- 打开 / 关闭 ----------
  async function openBook(book) {
    try {
      const data = await core.library.loadDocument(book.id);
      const state = await core.reader.open(book, { data });
      activeId = state.book.id;

      stageTitle.textContent = state.book.title;
      stagePage.textContent = `${state.book.kind ? kindLabel(state.book.kind) : ''} · 1/${state.pageCount}`;
      stageEmpty.remove();
      stageBody.hidden = false;

      clear(qaBody);
      qaBody.append(h('div', { class: 'panel-empty' }, '按 S 或点「圈选」，', h('br'), '在书页上圈一块'));

      await pageView.render(state.pageNo);
      updateBar();
      await core.reader.markRead();
      refreshShelf();
    } catch (err) {
      toast(err.message || '打不开这本书');
    }
  }

  function closeBook() {
    core.reader.close();
    activeId = null;
    pageView.setSelectMode(false);
    selBtn.classList.remove('is-on');
    stageTitle.textContent = '未打开';
    stagePage.textContent = '';
    // Chrome 86 才有 replaceChildren，老 WebView 上用 while-remove 代替
    while (stageBody.firstChild) stageBody.removeChild(stageBody.firstChild);
    stageBody.hidden = true;
    if (!stage.querySelector('.stage-empty')) stage.prepend(stageEmpty.cloneNode(true));
    refreshShelf();
  }

  function updateBar() {
    const { pageNo, pageCount } = core.reader.current();
    stagePage.textContent = `${pageNo} / ${pageCount}`;
  }

  async function go(delta) {
    if (!core.reader.current().book) return;
    const { pageNo } = core.reader.current();
    await core.reader.goto(pageNo + delta);
    await pageView.render(core.reader.current().pageNo);
    updateBar();
  }

  // ---------- 圈选 ----------
  function toggleSelect() {
    if (!core.reader.current().book) return;
    const on = !pageView.isSelecting();
    pageView.setSelectMode(on);
    selBtn.classList.toggle('is-on', on);
    if (on) toast('在书页上拖出一个框');
  }

  selBtn.addEventListener('click', toggleSelect);

  function addQaCard(pageNo) {
    qaBody.querySelector('.panel-empty')?.remove();
    const thumb = h('img', { class: 'qa-thumb', alt: '选区' });
    const ans = h('div', { class: 'ans' });
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
      ui.ans.textContent =
        err.code === 'SELECTION_TOO_SMALL' ? '圈得太小了，再圈大一点。' : `提问失败：${err.message}`;
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

  // ---------- 键盘 ----------
  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 's' || e.key === 'S') toggleSelect();
    else if (e.key === 'Escape') closeBook();
  }
  document.addEventListener('keydown', onKey);

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
      document.removeEventListener('keydown', onKey);
      pageView.destroy();
      core.reader.close();
      root.innerHTML = '';
    },
    async openFirst() {
      if (books[0]) await openBook(books[0]);
    },
  };
}
