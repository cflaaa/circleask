# 01 · 分层架构

## 四层，各管一件事

| 层 | 目录 | 允许做什么 | 绝对不许做什么 |
|---|---|---|---|
| 领域 + 服务 | `src/core` | 校验数据、编排用例、定义端口 | 碰 DOM、发网络请求、读 localStorage |
| 适配器 | `src/adapters` | 实现端口：存库、渲染、调模型 | 决定「什么时候该渲染」——那是服务的活 |
| 界面 | `src/ui` | 画状态、收事件、调服务 | 存业务状态、拼提示词、算页数 |
| 装配 | `src/app` | 选实现、注入依赖、启动 | 写任何业务逻辑 |

## 依赖倒置：core 定义接口，adapters 去满足

core 不知道 PDF 是怎么渲染的，它只知道有这么个东西：

```js
// core/ports/page-renderer-port.js
export const PageRendererPort = {
  open(source) {},              // → { pageCount }
  renderPage(pageNo, opts) {},  // → { url, width, height }
  close() {},
};
```

于是「渲染成图片」和「渲染成 canvas」只是两个实现，
core 的阅读逻辑一个字都不用改。这就是为什么能把 PDF 换成 img 而不动业务。

## 一次「圈选提问」的完整走位

```
用户手指画圈
   │
   ├─ ui/reader.js        ← 只做：把触点坐标变成归一化矩形
   │
   ├─ core/services/ask-service.js
   │     ├─ 校验矩形是否过小（领域规则，界面不该管）
   │     ├─ 调 PageRendererPort 裁一块高清图
   │     ├─ 拼提示词（提示词属于业务，不属于界面）
   │     └─ 调 VisionPort 流式取字
   │
   └─ bus.emit('answer:delta')  ← core 只发事件，不知道谁在听
          │
          └─ ui/reader.js   ← 收到事件，往 DOM 里塞字
```

关键点：**core 从头到尾没有 import 过 ui**。它靠事件往外说话。

## 状态放哪

- **业务状态**（书、标记、进度、当前问题）→ `core` 里的 service 持有
- **瞬时界面状态**（抽屉开没开、手指按在哪）→ `ui` 自己留着，core 不关心

判断标准很简单：**这个东西存进数据库有意义吗？** 有 → core；没有 → ui。

## 为什么用事件总线而不是回调

界面可以随时挂载/卸载（切手机模式、开新窗口），
用回调就得在卸载时一个个 deregister，漏一个就是内存泄漏。
总线让订阅者自己管生命周期：`const off = bus.on(...)`，走的时候 `off()`。

## 端口清单

| 端口 | 职责 | 现有实现 |
|---|---|---|
| `StoragePort` | 书、标记、进度 | IndexedDB / 内存 |
| `PageRendererPort` | 打开文档、按页出图 | pdfjs-img / 假渲染器 |
| `VisionPort` | 看图回答问题 | OpenAI 兼容 / 回声假实现 |
| `ClockPort` | 时间戳 | 系统时钟 / 固定时钟（测试用） |

测试时把四个端口全换成假实现，core 就能脱离浏览器跑 —— 这是分层的直接收益。

## 强制手段

`npm run check` 会扫 `src/core/**`，命中下面任一模式就报错：

- `document.` / `window.` / `localStorage` / `innerHTML` / `classList`
- `fetch(` / `XMLHttpRequest`
- `import` 路径里出现 `adapters` / `ui`

边界不靠自觉，靠脚本。
