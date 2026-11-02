/**
 * ui/shared/math.js —— 公式渲染
 *
 * 层：ui（界面层）
 * 为什么在 ui：把 `$...$` 变成 DOM 节点属于「显示」，不是业务。
 * 但**要求模型输出 LaTeX** 属于业务，那部分在 core/domain/prompt.js。
 *
 * 依赖：window.katex（public/vendor/katex）。没加载时降级成纯文本，不炸。
 */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * 把一段 Markdown 风格的文本渲染成 HTML：
 * 支持 $$...$$ / $...$ / **粗体** / 段落 / 行内换行。
 */
export function renderRichText(text) {
  const src = String(text || '');
  const hasKatex = typeof window !== 'undefined' && window.katex;

  const blocks = [];
  // 先抽出独立公式，避免被后续的转义和替换破坏
  let work = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    blocks.push({ type: 'block', tex: tex.trim() });
    return `\u0000${blocks.length - 1}\u0000`;
  });
  work = work.replace(/\$([^$\n]+?)\$/g, (_, tex) => {
    blocks.push({ type: 'inline', tex: tex.trim() });
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const renderTex = (tex, displayMode) => {
    if (!hasKatex) return `<code>${escapeHtml(tex)}</code>`;
    try {
      return window.katex.renderToString(tex, { displayMode, throwOnError: false });
    } catch {
      return `<code>${escapeHtml(tex)}</code>`;
    }
  };

  let html = escapeHtml(work)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');

  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const b = blocks[Number(i)];
    return b ? renderTex(b.tex, b.type === 'block') : '';
  });

  return `<p>${html}</p>`;
}

/** 流式过程中增量更新：整段重渲染，v0.1 够用（回答通常 < 3KB） */
export function setRichText(el, text) {
  el.innerHTML = renderRichText(text);
}
