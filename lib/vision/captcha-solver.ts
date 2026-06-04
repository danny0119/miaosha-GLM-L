export interface CaptchaClickPoint {
  char: string;
  nx: number;
  ny: number;
}

interface CharBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rgbaToGrayscale(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }
  return gray;
}

export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sumB = 0, wB = 0, maxVariance = 0, threshold = 0;
  let sum1 = 0;
  for (let i = 0; i < 256; i++) sum1 += i * hist[i];

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum1 - sumB) / wF;
    const diff = mB - mF;
    const variance = wB * wF * diff * diff;
    if (variance > maxVariance) { maxVariance = variance; threshold = t; }
  }
  return threshold;
}

export function binarize(gray: Uint8Array, threshold: number): Uint8Array {
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] < threshold ? 0 : 255;
  return bin;
}

export function findCharContours(
  bin: Uint8Array, w: number, h: number, minArea: number
): CharBox[] {
  const visited = new Uint8Array(w * h);
  const boxes: CharBox[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (bin[idx] !== 0 || visited[idx]) continue;

      let minX = x, maxX = x, minY = y, maxY = y;
      let count = 0;
      const stack: Array<[number, number]> = [[x, y]];
      visited[idx] = 1;

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        count++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nidx = ny * w + nx;
            if (bin[nidx] === 0 && !visited[nidx]) {
              visited[nidx] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }

      if (count >= minArea) {
        boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
  }
  return boxes;
}

function selectTop3Boxes(boxes: CharBox[], imgW: number, imgH: number): CharBox[] {
  if (boxes.length <= 3) return boxes;

  const imgArea = imgW * imgH;
  const medianArea = boxes.map(b => b.w * b.h).sort((a, b) => a - b)[Math.floor(boxes.length / 2)] || 1;

  const filtered = boxes.filter(b => {
    const area = b.w * b.h;
    return area >= medianArea * 0.35 && area <= medianArea * 2.8
      && b.w > 15 && b.h > 15
      && area > 250
      && (b.w / b.h) > 0.3 && (b.w / b.h) < 3.0
      && b.w < imgW * 0.4 && b.h < imgH * 0.4;
  });

  if (filtered.length <= 3) return filtered.length >= 3 ? filtered.slice(0, 3) : filtered;

  const scored = filtered.map(b => ({
    box: b,
    score: (b.w * b.h) * (1 - Math.abs(b.x + b.w / 2 - imgW / 2) / (imgW / 2) * 0.3),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(s => s.box);
}

export function extractCrop(
  data: Uint8ClampedArray, imgW: number, imgH: number, box: CharBox
): Uint8ClampedArray {
  const { x, y, w, h } = box;
  const crop = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = ((y + row) * imgW + (x + col)) * 4;
      const dstIdx = (row * w + col) * 4;
      crop[dstIdx] = data[srcIdx];
      crop[dstIdx + 1] = data[srcIdx + 1];
      crop[dstIdx + 2] = data[srcIdx + 2];
      crop[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  return crop;
}

function renderCharToData(char: string, size: number): ImageData {
  const scale = self.devicePixelRatio || 1;
  const canvas = new OffscreenCanvas(size * scale, size * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  ctx.font = `bold ${size}px "Microsoft YaHei","SimHei","PingFang SC","Noto Sans SC",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, size / 2, size / 2);
  return ctx.getImageData(0, 0, size * scale, size * scale);
}

function resizeTo(
  src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx = (dx / dw) * sw, sy = (dy / dh) * sh;
      const ix = Math.min(Math.floor(sx), sw - 1);
      const iy = Math.min(Math.floor(sy), sh - 1);
      const srcIdx = (iy * sw + ix) * 4;
      const dstIdx = (dy * dw + dx) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  return dst;
}

function binarizeCrop(data: Uint8ClampedArray): Float64Array {
  const len = data.length / 4;
  const gray = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  const thresh = otsuThreshold(new Uint8Array(gray));
  const bin = new Float64Array(len);
  for (let i = 0; i < len; i++) bin[i] = gray[i] < thresh ? 1 : 0;
  return bin;
}

function normalizeBin(bin: Float64Array): Float64Array {
  const sum = bin.reduce((a, b) => a + b, 0);
  if (sum === 0) return bin;
  const mean = sum / bin.length;
  const std = Math.sqrt(bin.reduce((s, v) => s + (v - mean) ** 2, 0) / bin.length) || 1;
  return bin.map(v => (v - mean) / std);
}

function similarity(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) return -1;
  const na = normalizeBin(a);
  const nb = normalizeBin(b);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < na.length; i++) {
    dot += na[i] * nb[i];
    normA += na[i] * na[i];
    normB += nb[i] * nb[i];
  }
  const denom = Math.sqrt(normA * normB);
  return denom === 0 ? 0 : dot / denom;
}

function hungarianAssign(scores: number[][]): number[] {
  const n = scores.length;
  const assignment = new Array(n).fill(-1);
  const used = new Array(n).fill(false);
  const order = Array.from({ length: n }, (_, i) => i);

  for (let region = 0; region < n; region++) {
    let bestChar = -1, bestScore = -Infinity;
    for (let c = 0; c < n; c++) {
      if (!used[c] && scores[region][c] > bestScore) {
        bestScore = scores[region][c];
        bestChar = c;
      }
    }
    assignment[region] = bestChar;
    used[bestChar] = true;
  }
  return assignment.map((charIdx, regionIdx) => {
    const promptIdx = charIdx; // charIdx corresponds to the character in the prompt array
    return promptIdx;
  });
}

export function detectCharBoxes(imageData: ImageData): CharBox[] {
  const w = imageData.width;
  const h = imageData.height;
  const gray = rgbaToGrayscale(imageData.data, w, h);
  const thresh = otsuThreshold(gray);
  const bin = binarize(gray, thresh);
  const minArea = Math.max(50, Math.round((w * h) * 0.003));
  const rawBoxes = findCharContours(bin, w, h, minArea);
  return selectTop3Boxes(rawBoxes, w, h);
}

export async function solveCaptcha(
  imageData: ImageData,
  promptChars: string[]
): Promise<CaptchaClickPoint[]> {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  const gray = rgbaToGrayscale(data, w, h);
  const thresh = otsuThreshold(gray);
  const bin = binarize(gray, thresh);

  const minArea = Math.max(50, Math.round((w * h) * 0.003));
  const rawBoxes = findCharContours(bin, w, h, minArea);
  const boxes = selectTop3Boxes(rawBoxes, w, h);
  if (boxes.length === 0) return [];

  const RENDER_SIZE = 48;
  const COMPARE_SIZE = 32;

  const renderedTemplates = promptChars.map(ch => {
    const rendered = renderCharToData(ch, RENDER_SIZE);
    const resized = resizeTo(rendered.data, rendered.width, rendered.height, COMPARE_SIZE, COMPARE_SIZE);
    return binarizeCrop(resized);
  });

  const crops = boxes.map(box => {
    const crop = extractCrop(data, w, h, box);
    const resized = resizeTo(crop, box.w, box.h, COMPARE_SIZE, COMPARE_SIZE);
    return binarizeCrop(resized);
  });

  const scores = crops.map(cropBin =>
    renderedTemplates.map(tmpl => similarity(cropBin, tmpl))
  );

  const assignments = hungarianAssign(scores);

  const result: CaptchaClickPoint[] = [];
  for (let regionIdx = 0; regionIdx < boxes.length; regionIdx++) {
    const assignedPromptIdx = assignments[regionIdx];
    if (assignedPromptIdx < 0 || assignedPromptIdx >= promptChars.length) continue;
    const box = boxes[regionIdx];
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    result.push({
      char: promptChars[assignedPromptIdx],
      nx: centerX / w,
      ny: centerY / h,
    });
  }

  result.sort((a, b) => promptChars.indexOf(a.char) - promptChars.indexOf(b.char));
  return result;
}

/**
 * Alternative solver for 3×3 grid captcha (Tencent Captcha).
 * Uses local thresholding per cell and a margin to exclude grid lines.
 */
export async function solveGridCaptcha(
  imageData: ImageData,
  promptChars: string[],
): Promise<CaptchaClickPoint[]> {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const rows = 3, cols = 3;
  const cellW = w / cols;
  const cellH = h / rows;
  const RENDER_SIZE = 48;
  const COMPARE_SIZE = 32;
  const MARGIN_FACTOR = 0.12; // exclude 12% from each edge of cell

  // Render prompt character templates
  const renderedTemplates = promptChars.map(ch => {
    const rendered = renderCharToData(ch, RENDER_SIZE);
    const resized = resizeTo(rendered.data, rendered.width, rendered.height, COMPARE_SIZE, COMPARE_SIZE);
    return binarizeCrop(resized);
  });

  // Extract and analyze each grid cell
  const cellScores: Array<{ idx: number; scores: number[] }> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;

      // Cell bounds with margin (shrink inward)
      const marginX = Math.round(cellW * MARGIN_FACTOR);
      const marginY = Math.round(cellH * MARGIN_FACTOR);
      const sx = Math.round(col * cellW) + marginX;
      const sy = Math.round(row * cellH) + marginY;
      const cw = Math.round(cellW) - marginX * 2;
      const ch = Math.round(cellH) - marginY * 2;

      if (cw < 10 || ch < 10) continue;

      // Extract cell pixel data
      const cellBox: CharBox = { x: sx, y: sy, w: cw, h: ch };
      const cellRgba = extractCrop(data, w, h, cellBox);

      // Local Otsu threshold for this cell
      const gray = rgbaToGrayscale(cellRgba, cw, ch);
      const thresh = otsuThreshold(gray);
      const bin = binarize(gray, thresh);

      // Find the largest connected component (the character)
      const components = findCharContours(bin, cw, ch, 1);
      let bestBox: CharBox | null = null;
      let bestArea = 0;
      for (const comp of components) {
        const area = comp.w * comp.h;
        if (area > bestArea) { bestArea = area; bestBox = comp; }
      }
      if (!bestBox) continue;

      // Extract the character from the original RGBA data
      const charCrop = extractCrop(cellRgba, cw, ch, bestBox);
      const resized = resizeTo(charCrop, bestBox.w, bestBox.h, COMPARE_SIZE, COMPARE_SIZE);
      const cellBin = binarizeCrop(resized);

      // Compare to each prompt template
      const sims = renderedTemplates.map(tmpl => similarity(cellBin, tmpl));
      cellScores.push({ idx, scores: sims });
    }
  }

  if (cellScores.length < 3) {
    // Fallback: use full cells without contour extraction
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        if (cellScores.some(c => c.idx === idx)) continue;
        const sx = Math.round(col * cellW);
        const sy = Math.round(row * cellH);
        const cw = Math.round(cellW);
        const ch = Math.round(cellH);
        const box: CharBox = { x: sx, y: sy, w: cw, h: ch };
        const crop = extractCrop(data, w, h, box);
        const resized = resizeTo(crop, cw, ch, COMPARE_SIZE, COMPARE_SIZE);
        const cellBin = binarizeCrop(resized);
        const sims = renderedTemplates.map(tmpl => similarity(cellBin, tmpl));
        cellScores.push({ idx, scores: sims });
      }
    }
  }

  // For each prompt char, find the best matching cell among unassigned cells
  const result: CaptchaClickPoint[] = [];
  const usedCells = new Set<number>();
  for (let pIdx = 0; pIdx < promptChars.length; pIdx++) {
    let bestCellIdx = -1;
    let bestScore = -Infinity;
    for (let cIdx = 0; cIdx < cellScores.length; cIdx++) {
      if (usedCells.has(cellScores[cIdx].idx)) continue;
      const sim = cellScores[cIdx].scores[pIdx];
      if (sim > bestScore) { bestScore = sim; bestCellIdx = cIdx; }
    }
    if (bestCellIdx === -1) continue;
    const gridIdx = cellScores[bestCellIdx].idx;
    usedCells.add(gridIdx);
    const centerX = (gridIdx % cols) * cellW + cellW / 2;
    const centerY = Math.floor(gridIdx / cols) * cellH + cellH / 2;
    result.push({
      char: promptChars[pIdx],
      nx: centerX / w,
      ny: centerY / h,
    });
  }

  result.sort((a, b) => promptChars.indexOf(a.char) - promptChars.indexOf(b.char));
  return result;
}
