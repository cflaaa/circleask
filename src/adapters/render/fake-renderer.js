/**
 * adapters/render/fake-renderer.js —— 假渲染器
 *
 * 层：adapters
 * 用途：没有 PDF 时也能跑通界面和测试；core 的单元测试全用它。
 * 产出的 url 是内联 SVG data URL，不依赖网络也不占内存。
 */

export function createFakeRenderer({ pageCount = 12, delayMs = 0 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function svgUrl(text, w, h, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="${color}"/>
      <text x="50%" y="50%" font-size="${Math.round(h / 10)}" fill="#334" text-anchor="middle">${text}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return {
    async open() {
      await sleep(delayMs);
      return {
        pageCount,
        async renderPage(pageNo, { width = 800 } = {}) {
          await sleep(delayMs);
          return { url: svgUrl(`第 ${pageNo} 页`, width, Math.round(width * 1.414), '#f4f1ea'), width, height: Math.round(width * 1.414) };
        },
        async renderRegion(pageNo, rect, { width = 800 } = {}) {
          await sleep(delayMs);
          const w = Math.max(40, Math.round(width * rect.w));
          const h = Math.max(40, Math.round(width * rect.h));
          return { url: svgUrl(`p${pageNo} 选区`, w, h, '#e8f0ff'), width: w, height: h };
        },
        close() {},
      };
    },
  };
}
