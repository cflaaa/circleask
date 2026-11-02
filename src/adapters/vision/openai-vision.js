/**
 * adapters/vision/openai-vision.js —— OpenAI 兼容视觉接口
 *
 * 层：adapters
 * 实现 core/ports/vision-port.js。
 *
 * 注意两件事：
 * 1. 渲染器给的是 blob: 地址，模型 API 收不了，必须转成 data URL。
 * 2. 走 SSE 流式，边收边吐给 core 的 onDelta，界面才能「打字机」效果。
 */

async function blobUrlToDataUrl(url) {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function createOpenAiVision({ endpoint, apiKey, model = 'gpt-4o-mini', maxTokens = 1500 }) {
  return {
    async ask({ imageUrl, prompt, history = [], onDelta }) {
      const dataUrl = await blobUrlToDataUrl(imageUrl);

      const messages = [
        ...history.map((h) => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ];

      const res = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          stream: Boolean(onDelta),
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`模型接口 ${res.status}：${detail.slice(0, 300)}`);
      }

      // 不流式：一次拿完
      if (!onDelta) {
        const json = await res.json();
        return json.choices?.[0]?.message?.content ?? '';
      }

      // 流式：逐行解析 `data: {...}`
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // 最后一行可能不完整，留到下一轮

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            // 半行 JSON，丢掉等下一块
          }
        }
      }

      return full;
    },
  };
}
