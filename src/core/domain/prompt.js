/**
 * core/domain/prompt.js —— 提示词构建
 *
 * 层：core（功能层）
 *
 * 为什么提示词算业务、不算界面：它决定了回答质量，是产品逻辑的一部分。
 * 放在 ui 里就会出现「手机端要求 LaTeX、平板端忘了要求」这种问题。
 */

const BASE_RULES = `你是一位耐心的理工科助教。用户圈出了书页上的一小块，那正是他看不懂的地方。

回答要求：
1. 先用一句话点明「这块在讲什么」，再展开。
2. 公式一律用 LaTeX，行内写 $...$，独立成行写 $$...$$。
   禁止使用 V_bi、^1/2 这类裸写，也不要使用 Unicode 上下标字符。
3. 只讲清楚这一块，不要顺带把整章复习一遍。
4. 如果圈的区域信息不足（比如只圈到一个符号），先说明你的猜测，再作答。
5. 用中文回答。`;

/**
 * @param {Object} p
 * @param {string} p.bookTitle
 * @param {number} p.pageNo
 * @param {string} [p.userQuestion] 用户额外打的字（可空，空则纯看图）
 * @param {Array<{role:string,content:string}>} [p.history] 追问上下文
 */
export function buildSelectionPrompt({ bookTitle, pageNo, userQuestion, history = [] }) {
  const parts = [BASE_RULES];

  const where = [`书：《${bookTitle || '未知'}》`, `第 ${pageNo} 页`];
  parts.push(`\n【位置】${where.join('，')}`);

  if (history.length) {
    const lines = history
      .slice(-6)
      .map((h) => `${h.role === 'user' ? '用户' : '你'}：${String(h.content).slice(0, 400)}`);
    parts.push(`\n【此前的对话】\n${lines.join('\n')}`);
  }

  const q = String(userQuestion || '').trim();
  parts.push(q ? `\n【用户补充的问题】${q}` : '\n【用户的问题】这块是什么意思？');

  return parts.join('\n');
}

/** 知识库/整页问答用的提示词，暂时留一个口子 */
export function buildPagePrompt({ bookTitle, pageNo, userQuestion }) {
  return `你是一位耐心的理工科助教。下面是《${bookTitle}》第 ${pageNo} 页的内容。

回答要求：
1. 公式一律用 LaTeX，行内 $...$，独立成行 $$...$$。
2. 用中文回答。

【用户的问题】${userQuestion || '这一页在讲什么？'}`;
}
