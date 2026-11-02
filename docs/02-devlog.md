# 02 · 开发日志

倒序，最新的在最上面。每条记三件事：**做了什么、为什么这么做、怎么验的**。

---

## 2026-11-02 · v0.1 起工程

### 目标

不是「再写一个圈问」，而是**先把边界定死再写代码**。
旧工程是一路长出来的，功能与界面缠在一起；这次从第一行就分四层。

### 落地

```
core（纯逻辑，零 DOM）
  ├─ domain/   book / mark / prompt
  ├─ ports/    storage / page-renderer / vision / clock
  └─ services/ library / reader / ask
adapters（实现端口）
  ├─ storage/  indexeddb / memory
  ├─ render/   pdfjs-img / fake
  └─ vision/   openai / echo
ui（只画和收事件）
  ├─ shared/   dom / math / selection / page-view / base.css
  ├─ phone/    单栏 + 底部抽屉
  ├─ tablet/   左书右问，2:1
  └─ desktop/  三栏 + 快捷键
app（装配）
  └─ container / bootstrap
```

### 关键决策

1. **渲染器是工厂，不是单例。** `createRenderer().open(source)` 返回文档句柄，
   句柄自己管页面缓存。这样 core 里没有「全局当前文档」这种隐藏状态。
2. **PDF → `<img>`**（ADR 0002）。临时 canvas → `toBlob` → ObjectURL → `<img>`，
   canvas 用完立刻丢。5 页常驻内存从 ~110MB 降到 ~1.5MB。
   Blob URL 必须手动回收，所以渲染器里做了 LRU（默认 8 页）。
3. **坐标用归一化矩形**（0~1）。同一标记在 390px 手机和 1600px 平板上都贴得对。
4. **提示词在 core，不在 ui。** 否则会出现「手机端要求 LaTeX、平板端忘了」。
5. **界面靠事件总线解耦**。core 只 `emit`，不知道谁在听；界面 `on` 之后拿到 `off()`。

### 踩到的三个坑（都是真 bug，不是环境问题）

| 现象 | 原因 | 修法 |
|---|---|---|
| 启动永久白屏 | IndexedDB 的 `open` 在某些环境既不 success 也不 error，`await` 永远挂着 | 加 3s 超时，超时退回内存存储 |
| `页数不合法：undefined` | `pdfjs.getDocument()` 返回的是 **LoadingTask**，直接 `await` 拿到 task 本身，`numPages` 是 undefined | `await (task.promise ?? task)` |
| `Cannot perform Construct on a detached ArrayBuffer` | pdf.js 会把 buffer **transfer** 给 worker，原 buffer 变成 detached；同一份字节第二次用就炸 | `open()` 里复制一份 `Uint8Array`，调用方可以放心复用 |
| 桌面空状态一行一个字 | `.stage-empty` 用了 `display:grid`，每个内联子节点都成了独立 grid item | 改成 flex column，内容包成两行 div |

### 验证方式

- `npm test` —— 14 个用例，全在 Node 里跑，**没有浏览器**（分层的直接收益）
- `npm run check` —— 扫 `src/core/**`，命中 `document.` / `window.` / `fetch(` 就报错
- 端到端探针（`public/__dev/probe4.html`）：真实 pdf.js 跑完
  `导入 → 打开 → 出图 → 裁选区 → 提问 → 落标记`，回报：
  `book=sample pages=1 | pageImg=900x1274 blob: | region=865x544 | answerLen=294 | marks=1 | cacheHitSameUrl=true`
- 三端截图见 `docs/shots/`，布局用 iframe 量过实际像素（430 宽下底栏内容止于 420，无溢出）

### 已知问题 / 下一步

- **单页模式**，还没做连续滚动。`page-view.js` 换掉即可，core 不用动。
- **没有文字层**，所以不能选中文字。要做就并行挂 pdf.js 的 text layer，不退回 canvas。
- **demo 模式下 fake 渲染器只有 12 页**，会把演示书的页数改写成 12 —— 这是
  「以文档为准」的正常行为，但截图时看着会有点怪。
- 平板/桌面的「圈选后追问」还没做，只有首次提问。
- 手机端截图用 `--window-size=430` 时右侧会被裁：Chrome 有约 500px 的最小窗口宽度，
  截图按 430 裁、布局按 500 排。**布局本身没问题**，截图请用 500 宽。

### 环境备忘

