/**
 * adapters/vision/echo-vision.js —— 本地假模型
 *
 * 层：adapters
 * 用途：没有 API key 时把整条链路跑通（圈选→出图→流式回答→留标记）。
 * 回答里故意带 LaTeX，方便验证公式渲染。
 */

const SAMPLE = `这块在讲 **pn 结的空间电荷区**。

当 p 型与 n 型接触后，载流子互相扩散并复合，留下不能移动的离子，
形成一个宽度为 $W$ 的耗尽层：

$$W = \\sqrt{\\frac{2\\varepsilon_s}{q}\\left(\\frac{1}{N_A}+\\frac{1}{N_D}\\right)V_{bi}}$$

其中内建电势

$$V_{bi} = \\frac{kT}{q}\\ln\\frac{N_A N_D}{n_i^2}$$

所以看到 $V_{bi}$ 出现在根号里，说明**掺杂浓度越高、耗尽层越窄**。

（这是本地假模型的固定回答，配置真实接口后即换成真回答。）`;

export function createEchoVision({ delayMs = 28 } = {}) {
  return {
    async ask({ onDelta }) {
      if (!onDelta) return SAMPLE;
      // 按字符切片吐，模拟流式
      for (let i = 0; i < SAMPLE.length; i += 3) {
        const chunk = SAMPLE.slice(i, i + 3);
        onDelta(chunk);
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return SAMPLE;
    },
  };
}
