/**
 * core/ports/contract.js —— 端口契约校验
 *
 * 层：core（功能层）
 * 作用：适配器是「外面的人」写的，写漏了方法要到运行时才炸。
 *      启动时先验一遍，错在启动、不在用户翻到第 80 页时。
 */

export function assertPort(impl, port, label) {
  const missing = [];
  for (const key of Object.keys(port)) {
    if (typeof impl?.[key] !== 'function') missing.push(key);
  }
  if (missing.length) {
    throw new Error(
      `[port] ${label} 实现不完整，缺少方法：${missing.join(', ')}`
    );
  }
  return impl;
}