```bash
cd circleask && npm install && npm run dev     # http://localhost:5173
```

调试参数（都可叠加）：

| 参数 | 作用 |
|---|---|
| `?ui=phone\|tablet\|desktop` | 强制某一端界面 |
| `?demo=1` | 内存存储 + 三本预置样书，不落盘 |
| `?fake=1` | 假渲染器，不跑 pdf.js，出图快 |
| `?open=1` | 自动打开第一本书 |

无头截图（Windows）：

```bash
chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir=/tmp/x --window-size=1200,820 --virtual-time-budget=9000 \
  --screenshot="绝对路径.png" "http://localhost:5173/?ui=tablet&demo=1&fake=1&open=1"
```

注意 `--screenshot` 要**绝对路径**，相对路径在 Git Bash 下会静默失败。

---

## 2026-11-02（二）装到平板上：撞上 Chrome 72

目标：新老版本并存于平板，老版本一个字不动。

### 做了什么

1. 新工程加了 Android 壳，包名 `com.circleask.next`、应用名「圈问 Next」，
   和老包 `com.circleask.reader` 完全独立 → 两个图标并存，数据各管各的
2. 第一版装上去**白屏**。logcat：`Uncaught SyntaxError: Unexpected token .`
   → WebView 只有 72，不认 `?.`
3. 决定把**语法基线降到 Chrome 72**（一份代码同时跑老平板和新设备）
4. 顺藤摸出 5 个同类问题（见下），全部修掉
5. 真机验证：导入 → 出图 → 圈选 → 提问 → 公式渲染，全通

### 挖出来的坑（都只在老 WebView 上炸）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 整个 App 白屏 | `?.` / `??` 是 Chrome 80 语法 | esbuild 打包转译到 `chrome72`，产物自检不许残留 |
| 2 | pdf.js 加载即失败 | 4.x 含 1.3 万处 `?.`，3.x legacy 也还有上百处 | 降到 **2.16.105 legacy**（老工程用的同款） |
| 3 | `t.getTransform is not a function` | Chrome 69~72 的 `OffscreenCanvas` 有上下文但缺这个方法 | `makeCanvas` 探测方法存在才用 |
| 4 | `blob.arrayBuffer is not a function` | Chrome 76 才有 | `src/shared/bytes.js` 用 FileReader 兜底 |
| 5 | 元素全挤在一起 | flex 的 `gap` 要 Chrome 84 | 改相邻兄弟外边距，`npm run check` 拦住 |

`@supports (gap: 1px)` 兜底无效——老浏览器认为 gap 是合法属性，会返回 true。

### 分层上的一个决定

`Blob → ArrayBuffer` 的兼容处理没有放进 core，而是：
- 存储端口 `getDocument` 的契约改成**返回 ArrayBuffer**
- 转换落在适配器（`shared/bytes.js` 是叶子工具，adapters 和 ui 都能用）
- core 里只剩 `return bytes`

这样 core 依然不知道 FileReader 的存在，`npm run check` 仍然干净。

### 验证方式

不靠点屏幕，走 WebView 远程调试：

```bash
PID=$(adb shell pidof com.circleask.next | tr -d '\r')
adb forward tcp:9223 localabstract:webview_devtools_remote_$PID
node tools/probe-device.mjs "(async () => { ... })()"
node tools/probe-device.mjs --drag 200,270 400,340    # 圈选手势
```

结果：

```
pages=1 img=900x1274 blob: region=865x544
readerOpen=true img=blob: natural=810x1147 css=720 dpr=1.125
答案里 KaTeX 公式正常渲染（W = sqrt(2εs/q · (1/NA + 1/ND) · Vbi)）
```

老版本同步确认：3 门课 / 3 份材料 / 封面 / 进度全部还在，没被影响。

### 新增文件

```
capacitor.config.json      appId=com.circleask.next
tools/build-web.mjs        esbuild 打包转译 + 语法自检
tools/copy-vendor.mjs      从 node_modules 拷 pdf.js 2.16 legacy
tools/chrome72-gap.mjs     flex gap → 外边距（一次性转换，可重跑）
tools/probe-device.mjs     真机求值 / 模拟手势
src/shared/bytes.js        Blob → ArrayBuffer 兼容
docs/03-parity.md          共存、数据、功能对照表
```

### 还没做

设置页（现在只能改 localStorage 接模型）、追问、连续滚动、
文字层、书签、课程分组、导出导入、OCR。
