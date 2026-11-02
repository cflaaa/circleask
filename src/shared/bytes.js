/**
 * shared/bytes.js —— Blob / File → ArrayBuffer
 *
 * 层：叶子工具。不依赖任何一层，adapters 和 ui 都可以用。
 *
 * 为什么需要它：Chrome 72 的 Blob 还没有 arrayBuffer()（76 才加），
 * 而目标机就是 WebView 72，直接 `blob.arrayBuffer()` 会抛
 * "blob.arrayBuffer is not a function"。
 * 这条转换放在这里，core 就不用知道 FileReader 的存在。
 */

export function readBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('读取文件失败'));
    fr.readAsArrayBuffer(blob);
  });
}
