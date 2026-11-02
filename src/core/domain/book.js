/**
 * core/domain/book.js —— 书籍领域模型
 *
 * 层：core（功能层）
 * 规矩：纯函数 + 纯数据。这里出现 document / 颜色渲染就错了。
 *      配色也只是「给个色号」，具体怎么用是界面的事。
 */

export const BOOK_KIND = {
  TEXT: 'text',
  HOMEWORK: 'homework',
  EXAM: 'exam',
  MATERIAL: 'material',
};

const KIND_LABEL = {
  [BOOK_KIND.TEXT]: '教材',
  [BOOK_KIND.HOMEWORK]: '作业',
  [BOOK_KIND.EXAM]: '试卷',
  [BOOK_KIND.MATERIAL]: '资料',
};

/** 类型色号。只给值，不给用途——界面拿去做成什么样式由界面决定。 */
const KIND_COLOR = {
  [BOOK_KIND.TEXT]: '#2f6fed',
  [BOOK_KIND.HOMEWORK]: '#e8890c',
  [BOOK_KIND.EXAM]: '#d93a3a',
  [BOOK_KIND.MATERIAL]: '#0f9d76',
};

export function kindLabel(kind) {
  return KIND_LABEL[kind] || '资料';
}

export function kindColor(kind) {
  return KIND_COLOR[kind] || KIND_COLOR[BOOK_KIND.MATERIAL];
}

/**
 * 造一本新书。id 由调用方给（core 不依赖随机数，方便测试）。
 */
export function createBook({
  id,
  title,
  pageCount,
  kind = BOOK_KIND.TEXT,
  courseId = null,
  addedAt = 0,
}) {
  if (!id) throw new Error('[book] 缺少 id');
  const name = String(title || '').trim();
  if (!name) throw new Error('[book] 书名不能为空');
  const pages = Number(pageCount);
  if (!Number.isFinite(pages) || pages < 1) {
    throw new Error(`[book] 页数不合法：${pageCount}`);
  }
  if (!KIND_LABEL[kind]) throw new Error(`[book] 未知类型：${kind}`);

  return {
    id,
    title: name,
    pageCount: Math.floor(pages),
    kind,
    courseId,
    addedAt,
    lastReadAt: 0,
  };
}

/**
 * 把存储里读出来的原始对象补全成完整模型。
 * 存储可能来自旧版本，缺字段要能兜住，而不是让界面拿到 undefined。
 */
export function normalizeBook(raw) {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    title: String(raw.title || '未命名').trim() || '未命名',
    pageCount: Math.max(1, Math.floor(Number(raw.pageCount) || 1)),
    kind: KIND_LABEL[raw.kind] ? raw.kind : BOOK_KIND.MATERIAL,
    courseId: raw.courseId ?? null,
    addedAt: Number(raw.addedAt) || 0,
    lastReadAt: Number(raw.lastReadAt) || 0,
  };
}

/** 书架上那行小字：`教材 · 200 页` */
export function bookMetaText(book, progressPage = 0) {
  const kind = kindLabel(book.kind);
  const read = progressPage > 1 ? `${progressPage}/${book.pageCount} 页` : `${book.pageCount} 页`;
  return `${kind} · ${read}`;
}
