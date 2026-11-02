/**
 * adapters/storage/indexeddb-storage.js —— IndexedDB 实现
 *
 * 层：adapters
 * 实现 core/ports/storage-port.js。
 *
 * 三张表：
 *   books    keyPath=id
 *   marks    keyPath=id，索引 bookId（按书查标记是最高频的操作）
 *   progress keyPath=bookId
 */

import { readBytes } from '../../shared/bytes.js';

const DB_NAME = 'circleask';
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    // 有些环境（隐私模式、部分 WebView、无头浏览器）里 open 既不成功也不报错，
    // 不设超时就会永远挂在启动阶段。宁可退回内存存储，也不能白屏。
    const timer = setTimeout(() => reject(new Error('IndexedDB 打开超时（3s）')), 3000);
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('marks')) {
        const marks = db.createObjectStore('marks', { keyPath: 'id' });
        marks.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('documents')) {
        // 存 PDF 原始字节。IndexedDB 能直接存 Blob，不用转 base64（省 33% 体积）
        db.createObjectStore('documents', { keyPath: 'bookId' });
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB 被其他标签页占用'));
    };
  });
}

/** 把一次事务包成 Promise，少写一堆 onsuccess */
function tx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(result?.__req ? result.__req.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const wrap = (req) => ({ __req: req });

export async function createIndexedDbStorage() {
  const db = await openDb();

  return {
    async listBooks() {
      return (await tx(db, 'books', 'readonly', (s) => wrap(s.getAll()))) || [];
    },

    async getBook(id) {
      return (await tx(db, 'books', 'readonly', (s) => wrap(s.get(id)))) || null;
    },

    async saveBook(book) {
      await tx(db, 'books', 'readwrite', (s) => s.put(book));
      return book;
    },

    async deleteBook(id) {
      // 级联：书没了，它的标记和进度也不该留着
      await tx(db, 'books', 'readwrite', (s) => s.delete(id));
      const marks = await tx(db, 'marks', 'readonly', (s) => wrap(s.index('bookId').getAllKeys(id)));
      await tx(db, 'marks', 'readwrite', (s) => {
        for (const key of marks || []) s.delete(key);
      });
      await tx(db, 'progress', 'readwrite', (s) => s.delete(id));
      await tx(db, 'documents', 'readwrite', (s) => s.delete(id));
    },

    async listMarks(bookId) {
      const all = await tx(db, 'marks', 'readonly', (s) => wrap(s.index('bookId').getAll(bookId)));
      return (all || []).sort((a, b) => a.pageNo - b.pageNo || a.createdAt - b.createdAt);
    },

    async saveMark(mark) {
      await tx(db, 'marks', 'readwrite', (s) => s.put(mark));
      return mark;
    },

    async deleteMark(id) {
      await tx(db, 'marks', 'readwrite', (s) => s.delete(id));
    },

    async getProgress(bookId) {
      const row = await tx(db, 'progress', 'readonly', (s) => wrap(s.get(bookId)));
      return row?.pageNo ?? 1;
    },

    async setProgress(bookId, pageNo) {
      await tx(db, 'progress', 'readwrite', (s) => s.put({ bookId, pageNo, at: Date.now() }));
    },

    async putDocument(bookId, blob) {
      await tx(db, 'documents', 'readwrite', (s) => s.put({ bookId, blob }));
    },

    async getDocument(bookId) {
      const row = await tx(db, 'documents', 'readonly', (s) => wrap(s.get(bookId)));
      if (!row?.blob) return null;
      // 老 WebView 的 Blob 没有 arrayBuffer()，走 shared/bytes 里的兼容实现
      return readBytes(row.blob);
    },
  };
}
