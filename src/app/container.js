/**
 * app/container.js —— 依赖装配
 *
 * 层：装配层
 * 全工程**只有这个文件**知道「用哪个实现」。
 * core 只认端口，ui 只认 core，谁都不用关心这里是 IndexedDB 还是内存。
 *
 * 换实现只改这里一行，比如把 echoVision 换成 openAiVision。
 */

import { createCore } from '../core/index.js';
import { createIndexedDbStorage } from '../adapters/storage/indexeddb-storage.js';
import { createMemoryStorage } from '../adapters/storage/memory-storage.js';
import { createPdfImgRenderer } from '../adapters/render/pdfjs-img-renderer.js';
import { createFakeRenderer } from '../adapters/render/fake-renderer.js';
import { createOpenAiVision } from '../adapters/vision/openai-vision.js';
import { createEchoVision } from '../adapters/vision/echo-vision.js';
import { createSystemClock } from '../adapters/clock.js';

const CONFIG_KEY = 'ca.config';
const UI_MODE_KEY = 'ca.uiMode';

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export function loadUiMode() {
  return localStorage.getItem(UI_MODE_KEY) || 'auto';
}

export function saveUiMode(mode) {
  localStorage.setItem(UI_MODE_KEY, mode);
}

/**
 * 决定用哪套界面。
 * 注意：只看「运行环境」，不看窗口宽度 —— 宽度会变，环境不会。
 */
export function detectUiMode(preferred = 'auto') {
  if (preferred !== 'auto') return preferred;

  // 桌面壳（Electron / Tauri）会注入这个标记
  if (typeof window !== 'undefined' && window.__CIRCLEASK_SHELL__ === 'desktop') return 'desktop';

  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  const shortSide = Math.min(window.screen?.width || 1024, window.screen?.height || 768);

  if (touch && shortSide >= 600) return 'tablet';
  return 'phone';
}

/**
 * pdf.js 用 UMD 版（3.x legacy），由 index.html 里的 <script> 提前挂到 window.pdfjsLib。
 *
 * 为什么不用 `import('/vendor/pdf.mjs')`：
 *   目标机是 Android 7.1 / WebView 72，pdf.js 4.x 连 legacy 构建都含上万处 `?.`，
 *   在 72 上是语法错误、整个模块加载失败。3.x 的 legacy 构建才是给这类机器准备的。
 *   这也是全工程唯一一处「不靠 ESM 而是靠全局变量」的地方，原因写在这。
 */
function loadPdfjs() {
  const lib = typeof window !== 'undefined' ? window.pdfjsLib : null;
  if (!lib) throw new Error('pdf.js 未加载：检查 index.html 里的 /vendor/pdf.min.js');
  lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
  return lib;
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.fake] 用假实现跑通界面（无 PDF、无 key 时）
 * @param {boolean} [opts.demo] 内存存储 + 预置样书，用于看界面/截图，不落盘
 */
export async function createApp({ fake = false, demo = false } = {}) {
  const cfg = loadConfig();

  // ---- 存储 ----
  let storage;
  if (demo) {
    storage = createMemoryStorage();
  } else {
    try {
      storage = await createIndexedDbStorage();
    } catch (err) {
      console.warn('[container] IndexedDB 不可用，退到内存存储：', err);
      storage = createMemoryStorage();
    }
  }

  // ---- 渲染 ----
  let renderer;
  if (fake) {
    renderer = createFakeRenderer();
  } else {
    const pdfjs = await loadPdfjs();
    renderer = createPdfImgRenderer({ pdfjs, options: { maxCached: cfg.maxCachedPages || 8 } });
  }

  // ---- 模型 ----
  // 没配 key 就用本地回声实现，保证整条链路能跑
  const vision =
    cfg.api?.endpoint && cfg.api?.key
      ? createOpenAiVision({
          endpoint: cfg.api.endpoint,
          apiKey: cfg.api.key,
          model: cfg.api.model || 'gpt-4o-mini',
        })
      : createEchoVision();

  const ids = {
    next: () =>
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  const core = createCore({
    storage,
    renderer,
    vision,
    clock: createSystemClock(),
    ids,
  });

  if (demo) await seedDemo(core, storage);

  return { core, config: cfg, usingFakeVision: !(cfg.api?.endpoint && cfg.api?.key) };
}

/**
 * 演示数据：三本书，字节都指向同一个样例 PDF。
 * 只是为了让界面有东西可看，不参与业务逻辑。
 */
async function seedDemo(core, storage) {
  const bytes = await fetch('/fixtures/sample.pdf')
    .then((r) => r.arrayBuffer())
    .catch(() => null);

  const seeds = [
    { title: '半导体物理', kind: 'text', pageCount: 214 },
    { title: '第三章 作业', kind: 'homework', pageCount: 6 },
    { title: '期中试卷 2024', kind: 'exam', pageCount: 8 },
  ];

  for (const [i, s] of seeds.entries()) {
    const id = `demo-${i}`;
    await storage.saveBook({
      id,
      title: s.title,
      pageCount: s.pageCount,
      kind: s.kind,
      courseId: null,
      addedAt: Date.now() - i * 86400000,
      lastReadAt: i === 0 ? Date.now() - 3600000 : 0,
    });
    await storage.setProgress(id, i === 0 ? 65 : 1);
    if (bytes) await storage.putDocument(id, new Blob([bytes], { type: 'application/pdf' }));
  }
}
