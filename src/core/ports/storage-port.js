/**
 * core/ports/storage-port.js —— 存储端口
 *
 * 层：core（功能层）
 * 规矩：这是「接口定义」，不是实现。core 只认这个形状，
 *      底下是 IndexedDB、SQLite 还是内存，core 一概不知道。
 */

export const StoragePort = {
  /** @returns {Promise<Array>} 全部书籍，按最近阅读排序 */
  listBooks() {},

  /** @returns {Promise<Object|null>} */
  getBook(id) {},

  /** 新增或整体覆盖 */
  saveBook(book) {},

  /** 删书时级联删掉它的标记和进度 */
  deleteBook(id) {},

  /** @returns {Promise<Array>} 某本书上的全部标记 */
  listMarks(bookId) {},

  saveMark(mark) {},
  deleteMark(id) {},

  /** @returns {Promise<number>} 没读过返回 1 */
  getProgress(bookId) {},
  setProgress(bookId, pageNo) {},

  /**
   * 文档原始字节（PDF 本体）。
   * 存的是 Blob（IndexedDB 能直接放），取出来时**已经转成 ArrayBuffer**——
   * 转字节这一步属于适配器，core 不该知道 FileReader 或者 Blob 的兼容性问题。
   */
  putDocument(bookId, blob) {},
  /** @returns {Promise<ArrayBuffer|null>} */
  getDocument(bookId) {},
};
