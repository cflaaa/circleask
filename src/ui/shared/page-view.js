/**
 * ui/shared/page-view.js —— 单页渲染器（三端共用）
 *
 * 层：ui（界面层）
 * 职责：把 core.reader.renderPage 拿到的**图片地址**贴进 DOM。
 * 注意：这里从头到尾没有 canvas —— 见 docs/adr/0002-pdf-as-img.md。
 *
 * 三端都能用，因为它只管「一张图 + 一个圈选层」，不含任何布局决策。
 */

import { h, clear } from './dom.js';
import { createSelectionGesture } from './selection.js';

export function createPageView({ core, onSelection }) {
  const img = h('img', { class: 'page-img', alt: '页面', draggable: 'false' });
  const surface = h('div', { class: 'page-surface' }, img);
  const wrap = h('div', { class: 'page-wrap' }, surface);
  const hint = h('div', { class: 'page-hint', text: '正在出图…' });

  let pageNo = 1;
  let rendering = false;
  let selectMode = false;
  let lastWidth = 0;

  const gesture = createSelectionGesture(surface, (rect) => onSelection?.({ rect, pageNo }));

  async function render(page, { force = false } = {}) {
    if (!force && page === pageNo && img.src) return;
    if (rendering) return;
    rendering = true;
    pageNo = page;
    hint.style.display = '';
    wrap.classList.add('is-loading');
    try {
      // 宽度按容器实测，再乘 DPR —— 这样在平板上不会糊
      const width = Math.max(320, Math.round(surface.clientWidth || 800)) * (window.devicePixelRatio || 1);
      const out = await core.reader.renderPage(page, { width: Math.round(width) });
      img.src = out.url;
      img.width = out.width;
      img.height = out.height;
      lastWidth = surface.clientWidth;
      hint.style.display = 'none';
    } catch (err) {
      hint.textContent = `出图失败：${err.message}`;
    } finally {
      wrap.classList.remove('is-loading');
      rendering = false;
    }
  }

  // 容器尺寸变了要按新宽度重出图，否则放大后发虚
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    if (!img.src) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(surface.clientWidth - lastWidth) > 40) render(pageNo, { force: true });
    }, 200);
  });
  ro.observe(surface);

  return {
    el: wrap,
    render,
    getPage: () => pageNo,
    setSelectMode(v) {
      selectMode = v;
      gesture.enable(v);
    },
    isSelecting: () => selectMode,
    destroy() {
      ro.disconnect();
      gesture.destroy();
      clear(wrap);
    },
  };
}
