/**
 * core/domain/mark.js —— 圈问标记
 *
 * 层：core（功能层）
 *
 * 坐标一律用**归一化矩形**（0~1，相对页面宽高）。
 * 为什么不存像素：同一个标记要在手机（390px 宽）和平板（1600px 宽）上都贴对位置，
 * 存像素就得在每台设备上换算，存比例则一次算好、到处能用。
 */

export const MARK_KIND = {
  QUESTION: 'question',
  BOOKMARK: 'bookmark',
};

/** 圈选小于这个比例就算误触（面积占比） */
export const MIN_SELECTION_AREA = 0.0015;

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * 把「起点 + 终点」整理成合法的归一化矩形。
 * 手指可以从右下往左上画，所以必须自己排大小。
 */
export function rectFromPoints(a, b) {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** 圈太小 → 模型看不清，界面该提示「再圈大一点」 */
export function isSelectionUsable(rect) {
  return rect.w * rect.h >= MIN_SELECTION_AREA && rect.w > 0.01 && rect.h > 0.005;
}

export function createMark({
  id,
  bookId,
  pageNo,
  rect,
  kind = MARK_KIND.QUESTION,
  label = '',
  targetPage = null,
  createdAt = 0,
}) {
  if (!id) throw new Error('[mark] 缺少 id');
  if (!bookId) throw new Error('[mark] 缺少 bookId');
  const page = Math.floor(Number(pageNo));
  if (!Number.isFinite(page) || page < 1) throw new Error(`[mark] 页码不合法：${pageNo}`);
  if (!rect || !isSelectionUsable(rect)) throw new Error('[mark] 选区太小');

  return {
    id,
    bookId,
    pageNo: page,
    rect: { x: clamp01(rect.x), y: clamp01(rect.y), w: clamp01(rect.w), h: clamp01(rect.h) },
    kind,
    label: String(label || '').slice(0, 40),
    targetPage: targetPage == null ? null : Math.floor(Number(targetPage)),
    createdAt,
  };
}

export function normalizeMark(raw) {
  if (!raw?.id || !raw?.bookId || !raw?.rect) return null;
  return {
    id: raw.id,
    bookId: raw.bookId,
    pageNo: Math.max(1, Math.floor(Number(raw.pageNo) || 1)),
    rect: {
      x: clamp01(raw.rect.x),
      y: clamp01(raw.rect.y),
      w: clamp01(raw.rect.w),
      h: clamp01(raw.rect.h),
    },
    kind: raw.kind === MARK_KIND.BOOKMARK ? MARK_KIND.BOOKMARK : MARK_KIND.QUESTION,
    label: String(raw.label || '').slice(0, 40),
    targetPage: raw.targetPage == null ? null : Number(raw.targetPage),
    createdAt: Number(raw.createdAt) || 0,
  };
}

/** 从回答里抽一个短标签贴到页边（没有回答就用序号） */
export function labelFromAnswer(answer, fallbackIndex = 1) {
  const text = String(answer || '')
    .replace(/[$\\{}_^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return `问 ${fallbackIndex}`;
  return text.slice(0, 8);
}
