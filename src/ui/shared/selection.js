/**
 * ui/shared/selection.js —— 圈选手势
 *
 * 层：ui（界面层）
 * 只负责「手指画的框 → 归一化矩形」这一段。
 * 矩形够不够大、要不要提问，是 core 的规则，这里不判断。
 */

import { h } from './dom.js';

/**
 * @param {HTMLElement} surface 页面容器（内含 <img>，尺寸即页面尺寸）
 * @param {(rect:{x:number,y:number,w:number,h:number})=>void} onDone
 */
export function createSelectionGesture(surface, onDone) {
  let active = false;
  let start = null;
  let box = null;

  function pointToNorm(e) {
    const r = surface.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  function ensureBox() {
    if (!box) {
      box = h('div', { class: 'sel-box' });
      surface.append(box);
    }
    return box;
  }

  function paint(a, b) {
    const el = ensureBox();
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const hh = Math.abs(a.y - b.y);
    Object.assign(el.style, {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${w * 100}%`,
      height: `${hh * 100}%`,
    });
    return { x, y, w, h: hh };
  }

  function down(e) {
    if (!active) return;
    e.preventDefault();
    surface.setPointerCapture?.(e.pointerId);
    start = pointToNorm(e);
    paint(start, start);
  }

  function move(e) {
    if (!active || !start) return;
    e.preventDefault();
    paint(start, pointToNorm(e));
  }

  function up(e) {
    if (!active || !start) return;
    const rect = paint(start, pointToNorm(e));
    start = null;
    // 框留在页面上给用户看，下一帧淡出
    if (box) {
      box.classList.add('sel-box--done');
      const dying = box;
      box = null;
      setTimeout(() => dying.remove(), 260);
    }
    onDone(rect);
  }

  const offs = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
  ].map(([t, fn]) => {
    surface.addEventListener(t, fn);
    return () => surface.removeEventListener(t, fn);
  });

  return {
    enable(v = true) {
      active = v;
      surface.classList.toggle('is-selecting', v);
    },
    destroy() {
      offs.forEach((off) => off());
      box?.remove();
    },
  };
}
