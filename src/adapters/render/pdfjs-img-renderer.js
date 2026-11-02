/**
 * adapters/render/pdfjs-img-renderer.js —— PDF → 图片
 *
 * 层：adapters
 * 实现 core/ports/page-renderer-port.js。
 *
 * ★ 这是整个工程性能的关键文件。
 *
 * 管线：pdf.js 画到**临时** canvas → toBlob → ObjectURL → <img>
 *      canvas 用完立刻丢掉，DOM 里只留 <img>。
 *
 * 为什么（详见 docs/adr/0002-pdf-as-img.md）：
 *   canvas 每页常驻显存 ≈ 宽×高×4 字节，2000×2800 就是 22MB；
 *   换成 JPEG/WebP 后约 200~400KB，同样 5 页从 110MB 降到 1.5MB。
 *
 * 代价是 Blob URL 必须自己回收，所以下面做了 LRU。
 */

const DEFAULT_OPTS = {
  width: 1100,          // 默认出图宽度（CSS 像素），界面会按屏幕再传
  maxCached: 8,         // 同时保留几页的图片地址
  mime: 'image/webp',   // webp 体积约为 png 的 1/5
  quality: 0.82,
};

function makeCanvas(w, h) {
  // OffscreenCanvas 在 Chrome 69~72 上是半成品：对象存在、getContext('2d') 也能拿到，
  // 但上下文里没有 getTransform。pdf.js 的 beginDrawing 第一件事就是调它，
  // 于是直接抛 "t.getTransform is not a function"，整页渲染失败。
  // 所以不能只看 typeof，必须探一下真正要用的方法在不在。
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext('2d');
      if (ctx && typeof ctx.getTransform === 'function') return off;
    } catch (e) {
      /* 半成品实现，退回普通 canvas */
    }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasToBlob(canvas, mime, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), mime, quality);
  });
}

/**
 * @param {Object} p
 * @param {Object} p.pdfjs  pdf.js 模块（由 app 层注入，适配器不自己 import CDN）
 */
export function createPdfImgRenderer({ pdfjs, options = {} }) {
  const opts = { ...DEFAULT_OPTS, ...options };

  async function open(source) {
    // source 支持：{ data: ArrayBuffer|Uint8Array } / { url: string } / 字符串 URL
    //
    // ⚠️ 必须复制一份字节：pdf.js 会把 buffer **transfer** 给 worker，
    //    原 buffer 随即变成 detached（byteLength=0）。
    //    不复制的话，同一份字节第二次 getDocument 就会抛
    //    "Cannot perform Construct on a detached ArrayBuffer"。
    const copy = (data) => {
      const view = data instanceof Uint8Array ? data : new Uint8Array(data);
      return view.slice();
    };

    const loading =
      source instanceof ArrayBuffer || source instanceof Uint8Array
        ? pdfjs.getDocument({ data: copy(source) })
        : typeof source === 'string'
          ? pdfjs.getDocument({ url: source })
          : source.data != null
            ? pdfjs.getDocument({ ...source, data: copy(source.data) })
            : pdfjs.getDocument(source);

    const pdf = await (loading.promise ?? loading);
    // ↑ 必须取 .promise：pdf.js 的 getDocument() 返回的是 LoadingTask，
    //   直接 await 它拿到的是 task 本身（numPages 为 undefined），不是文档。
    const pageCount = pdf.numPages;

    /** key = `${pageNo}@${width}` → { url, width, height } */
    const cache = new Map();

    function evictIfNeeded() {
      while (cache.size > opts.maxCached) {
        const [oldestKey, entry] = cache.entries().next().value;
        cache.delete(oldestKey);
        URL.revokeObjectURL(entry.url); // 不回收就是内存泄漏，必做
      }
    }

    async function renderPage(pageNo, { width = opts.width } = {}) {
      const key = `${pageNo}@${Math.round(width)}`;
      const hit = cache.get(key);
      if (hit) {
        // LRU：命中就挪到队尾
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }

      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });

      const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      // 白底：PDF 背景是透明的，不铺白会变黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await canvasToBlob(canvas, opts.mime, opts.quality);
      // 主动断引用，让 GC 能立刻回收这块位图
      canvas.width = 0;
      canvas.height = 0;

      const entry = {
        url: URL.createObjectURL(blob),
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        bytes: blob.size,
      };
      cache.set(key, entry);
      evictIfNeeded();
      return entry;
    }

    /**
     * 裁一块。注意不是「截屏」——是按目标宽度重新渲染整页再裁，
     * 所以放大后依然清晰。
     */
    async function renderRegion(pageNo, rect, { width = 1600 } = {}) {
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });

      const full = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const fullCtx = full.getContext('2d', { alpha: false });
      fullCtx.fillStyle = '#ffffff';
      fullCtx.fillRect(0, 0, full.width, full.height);
      await page.render({ canvasContext: fullCtx, viewport }).promise;

      // 归一化矩形 → 像素矩形，并留一点边距让模型看得清上下文
      const padX = viewport.width * 0.02;
      const padY = viewport.height * 0.02;
      const sx = Math.max(0, rect.x * viewport.width - padX);
      const sy = Math.max(0, rect.y * viewport.height - padY);
      const sw = Math.min(viewport.width - sx, rect.w * viewport.width + padX * 2);
      const sh = Math.min(viewport.height - sy, rect.h * viewport.height + padY * 2);

      const crop = makeCanvas(Math.max(1, Math.ceil(sw)), Math.max(1, Math.ceil(sh)));
      const cropCtx = crop.getContext('2d', { alpha: false });
      cropCtx.fillStyle = '#ffffff';
      cropCtx.fillRect(0, 0, crop.width, crop.height);
      cropCtx.drawImage(full, sx, sy, sw, sh, 0, 0, crop.width, crop.height);

      full.width = 0;
      full.height = 0;

      const blob = await canvasToBlob(crop, 'image/jpeg', 0.9);
      crop.width = 0;
      crop.height = 0;

      return {
        url: URL.createObjectURL(blob),
        width: Math.ceil(sw),
        height: Math.ceil(sh),
        bytes: blob.size,
      };
    }

    function close() {
      for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
      cache.clear();
      pdf.destroy?.();
    }

    return { pageCount, renderPage, renderRegion, close };
  }

  return { open };
}
