/**
 * core/services/reader-service.js —— 阅读用例
 *
 * 层：core（功能层）
 * 职责：管住「当前打开的是哪本书、第几页」，以及页码的合法化。
 * 不管：页面怎么画（那是 ui）、图片怎么生成（那是 renderer）。
 */

import { EVT } from '../bus.js';
import { normalizeBook } from '../domain/book.js';

export function createReaderService({ storage, renderer, clock, bus }) {
  /** 当前打开的文档句柄 */
  let handle = null;
  /** 当前书的模型 */
  let book = null;
  let pageNo = 1;

  function current() {
    return { book, handle, pageNo, pageCount: handle?.pageCount ?? 0 };
  }

  function clampPage(n) {
    const max = handle?.pageCount ?? 1;
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return 1;
    return Math.min(max, Math.max(1, v));
  }

  async function open(bookLike, source) {
    if (handle) close(); // 换书前先把上一本放掉，别让两本的缓存同时活着

    const normalized = normalizeBook(bookLike);
    if (!normalized) throw new Error('[reader] 书数据不合法');

    handle = await renderer.open(source);
    book = normalized;

    // 文档实际页数可能和记录不一致（重新导入过），以文档为准
    if (handle.pageCount !== book.pageCount) {
      book.pageCount = handle.pageCount;
      await storage.saveBook(book);
    }

    pageNo = clampPage(await storage.getProgress(book.id));

    bus.emit(EVT.BOOK_OPENED, {
      book,
      pageNo,
      pageCount: handle.pageCount,
    });
    return current();
  }

  /** 取某一页的图片。opts.width 由界面按屏幕宽度算好传进来 */
  async function renderPage(n, opts = {}) {
    if (!handle) throw new Error('[reader] 还没打开书');
    return handle.renderPage(clampPage(n), opts);
  }

  /** 取某一页的局部图（圈选提问用），目标宽度默认给大一点，放大后依然清晰 */
  async function renderRegion(n, rect, opts = {}) {
    if (!handle) throw new Error('[reader] 还没打开书');
    return handle.renderRegion(clampPage(n), rect, { width: 1600, ...opts });
  }

  async function goto(n) {
    if (!handle) return 1;
    const next = clampPage(n);
    if (next === pageNo) return pageNo;
    pageNo = next;
    await storage.setProgress(book.id, next);
    bus.emit(EVT.PROGRESS_CHANGED, { bookId: book.id, pageNo: next });
    return next;
  }

  function next() {
    return goto(pageNo + 1);
  }

  function prev() {
    return goto(pageNo - 1);
  }

  function close() {
    if (!handle) return;
    const closing = book?.id;
    handle.close();
    handle = null;
    book = null;
    pageNo = 1;
    bus.emit(EVT.BOOK_CLOSED, { bookId: closing });
  }

  /** 阅读时长/最近阅读时间在打开时记一笔 */
  async function markRead() {
    if (!book) return;
    book.lastReadAt = clock.now();
    await storage.saveBook(book);
  }

  return { current, open, renderPage, renderRegion, goto, next, prev, close, markRead };
}
