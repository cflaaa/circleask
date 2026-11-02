/**
 * core/services/ask-service.js —— 圈选提问用例
 *
 * 层：core（功能层）
 * 这是整个产品的核心用例，也是最能体现「分层」收益的地方：
 *   换渲染方式（canvas→img）、换模型供应商，这个方法一行都不用改。
 */

import { EVT } from '../bus.js';
import { createMark, isSelectionUsable, labelFromAnswer, MARK_KIND } from '../domain/mark.js';
import { buildSelectionPrompt } from '../domain/prompt.js';

export function createAskService({ vision, storage, clock, bus, ids }) {
  /**
   * @param {Object} p
   * @param {Object} p.book      当前书
   * @param {Object} p.doc       渲染句柄（由 reader 提供，ask 自己不持有）
   * @param {number} p.pageNo
   * @param {{x:number,y:number,w:number,h:number}} p.rect 归一化选区
   * @param {string} [p.question] 用户补充的文字
   * @param {Array} [p.history]   追问上下文
   */
  async function askSelection({ book, doc, pageNo, rect, question = '', history = [] }) {
    if (!doc) throw new Error('[ask] 文档未打开');
    if (!isSelectionUsable(rect)) {
      // 这是业务规则，不该让每个界面自己判断一遍
      const err = new Error('圈得太小了，再圈大一点');
      err.code = 'SELECTION_TOO_SMALL';
      throw err;
    }

    const requestId = ids.next();
    bus.emit(EVT.ANSWER_START, { requestId, bookId: book?.id, pageNo });

    let image;
    try {
      // 关键一步：按 1600px 目标宽度重新渲染这一小块，不是截屏
      image = await doc.renderRegion(pageNo, rect, { width: 1600 });
    } catch (err) {
      bus.emit(EVT.ANSWER_ERROR, { requestId, error: err });
      throw err;
    }

    const prompt = buildSelectionPrompt({
      bookTitle: book?.title,
      pageNo,
      userQuestion: question,
      history,
    });

    let answer = '';
    try {
      answer = await vision.ask({
        imageUrl: image.url,
        prompt,
        history,
        onDelta: (chunk) => {
          answer += chunk;
          bus.emit(EVT.ANSWER_DELTA, { requestId, chunk, text: answer });
        },
      });
    } catch (err) {
      bus.emit(EVT.ANSWER_ERROR, { requestId, error: err });
      throw err;
    }

    // 回答落地成一条页边标记，留痕
    let mark = null;
    if (book?.id) {
      const existing = await storage.listMarks(book.id);
      mark = createMark({
        id: ids.next(),
        bookId: book.id,
        pageNo,
        rect,
        kind: MARK_KIND.QUESTION,
        label: labelFromAnswer(answer, existing.length + 1),
        createdAt: clock.now(),
      });
      await storage.saveMark(mark);
      bus.emit(EVT.MARK_ADDED, { mark });
    }

    bus.emit(EVT.ANSWER_END, { requestId, text: answer, mark });
    return { text: answer, mark, imageUrl: image.url };
  }

  async function listMarks(bookId) {
    return storage.listMarks(bookId);
  }

  async function removeMark(id) {
    await storage.deleteMark(id);
    bus.emit(EVT.MARK_REMOVED, { id });
  }

  return { askSelection, listMarks, removeMark };
}
