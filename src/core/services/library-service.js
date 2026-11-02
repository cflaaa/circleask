/**
 * core/services/library-service.js —— 书架用例
 *
 * 层：core（功能层）
 * 规矩：只编排，不实现。要读文件？问渲染端口。要存？问存储端口。
 */

import { createBook, normalizeBook, BOOK_KIND } from '../domain/book.js';
import { EVT } from '../bus.js';

export function createLibraryService({ storage, renderer, clock, bus, ids }) {
  async function list() {
    const raw = await storage.listBooks();
    const books = raw.map(normalizeBook).filter(Boolean);

    // 进度要一起带出来，书架那行小字要用；这里并发查，别串行 await
    const withProgress = await Promise.all(
      books.map(async (b) => ({ ...b, progressPage: await storage.getProgress(b.id) }))
    );

    // 最近读过的排前面，没读过的按加入时间
    withProgress.sort((a, b) => {
      const ta = a.lastReadAt || a.addedAt;
      const tb = b.lastReadAt || b.addedAt;
      return tb - ta;
    });
    return withProgress;
  }

  /**
   * 导入一份文档。
   * 页数从渲染端口问出来——core 不去解析 PDF，那是适配器的事。
   * @param {Object} p
   * @param {string} p.name     书名（默认取文件名）
   * @param {ArrayBuffer} p.data 文档字节（探页数用）
   * @param {Blob} [p.blob]     原始文件，存起来供下次打开
   */
  async function importDocument({ name, data, blob, kind = BOOK_KIND.TEXT }) {
    const handle = await renderer.open({ data });
    let pageCount;
    try {
      pageCount = handle.pageCount;
    } finally {
      // 这里只是探个页数，探完就放掉，别占着渲染缓存
      handle.close();
    }

    const title = String(name || '未命名文档').replace(/\.pdf$/i, '');
    const book = createBook({
      id: ids.next(),
      title,
      pageCount,
      kind,
      addedAt: clock.now(),
    });

    await storage.saveBook(book);
    await storage.setProgress(book.id, 1);
    if (blob) await storage.putDocument(book.id, blob);
    bus.emit(EVT.BOOKS_CHANGED, { reason: 'import', book });
    return book;
  }

  /** 取出文档字节，交给 reader.open 用。适配器已经转好 ArrayBuffer */
  async function loadDocument(id) {
    const bytes = await storage.getDocument(id);
    if (!bytes) throw new Error('这本书的原始文件不见了，请重新导入');
    return bytes;
  }

  async function rename(id, title) {
    const book = normalizeBook(await storage.getBook(id));
    if (!book) throw new Error(`[library] 书不存在：${id}`);
    const name = String(title || '').trim();
    if (!name) throw new Error('[library] 书名不能为空');
    book.title = name;
    await storage.saveBook(book);
    bus.emit(EVT.BOOKS_CHANGED, { reason: 'rename', book });
    return book;
  }

  async function remove(id) {
    await storage.deleteBook(id);
    bus.emit(EVT.BOOKS_CHANGED, { reason: 'remove', id });
  }

  async function touch(id) {
    const book = normalizeBook(await storage.getBook(id));
    if (!book) return null;
    book.lastReadAt = clock.now();
    await storage.saveBook(book);
    return book;
  }

  return { list, importDocument, loadDocument, rename, remove, touch };
}
