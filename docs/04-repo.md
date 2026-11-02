# 04 · 仓库说明

代码托管：`https://github.com/cflaaa/circleask`

这份文档回答一件事：**clone 下来之后怎么跑起来**，以及仓库里哪些东西是故意没有的。

---

## 一、拿到代码之后

```bash
git clone https://github.com/cflaaa/circleask.git
cd circleask

npm install          # 依赖（pdfjs-dist 2.16 / katex / esbuild / capacitor）
npm run dev          # http://localhost:5173
```

第三方产物（pdf.js、KaTeX）**已经在仓库里**，所以不用先跑 `npm run vendor`。
那个命令只在升级依赖后用来刷新 `public/vendor/`。

自检：

```bash
npm test             # core 单元测试，14 个用例，纯 Node
npm run check        # 分层体检 + Chrome 72 兼容体检
```

## 二、出 Android 包

`android/` 是完整的（含图标与 gradle wrapper），clone 下来配一下 SDK 路径就能构建：

```bash
echo "sdk.dir=C:/asdk" > android/local.properties   # 换成你自己的 SDK 路径
npm run apk          # build:web → cap sync → gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Gradle 需要 JDK 17。构建脚本里没有写死 `JAVA_HOME`，用系统默认的即可：

```bash
JAVA_HOME=/path/to/jdk17 npm run apk
```

> 本机验证过的组合：JDK 17.0.20 + Android SDK 34 + Gradle 8.2.1（`gradle-8.2.1-bin`）。

## 三、仓库里没有的东西

| 没有 | 为什么 | 怎么补 |
|---|---|---|
| `node_modules/` | 依赖 | `npm install` |
| `dist/` | 构建产物 | `npm run build:web` |
| `android/app/src/main/assets/` | `cap sync` 的产物 | `npx cap sync android` |
| `android/app/build/`、`android/.gradle/` | 构建缓存 | 构建时自动生成 |
| `android/local.properties` | 机器相关路径 | 自己写 `sdk.dir` |
| `public/__dev/` | 一次性调试探针，会随代码演进而失效 | 需要时自己写 |

除此之外都在仓库里，包括：

- `public/vendor/` —— pdf.js 2.16 legacy + KaTeX
- `public/fixtures/sample.pdf` —— 演示用的样例文档
- `android/app/src/main/res/mipmap-*/` —— 启动图标
- `android/gradle/wrapper/gradle-wrapper.jar`
- `docs/shots/` —— 真机与无头浏览器的截图

## 四、这个仓库的特殊约束

**语法基线是 Chrome 72**，因为目标机是 Android 7.1.2 / WebView 72。

- 源码可以写 `?.` / `??`，构建时 esbuild 转译，产物有自检
- **pdf.js 只能用 2.16**，别升级——4.x 和 3.x legacy 都含 `?.`，装上就白屏
- **CSS 不许在 flex 里用 `gap`**，不许用 `inset:` 简写
- `Blob.arrayBuffer()` 不存在，用 `src/shared/bytes.js` 的 `readBytes`

`npm run check` 会拦住最后两条。前因后果见 `03-parity.md`。

## 五、目录

```
src/core/        功能层，零 DOM
src/adapters/    实现层，接真实世界
src/ui/          界面层，三端互不引用
src/app/         装配层，唯一知道用哪个实现
src/shared/      叶子工具（bytes.js）
tools/           开发服务器、构建、体检、真机探针、发布脚本
docs/            目的 / 架构 / 开发日志 / 共存与兼容 / 本文件 / ADR
```
