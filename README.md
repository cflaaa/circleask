# 圈问 · CircleAsk（新工程）

在 PDF 上圈一段，直接问它。

这是**重新起的一个工程**，与工作区里旧的 `app/`、`desktop/` 无任何代码往来，
也不共享任何文件。旧的留着不动，新的一切从这里长。

---

## 一句话目标

把「功能」和「界面」彻底分开，让同一套功能能在手机、平板、桌面三种壳里跑，
而**换壳时不需要改功能代码**。

## 三条硬规矩

1. **core 里不许出现 DOM。** 没有 `document`、`innerHTML`、`classList`、`window`。
   功能层只认「端口」（port）接口，不认具体实现。
2. **ui 里不许写业务。** 不直接碰数据库、不拼提示词、不算页码。
   界面只做两件事：把状态画出来、把用户动作转成一次服务调用。
3. **platform 之间互不引用。** `ui/phone` 不 import `ui/tablet`，反之亦然。
   改一端不影响另一端，直到明确要求「同步」。

## 目录

```
circleask/
├─ docs/                  目的、架构、开发日志、决策记录
├─ src/
│  ├─ core/               ★ 功能层：纯逻辑，零 DOM，零网络
│  │  ├─ domain/          领域模型（书、标记、问答）
│  │  ├─ ports/           对外依赖的接口定义（存储/渲染/模型）
│  │  └─ services/        用例编排（书架、阅读、提问）
│  ├─ adapters/           ★ 实现层：把端口接到真实世界
│  │  ├─ storage/         IndexedDB / 内存
│  │  ├─ render/          PDF → 图片（渲染核心）
│  │  └─ vision/          视觉模型
│  ├─ ui/                 ★ 界面层：只画和收事件
│  │  ├─ shared/          跨端复用的最小工具（DOM 助手、格式化）
│  │  ├─ phone/           手机界面
│  │  ├─ tablet/          平板界面
│  │  └─ desktop/         桌面界面
│  └─ app/                ★ 装配层：唯一知道「用哪个实现」的地方
├─ public/                静态入口 + 第三方库
├─ tools/                 开发服务器、分层检查脚本
└─ tests/                 单元测试（只测 core）
```

依赖方向是单向的，**箭头不许掉头**：

```
ui ──▶ app ──▶ core ◀── adapters
```

`core` 谁都不认识；`adapters` 实现 `core/ports`；`app` 把它们接起来；`ui` 只跟 `core` 的服务说话。

## 跑起来

```bash
cd circleask
npm install          # pdfjs-dist 2.16（老 WebView 唯一能跑的版本）+ katex + esbuild
npm run dev          # http://localhost:5173
npm test             # core 单元测试（14 个，不需要浏览器）
npm run check        # 分层体检 + Chrome 72 兼容体检
```

装到平板上：

```bash
npm run apk          # build:web → cap sync → gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

第三方产物（pdf.js / KaTeX）已经在 `public/vendor/` 里，只有升级依赖后才需要
`npm run vendor` 刷新一次。Android 侧要先在 `android/local.properties` 写好自己的
`sdk.dir`，细节见 `docs/04-repo.md`。

包名 `com.circleask.next`，和老的 `com.circleask.reader` 互不干扰，可以并存。

调试参数（可叠加）：

| 参数 | 作用 |
|---|---|
| `?ui=phone\|tablet\|desktop` | 强制某一端界面 |
| `?demo=1` | 内存存储 + 三本预置样书，不落盘 |
| `?fake=1` | 假渲染器，不跑 pdf.js，出图快 |
| `?open=1` | 自动打开第一本书 |

## ⚠️ 语法基线是 Chrome 72

目标机是 Android 7.1.2 / WebView 72。这不是「顺手兼容一下」，是硬约束：

- 源码可以写 `?.` / `??`，**构建时** esbuild 会转译到 `chrome72`
- **pdf.js 只能用 2.16**（4.x 和 3.x legacy 都含 `?.`，装上就白屏）
- **CSS 不许在 flex 里用 `gap`**（Chrome 84 才有），也不许用 `inset:` 简写
- `Blob.arrayBuffer()` 不存在，要用 `src/shared/bytes.js` 的 `readBytes`

`npm run check` 会拦住后两条，构建脚本会拦住产物里的残留语法。
原因和踩坑记录见 `docs/03-parity.md` 第三节。

## 三端长这样

| 手机 | 平板 | 桌面 |
|---|---|---|
| 单栏，问答用底部抽屉 | 左书右问，2:1 | 三栏 + 快捷键 |

截图在 `docs/shots/`，真机截图是 `device-reader2.png`、`device-ask.png`、`device-old.png`。

## 现在到哪一步了

**骨架 + 跑得通的最小闭环**：导入 PDF → 渲染成图片 → 翻页 → 圈选 → 回答 → 留标记。

已在真机（XP22A / Android 7.1.2 / WebView 72）验证：

```
pages=1 img=900x1274 blob: region=865x544
readerOpen=true natural=810x1147 css=720 dpr=1.125
KaTeX 公式正常渲染
```

功能对照（新 17 项已实现 / 老 38 项）见 `docs/03-parity.md`。
还没做：设置页、追问、连续滚动、文字层、书签、课程分组、导出导入、OCR。

