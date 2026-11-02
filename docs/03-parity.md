# 03 · 新老版本共存 · 数据 · 兼容

> 三句话结论：
> **能共存**（包名不同就互不干扰）；
> **数据不共享**（各自独立沙箱，新版本从空书架开始）；
> **老平板能跑**（已实测，前提是把语法基线降到 Chrome 72）。

---

## 一、为什么能同时装

Android 判定「是不是同一个 App」只看 **applicationId**，不看应用名、图标、版本号。

| | 老版本 | 新版本 |
|---|---|---|
| 包名 | `com.circleask.reader` | `com.circleask.next` |
| 应用名 | 圈问 | 圈问 Next |
| 版本 | 3.18（versionCode 37） | 1.0（versionCode 1） |
| 数据 | 已装，3 门课 3 份材料 | 独立沙箱，空书架 |

包名不同 → 系统当成两个完全独立的 App：两个图标、两个 `/data/data/<包名>/`、
两套 WebView 存储（IndexedDB / localStorage 都跟着包名走）。
卸掉新的，老的一个字节都不动；新的版本号比老的「小」也不会被当成降级。

**唯一不能共存的情况是包名相同**——那样安装会覆盖（同签名）或直接拒绝（签名不同）。
这就是新工程一上来就把 applicationId 定成 `com.circleask.next` 的原因。

---

## 二、数据怎么处理（已确认：不迁移）

### 两边是两套库

| | 老 3.18 | 新 0.1.0 |
|---|---|---|
| IndexedDB 名 | `circleask` | `circleask` |
| 版本 | v4 | v2 |
| 表 | books / files / pages / chunks / notes / courses / marks / bookmarks | books / marks / progress / documents |

名字一样，但**在不同的沙箱里**，物理上是两个库。
老版本里的书、进度、圈问记录，新版本一个都看不到。

实测证据（`adb shell run-as`）：

```
老包 app_webview/IndexedDB/https_localhost_0.indexeddb.leveldb   ← 有数据
新包 app_webview/IndexedDB/                                      ← 安装后新建，空的
```

注意两者 origin 都是 `https://localhost`——**origin 相同不代表数据相同**，
存储是按「App 沙箱 + origin」定位的。

### 结论：对比功能就重新导入同一份 PDF

PDF 原文件在平板的「下载」目录，两个 App 各自导入同一份即可。
「同一本书两边看」能做到，只是进度和标记不共享——**对比功能本来不需要共享数据**。

想搬历史记录的话，老版本有 `doExport`（导出问答+标记+书签 JSON），
新版本还缺 `importMarks`，这条链路现在断在后半段。等真需要了再补。

> 拷沙箱这条路不要走：Android 12+ 废弃了 `adb backup`，
> 而且 WebView 的 IndexedDB 是 LevelDB 目录，跨 schema 硬拷基本打不开。

---

## 三、⚠️ 目标机兼容：Chrome 72 是硬约束

平板上装之前没人会想到，这一条是**整个工程的基线问题**。

```
设备：XP22A（rockchip）Android 7.1.2 / SDK 25
WebView：72.0.3626.28
```

第一版 APK 装上去**白屏**，logcat 一句话点破：

```
Uncaught SyntaxError: Unexpected token .
  at https://localhost/src/app/bootstrap.js:32
```

`?.` 是 Chrome 80 才有的语法，72 直接语法错误，整个模块不执行。
沿这条线又挖出一串只在老 WebView 上炸的问题：

| 问题 | 触发点 | 处理 |
|---|---|---|
| `?.` / `??` 语法 | 源码 46 + 11 处 | 构建时 esbuild 转译到 `chrome72`，打包成 IIFE |
| pdf.js 4.x 含上万处 `?.` | `/vendor/pdf.mjs` | **降到 pdfjs-dist 2.16.105 legacy**（3.x legacy 也还有上百处） |
| `OffscreenCanvas` 是半成品 | 有 2D 上下文但没有 `getTransform` | `makeCanvas` 探测方法存在才用，否则退回普通 canvas |
| `Blob.arrayBuffer()` 不存在 | Chrome 76 才有 | `src/shared/bytes.js` 用 FileReader 兜底 |
| flex 的 `gap` 不生效 | Chrome 84 才有（grid 的 gap 66 就有） | 全部改成相邻兄弟外边距 |
| `inset:` 简写不生效 | Chrome 87 才有 | 拆成 top/right/bottom/left |

**`@supports` 那条路走不通**：老浏览器认为 `gap` 是合法属性，
`@supports (gap: 1px)` 返回 true，兜底永远不生效。所以只能真的别用。

这些现在都由 `npm run check` 拦着：core 越界检查 + Chrome 72 兼容检查，
命中就退出码 1。

### 构建链

