// Signal ready immediately on load (minimal test — no iframe, no model)
chrome.runtime.sendMessage({ target: 'bg-ocr', type: 'ready' }).catch(() => {});

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg.target !== 'ocr-offscreen') return false;
  return false;
});
