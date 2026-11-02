/**
 * core/bus.js —— 事件总线
 *
 * 层：core（功能层）
 * 规矩：只做「发事件 / 收事件」，不认识任何界面。
 *      core 往外说话全靠它，所以 core 永远不需要 import ui。
 */

export const EVT = {
  BOOKS_CHANGED: 'books:changed',
  BOOK_OPENED: 'book:opened',
  BOOK_CLOSED: 'book:closed',
  PROGRESS_CHANGED: 'progress:changed',
  ANSWER_START: 'answer:start',
  ANSWER_DELTA: 'answer:delta',
  ANSWER_END: 'answer:end',
  ANSWER_ERROR: 'answer:error',
  MARK_ADDED: 'mark:added',
  MARK_REMOVED: 'mark:removed',
};

export function createBus() {
  /** @type {Map<string, Set<Function>>} */
  const table = new Map();

  function on(type, fn) {
    if (!table.has(type)) table.set(type, new Set());
    table.get(type).add(fn);
    // 返回退订函数：界面卸载时调一次，不用记自己订过什么
    return () => off(type, fn);
  }

  function off(type, fn) {
    const set = table.get(type);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) table.delete(type);
  }

  function emit(type, payload) {
    const set = table.get(type);
    if (!set) return;
    // 复制一份再遍历：订阅者在回调里退订不会打乱本次派发
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // 一个订阅者炸了不该拖垮其他订阅者
        console.error(`[bus] 处理 ${type} 出错：`, err);
      }
    }
  }

  function clear() {
    table.clear();
  }

  return { on, off, emit, clear };
}
