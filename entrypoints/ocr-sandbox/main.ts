import { pipeline, env } from '@xenova/transformers';

const LOAD_TIMEOUT_MS = 120000;
let pipe: any = null;
let wasmPaths: string | undefined;

async function initModel(host: string): Promise<void> {
  if (pipe) return;
  env.remoteHost = host;
  env.useCache = true;
  env.backends.onnx.wasm.numThreads = 1;
  if (wasmPaths) {
    env.backends.onnx.wasm.wasmPaths = wasmPaths;
  }
  console.log('[ocr-sandbox] downloading model from', host);
  const timer = setTimeout(() => { throw new Error('timeout'); }, LOAD_TIMEOUT_MS);
  pipe = await pipeline('image-to-text', 'Xenova/trocr-small-printed', { quantized: true });
  clearTimeout(timer);
  console.log('[ocr-sandbox] model loaded from', host);
}

window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg || msg.target !== 'ocr-sandbox') return;

  if (msg.type === 'init') {
    wasmPaths = msg.wasmPaths;
    window.parent.postMessage({ target: 'bm-capture', type: 'sandbox-ready' }, '*');
    return;
  }

  if (msg.type === 'recognize') {
    const hosts = ['https://hf-mirror.com', 'https://huggingface.co'];
    let lastError: string | undefined;
    for (const host of hosts) {
      try {
        await initModel(host);
        lastError = undefined;
        break;
      } catch (e: any) {
        lastError = e.message || String(e);
        console.warn('[ocr-sandbox] failed from', host, e.message);
      }
    }
    if (lastError) {
      window.parent.postMessage({ target: 'bm-capture', type: 'result', msgId: msg.msgId, error: lastError }, '*');
      return;
    }

    try {
      const t_total = performance.now();
      const total = (msg.buffers as string[]).length;
      console.log('[ocr-sandbox] processing', total, 'images');
      const results: any[] = [];
      for (let i = 0; i < total; i++) {
        const t0 = performance.now();
        const dataUrl = 'data:image/png;base64,' + (msg.buffers as string[])[i];
        const r = await pipe(dataUrl, { top_k: 1, max_new_tokens: 3, do_sample: false });
        results.push(r);
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        console.log('[ocr-sandbox] image', i, 'done in', elapsed, 's');
      }
      console.log('[ocr-sandbox] all done, total time:', ((performance.now() - t_total) / 1000).toFixed(1), 's');
      const chars = results.map((r: any) => {
        const t: string = r?.[0]?.generated_text || '';
        console.log('[ocr-sandbox] raw output:', JSON.stringify(t));
        const m = t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/);
        const ch = m?.[0] || t.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').slice(0, 1);
        console.log('[ocr-sandbox] extracted char:', JSON.stringify(ch));
        return ch;
      });
      window.parent.postMessage({ target: 'bm-capture', type: 'result', msgId: msg.msgId, chars }, '*');
    } catch (e: any) {
      console.error('[ocr-sandbox] inference error:', e);
      window.parent.postMessage({ target: 'bm-capture', type: 'result', msgId: msg.msgId, error: e.message || String(e) }, '*');
    }
    return;
  }
});
