/**
 * tools/probe-device.mjs —— 通过 WebView 远程调试在真机上跑一段代码
 *
 * 用途：不点屏幕也能验「真机能不能渲染 PDF」。
 * 前提：
 *   1. 设备已连 adb，App 已启动
 *   2. adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
 *      （forward 和这个脚本必须在同一条命令里跑，adb daemon 退出后转发会失效）
 *
 * 用法：
 *   node tools/probe-device.mjs "表达式"                 直接求值，可用 __CA
 *   node tools/probe-device.mjs --drag 100,100 400,300   模拟一次拖动（CSS 像素）
 *
 * 为什么要有 --drag：圈选只认 pointer 事件，用 adb input 发的是物理坐标，
 * 还要自己算缩放；走 CDP 直接给 CSS 像素，稳。
 */

const PORT = process.env.CDP_PORT || 9223;

async function targets() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  return res.json();
}

async function connect() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page') || list[0];
  if (!page) throw new Error('没有可调试的页面，检查 adb forward 和 App 是否在前台');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  const send = (method, params) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  return { send, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function drag(send, from, to) {
  // 用鼠标事件而不是 touch：WebView 会把 mouse 合成为 pointer 事件，
  // 而 dispatchTouchEvent 在没有 Input domain 初始化时会一直不返回。
  const at = (p) => ({ x: p[0], y: p[1], button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at(from) });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at([x, y]) });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at(to) });
}

async function main() {
  const argv = process.argv.slice(2);
  const { send, close } = await connect();

  if (argv[0] === '--drag') {
    const parse = (s) => s.split(',').map(Number);
    await drag(send, parse(argv[1]), parse(argv[2]));
    close();
    console.log(`✓ 拖动 ${argv[1]} → ${argv[2]}`);
    return;
  }

  const expr = argv.join(' ');
  if (!expr) throw new Error('用法：node tools/probe-device.mjs "<js 表达式>" 或 --drag x1,y1 x2,y2');

  const out = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  close();

  if (out.result?.exceptionDetails) {
    const d = out.result.exceptionDetails;
    console.error('✗ 页面里抛错：', d.exception?.description || d.text);
    process.exit(1);
  }
  const v = out.result?.result?.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
