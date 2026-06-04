/**
 * Global Vitest setup — runs before every test file.
 *
 * 1. Extends Vitest's expect with @testing-library/jest-dom matchers
 *    (toBeInTheDocument, toHaveTextContent, etc.)
 * 2. Resets the WXT fakeBrowser in-memory state before each test so
 *    chrome.storage, chrome.tabs etc. are clean.
 */

import '@testing-library/jest-dom/vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, vi } from 'vitest';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(vi.fn()),
  env: { backends: { onnx: { wasm: { wasmPaths: '' } } } },
}));

beforeEach(() => {
  fakeBrowser.reset();
});
