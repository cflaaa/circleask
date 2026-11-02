/**
 * adapters/clock.js —— 系统时钟
 *
 * 层：adapters
 * 实现 core/ports/clock-port.js。测试里换成固定值即可。
 */

export function createSystemClock() {
  return { now: () => Date.now() };
}

export function createFixedClock(start = 1700000000000, step = 1000) {
  let t = start;
  return {
    now() {
      t += step;
      return t;
    },
  };
}
