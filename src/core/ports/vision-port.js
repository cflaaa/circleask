/**
 * core/ports/vision-port.js —— 视觉模型端口
 *
 * 层：core（功能层）
 * 规矩：core 不拼 URL、不带 API key、不管是不是 OpenAI。
 *      它只说「这张图，配这段话，给我答案」。
 */

export const VisionPort = {
  /**
   * @param {Object} req
   * @param {string} req.imageUrl   图片地址（core 从渲染端口拿到的那个 url）
   * @param {string} req.prompt     完整提示词（由 core 的业务规则生成）
   * @param {Array<{role:string,content:string}>} [req.history] 追问上下文
   * @param {(chunk:string)=>void} [req.onDelta] 流式增量回调
   * @returns {Promise<string>} 完整回答
   */
  ask(req) {},
};