```
npm run vendor      # 从 node_modules 拷 pdf.js 2.16 legacy + katex 到 public/vendor
npm run build:web   # esbuild 打包转译 → dist/，自带语法自检
npm run sync:android
npm run apk         # 上面全做 + gradlew assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 四、真机验证结果（2026-11-02，XP22A）

| 项 | 结果 |
|---|---|
| 两个包并存 | ✅ `com.circleask.reader` + `com.circleask.next` |
| 老版本数据 | ✅ 3 门课 / 3 份材料 / 真实封面 / 进度 76-200、57-332 都在 |
| 新版本启动 | ✅ 自动识别平板界面，无报错 |
| PDF → 图片 | ✅ `pages=1 img=900x1274 blob:` |
| 圈选区域出图 | ✅ `region=865x544` |
| 阅读界面 | ✅ 左右分栏，页码 1/1，底部按钮齐全 |
| 圈选 → 提问 | ✅ 缩略图 + 回答 + **KaTeX 公式正常渲染** |
| 出图清晰度 | ✅ 810px 出图对应 720px 显示 × DPR 1.125 |

验证手段不是点屏幕，而是走 WebView 远程调试：

```bash
PID=$(adb shell pidof com.circleask.next | tr -d '\r')
adb forward tcp:9223 localabstract:webview_devtools_remote_$PID
node tools/probe-device.mjs "表达式"          # 直接求值，可用 __CA
node tools/probe-device.mjs --drag 200,270 400,340   # 模拟圈选手势
```

> forward 和 node 必须写在同一条命令里，否则 adb daemon 退出后转发失效。

---

## 五、功能对照表

老版本能力是从代码里扒的（`app-core.js` 的 46 个接口 + 8 张表 + UI 控件），不是凭印象。

图例：✅ 已实现 ／ ⚠️ 有但不完整 ／ ❌ 还没有

### 书架与文档

| 功能 | 老 3.18 | 新 0.1.0 | 说明 |
|---|---|---|---|
| 书架列表 | ✅ | ✅ | 新的卡片网格 |
| 课程分组 | ✅ | ❌ | 老的 `courses` 表 |
| 导入 PDF | ✅ | ✅ | 老的支持多选 + 逐个判断类型 |
| 重命名 / 删除 | ✅ | ✅ | `library.rename` / `remove` |
| 封面缩略图 | ✅ | ⚠️ | 新的是占位图标，还没做首页缩略图 |
| 阅读进度记忆 | ✅ | ✅ | `progress` 表 |
| 从「资料库」导入 | ✅ | ❌ | 老的 `importFromLibrary` |
| 页面预取 | ✅ | ❌ | 老的 `prefetchDoc` |

### 阅读

| 功能 | 老 3.18 | 新 0.1.0 | 说明 |
|---|---|---|---|
| PDF 渲染 | ✅ | ✅ | **新的是渲染成 img**，canvas 用完即丢 |
| 单页翻页 | ✅ | ✅ | |
| 连续滚动 | ✅ | ❌ | 老的 `applyPaging` 两种模式 |
| 页码跳转 | ✅ | ✅ | `reader.goto` |
| 缩放 | ✅ | ❌ | |
| 音量键翻页 | ✅ | ❌ | |
| 原生分页同步 | ✅ | ❌ | 老的 `syncNativePaging` |
| 渲染缓存 | ⚠️ | ✅ | 新的 LRU 8 页 + 主动回收 Blob URL |

### 圈选与问答

| 功能 | 老 3.18 | 新 0.1.0 | 说明 |
|---|---|---|---|
| 矩形圈选 | ✅ | ✅ | 存**相对比例**，换设备不错位 |
| 圈选区域截图 | ✅ | ✅ | `renderRegion` |
| 提问 | ✅ | ✅ | |
| 流式输出 | ✅ | ❌ | 老的 `streamToSheet` |
| 多轮追问 | ✅ | ❌ | 老的 `turns` + `rebuildHistory` |
| 标记持久化 | ✅ | ✅ | `marks` 表 |
| 标记删除 | ✅ | ✅ | `removeMark` |
| 文本选中提问 | ✅ | ❌ | 新的没有文字层 |
| 全文/关键词检索 | ✅ | ❌ | 老的 `chunks` + `pageTextOf` |
| 公式渲染 | ✅ | ✅ | 都走 KaTeX |
| 扫描页 OCR | ✅ | ❌ | 老的 `extractOcrPages` |

### 书签与笔记

| 功能 | 老 3.18 | 新 0.1.0 |
|---|---|---|
| 跳转书签 | ✅ | ❌ |
| 跳回上一处 | ✅ | ❌ |
| 笔记 | ✅ | ❌ |

### 设置与运维

| 功能 | 老 3.18 | 新 0.1.0 | 说明 |
|---|---|---|---|
| 模型接入配置 | ✅ | ⚠️ | 新的只能改 localStorage，**没有设置界面** |
| 图片能力探测 | ✅ | ❌ | |
| 手机/平板界面切换 | ✅ | ✅ | 新的还多一套桌面端 |
| 导出问答 JSON | ✅ | ❌ | |
| 导入标记 | ✅ | ❌ | |
| 清空所有数据 | ✅ | ❌ | |
| 无线调试 | ✅ | ❌ | |
| 调试面板 | ✅ | ❌ | |

### 统计

38 项里：新版本 ✅ 17、⚠️ 2、❌ 19。
重写的是骨架（分层、端口、三端 UI、img 渲染管线、老机器兼容），
业务功能要一项项往回填——**回填时不要再把层混在一起**。

---

## 六、回填优先级

按「每天都会碰」排，不按代码好写排：

1. **设置页 + 模型配置** —— 没有它接不上真模型，等于不能日常用
2. **追问** —— 圈问的核心是多轮，一问一答只是半成品
3. **连续滚动** —— 单页翻页在长文档上很难受
4. **文字层 / 选中提问** —— 比圈选精确，也是全文检索的前提
5. 书签 → 课程分组 → 导出/导入 → OCR

前 3 项做完，新版本就能替代老版本日常使用了。
