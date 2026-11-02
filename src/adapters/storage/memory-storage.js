/**
 * adapters/storage/memory-storage.js —— 内存实现
 *
 * 层：adapters
 * 用途：单元测试、以及「无痕浏览」场景（IndexedDB 被禁时兜底）。
 */

import { readBytes } from '../../shared/bytes.js';

export function createMemoryStorage() {
  const books = new Map();
  const marks = new Map();
  const progress = new Map();
  const docs = new Map();

  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  return {
    async listBooks() {
      return [...books.values()].map(clone);
    },
    async getBook(id) {
      return clone(books.get(id) ?? null);
    },
    async saveBook(book) {
      books.set(book.id, clone(book));
      return book;
    },
    async deleteBook(id) {
      books.delete(id);
      for (const [k, m] of marks) if (m.bookId === id) marks.delete(k);
      progress.delete(id);
      docs.delete(id);
    },
    async listMarks(bookId) {
      return [...marks.values()]
        .filter((m) => m.bookId === bookId)
        .sort((a, b) => a.pageNo - b.pageNo || a.createdAt - b.createdAt)
        .map(clone);
    },
    async saveMark(mark) {
      marks.set(mark.id, clone(mark));
      return mark;
    },
    async deleteMark(id) {
      marks.delete(id);
    },
    async getProgress(bookId) {
      return progress.get(bookId) ?? 1;
    },
    async setProgress(bookId, pageNo) {
      progress.set(bookId, pageNo);
    },
    async putDocument(bookId, blob) {
      docs.set(bookId, blob);
    },
    async getDocument(bookId) {
      const blob = docs.get(bookId);
      return blob ? readBytes(blob) : null;
    },
  };
}
