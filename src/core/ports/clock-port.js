/**
 * core/ports/clock-port.js —— 时钟端口
 *
 * 层：core（功能层）
 * 为什么连 Date.now() 都要抽出来：测试里要能造「三天前加的书」，
 * 直接调 Date.now() 就写不出稳定的断言。
 */

export const ClockPort = {
  /** @returns {number} 毫秒时间戳 */
  now() {},
};
