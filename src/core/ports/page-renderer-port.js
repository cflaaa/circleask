/**
 * core/ports/page-renderer-port.js —— 文档渲染端口
 *
 * 层：core（功能层）
 *
 * 设计要点：渲染器是「工厂」，不是「单例」。
 *   createRenderer() → { open(source) → 文档句柄 }
 * 每本书一个句柄，句柄自己管自己的页面缓存，切书时 close() 就干净了。
 * 这样 core 里不会出现「全局当前文档」这种隐藏状态。
 *
 * 句柄形状（DocumentHandle）：
 *   { pageCount, renderPage(pageNo, opts), renderRegion(pageNo, rect, opts), close() }
 *
 * 关键：renderPage 返回的是一个**可直接塞进 <img src> 的地址**，
 *      不是 canvas。为什么这样更快，见 docs/adr/0002-pdf-as-img.md。
 */

export const PageRendererPort = {
  /**
   * @param {*} source 文件/URL/ArrayBuffer，具体形状由适配器决定
   * @returns {Promise<DocumentHandle>}
   */
  open(source) {},
};

/**
 * @typedef {Object} DocumentHandle
 * @property {number} pageCount
 * @property {(pageNo:number, opts?:{width?:number}) => Promise<{url:string,width:number,height:number}>} renderPage
 * @property {(pageNo:number, rect:{x:number,y:number,w:number,h:number}, opts?:{width?:number}) => Promise<{url:string,width:number,height:number}>} renderRegion
 * @property {() => void} close
 */
