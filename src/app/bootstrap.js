/**
 * app/bootstrap.js —— 启动
 *
 * 层：装配层
 * 做三件事：装配依赖 → 按环境选一套界面 → 挂上去。
 * 切换界面时先 unmount 旧的，再 mount 新的，不留下监听器。
 */

import { createApp, detectUiMode, loadUiMode, saveUiMode } from './container.js';

const MODES = ['phone', 'tablet', 'desktop'];

let mounted = null;
let currentMode = null;

async function mountUi({ root, core, mode }) {
  // 动态 import：只下载当前这一端的代码，手机端不会白拉桌面端的 JS
  const mod =
    mode === 'desktop'
      ? await import('../ui/desktop/index.js')
      : mode === 'tablet'
        ? await import('../ui/tablet/index.js')
        : await import('../ui/phone/index.js');

  mounted = await mod.mount({ root, core });
  currentMode = mode;
  document.documentElement.dataset.ui = mode;
}

async function switchTo(mode, ctx) {
  if (mode === currentMode) return;
  mounted?.unmount?.();
  mounted = null;
  await mountUi({ ...ctx, mode });
}

export async function boot() {
  const root = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  // ?demo=1 用内存存储 + 预置样书，方便看界面
  // ?fake=1 用假渲染器（不跑 pdf.js），截图/演示时更快
  const app = await createApp({
    demo: params.get('demo') === '1',
    fake: params.get('fake') === '1',
  });
  const ctx = { root, core: app.core };

  const preferred = loadUiMode();
  // ?ui=phone|tablet|desktop 可以临时强制某一端，方便开发和截图核对
  const forced = params.get('ui');
  const mode = MODES.includes(forced) ? forced : detectUiMode(preferred);
  await mountUi({ ...ctx, mode });

  // ?open=1 自动打开第一本书，方便截图和演示
  if (params.get('open') === '1') {
    await mounted?.openFirst?.();
  }

  // 给调试用：控制台里可以直接 __CA.core.library.list()
  window.__CA = {
    ...app,
    get mode() {
      return currentMode;
    },
    async setMode(next) {
      if (!MODES.includes(next)) throw new Error(`未知界面：${next}`);
      saveUiMode(next);
      await switchTo(next, ctx);
      return next;
    },
    modes: MODES,
  };

  // 设置页改完模式后发个事件，这里统一处理
  window.addEventListener('ca:ui-mode', (e) => {
    switchTo(e.detail?.mode || loadUiMode(), ctx).catch((err) => console.error(err));
  });

  if (app.usingFakeVision) {
    console.info('[圈问] 未配置模型接口，当前使用本地假回答。配置方式：__CA.config 或 localStorage["ca.config"]');
  }

  return app;
}

boot().catch((err) => {
  console.error('[boot] 启动失败：', err);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<div style="padding:40px;font:14px/1.8 system-ui;color:#d93a3a">
      启动失败：${err.message}<br><small>按 F12 看控制台</small></div>`;
  }
});
