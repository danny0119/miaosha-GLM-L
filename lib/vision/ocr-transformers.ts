let msgCounter = 0;

export async function recognizeChars(blobs: Blob[], tabId: number): Promise<string[]> {
  if (blobs.length === 0) return [];
  const msgId = ++msgCounter;

  const buffers = await Promise.all(blobs.map(b => blobToBase64(b)));

  const sendPromise = new Promise<any>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      target: 'bm-capture',
      type: 'RECOGNIZE_REQUEST',
      msgId,
      buffers,
    }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });

  const timeoutPromise = new Promise<any>((_, reject) => {
    setTimeout(() => reject(new Error('OCR timeout')), 135000);
  });

  const response = await Promise.race([sendPromise, timeoutPromise]);
  if (response?.error) throw new Error(response.error);
  return (response?.chars as string[]) ?? [];
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then(buf => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  });
}

export function isModelReady(): boolean {
  return true;
}
