const OCR_TIMEOUT = 30000;
const SOLVE_URL = 'http://localhost:8888/solve_captcha';
const DIRECT_URL = 'http://localhost:8888/captcha_direct_url';
const HEALTH_URL = 'http://localhost:8888/health';

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then(buf => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
}

export interface ClickPoint {
  char: string;
  score: number;
  nx: number;
  ny: number;
}

export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function solveCaptcha(
  imageBlob: Blob,
  promptChars: string[]
): Promise<ClickPoint[]> {
  const b64 = await blobToBase64(imageBlob);
  return solveCaptchaBase64(b64, promptChars);
}

export async function solveCaptchaBase64(
  imageBase64: string,
  promptChars: string[]
): Promise<ClickPoint[]> {
  const body = JSON.stringify({ image: imageBase64, prompt_chars: promptChars });
  const res = await fetch(SOLVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(OCR_TIMEOUT),
  });
  if (!res.ok) throw new Error(`PP-OCR server error ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return (data?.points as ClickPoint[]) ?? [];
}

export async function solveCaptchaFromUrl(
  imageUrl: string,
  promptChars: string[]
): Promise<ClickPoint[]> {
  const body = JSON.stringify({ image_url: imageUrl, prompt_chars: promptChars });
  const res = await fetch(DIRECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(OCR_TIMEOUT),
  });
  if (!res.ok) throw new Error(`PP-OCR server error ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return (data?.points as ClickPoint[]) ?? [];
}
