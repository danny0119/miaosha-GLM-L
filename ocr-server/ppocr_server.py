"""
PP-OCR + YOLO captcha solver server for miaosha Chrome extension.
Endpoints:
  GET  /health           -> health check
  POST /solve_captcha    -> {image: base64, prompt_chars: string[]} => {points: [{char,score,nx,ny}]}
  POST /{path:path}      -> catch-all (silences 404 from old userscript)
"""
import base64
import io
import json
import math
import sys
from itertools import permutations
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

YOLO_MODEL_PATH = str(ROOT / "yolo-captcha-detector.pt")
MODEL_NAME = "PP-OCRv5_server_rec"
ENGINE = "paddle_dynamic"

if getattr(sys, 'frozen', False):
    import os as _os
    _meipass = sys._MEIPASS
    if 'PATH' in _os.environ and _meipass not in _os.environ['PATH']:
        _os.environ['PATH'] = _meipass + _os.pathsep + _os.environ['PATH']
    _paddle_libs = _os.path.join(_meipass, 'paddle', 'libs')
    if _os.path.isdir(_paddle_libs):
        _paddle_libs_abs = _os.path.realpath(_paddle_libs)
        if _paddle_libs_abs not in _os.environ.get('PATH', ''):
            _os.environ['PATH'] = _paddle_libs_abs + _os.pathsep + _os.environ.get('PATH', '')

for _key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    import os
    os.environ[_key] = "1"

app = FastAPI()


def select_fixed3(boxes, confs, image_size):
    width, height = image_size
    candidates = []
    for box, conf in zip(boxes, confs):
        x1, y1, x2, y2 = box
        bw, bh = x2 - x1, y2 - y1
        area = bw * bh
        if bw < 22 or bh < 22: continue
        if area < 550: continue
        if bw > width * 0.38 or bh > height * 0.38: continue
        if bw < 10 or bh < 10: continue
        candidates.append((box, conf))
    if len(candidates) < 3:
        candidates = sorted(zip(boxes, confs), key=lambda x: x[1], reverse=True)[:5]
        candidates = [(b, c) for b, c in candidates if (max(0, b[2]-b[0]) * max(0, b[3]-b[1])) >= 300][:3]
    candidates = sorted(candidates, key=lambda x: x[1], reverse=True)[:3]
    if len(candidates) < 3:
        candidates = sorted(zip(boxes, confs), key=lambda x: x[1], reverse=True)[:3]
    boxes_out = [b for b, _ in candidates]
    confs_out = [c for _, c in candidates]
    return boxes_out, confs_out


def first_cjk(text: str) -> str:
    return next((ch for ch in text if "\u4e00" <= ch <= "\u9fff"), "")


def predict_with_candidate_scores(recognizer, np_img_bgr: np.ndarray, prompt: list[str]) -> dict:
    predictor = recognizer.paddlex_predictor
    batch_imgs = predictor.pre_tfs["ReisizeNorm"](imgs=[np_img_bgr])
    x = predictor.pre_tfs["ToBatch"](imgs=batch_imgs)
    batch_preds = predictor.runner(x=x)
    probs = np.array(batch_preds[0] if isinstance(batch_preds, (list, tuple)) else batch_preds)
    texts, scores = predictor.post_op(batch_preds)

    candidate_scores = {}
    for char in prompt:
        idx = predictor.post_op.dict.get(char)
        candidate_scores[char] = 0.0 if idx is None else float(probs[0, :, idx].max())

    best_char = (
        max(candidate_scores, key=candidate_scores.get)
        if candidate_scores else first_cjk(str(texts[0]))
    )
    return {
        "text": str(texts[0]),
        "char": best_char,
        "score": float(candidate_scores.get(best_char, scores[0] if scores else 0.0) or 0.0),
        "candidate_scores": candidate_scores,
    }


def assign_prompt_globally(rows: list[dict], prompt: list[str]) -> list[dict]:
    if len(rows) != len(prompt):
        return rows
    best_perm, best_score = None, -float("inf")

    def _permutations(items):
        if len(items) <= 1:
            yield tuple(items)
            return
        for idx, item in enumerate(items):
            for suffix in _permutations(items[:idx] + items[idx + 1:]):
                yield (item,) + suffix

    for perm in _permutations(list(prompt)):
        score = sum(
            math.log(
                max(float((r.get("candidate_scores") or {}).get(c, 0.0) or 0.0), 1e-12)
            )
            for r, c in zip(rows, perm)
        )
        if score > best_score:
            best_score, best_perm = score, perm

    if best_perm is None:
        return rows
    assigned = []
    for row, char in zip(rows, best_perm):
        updated = dict(row)
        updated["raw_char"] = updated.get("char", "")
        updated["char"] = char
        updated["score"] = float(
            (updated.get("candidate_scores") or {}).get(char, updated.get("score", 0.0))
            or 0.0
        )
        assigned.append(updated)
    return assigned


def load_models():
    from paddleocr import TextRecognition
    from ultralytics import YOLO
    import torch

    recognizer = TextRecognition(model_name=MODEL_NAME, device="cpu", engine=ENGINE)
    yolo = YOLO(YOLO_MODEL_PATH)
    if torch.cuda.is_available():
        yolo.to("cuda")
    return recognizer, yolo


recognizer, yolo = None, None


@app.on_event("startup")
def startup():
    global recognizer, yolo
    recognizer, yolo = load_models()
    print("[server] PP-OCR + YOLO ready on :8888", flush=True)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/solve_captcha")
async def solve_captcha(req: Request):
    body = await req.json()
    image_b64 = body.get("image")
    prompt_chars = body.get("prompt_chars", [])

    if not image_b64 or not prompt_chars:
        return JSONResponse({"error": "Missing image or prompt_chars"}, status_code=400)

    image_bytes = io.BytesIO(base64.b64decode(image_b64))
    pil_img = Image.open(image_bytes).convert("RGB")
    img_w, img_h = pil_img.size

    # YOLO detection
    yolo_results = yolo(pil_img, conf=0.3, iou=0.5, verbose=False)
    raw_boxes = []
    raw_confs = []
    for result in yolo_results:
        for box, conf, cls_id in zip(result.boxes.xyxy.cpu().numpy(), result.boxes.conf.cpu().numpy(), result.boxes.cls.cpu().numpy()):
            x1, y1, x2, y2 = box
            raw_boxes.append([float(x1), float(y1), float(x2), float(y2)])
            raw_confs.append(float(conf))

    boxes, confs = select_fixed3(raw_boxes, raw_confs, (img_w, img_h))
    if len(boxes) < 3:
        return JSONResponse({"points": [], "error": "Not enough boxes detected"}, status_code=200)

    # OCR each box
    ocr_rows = []
    for box in boxes:
        x1, y1, x2, y2 = map(int, box)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(img_w, x2), min(img_h, y2)
        crop = pil_img.crop((x1, y1, x2, y2))
        np_bgr = np.array(crop, dtype=np.uint8)[:, :, ::-1]
        row = predict_with_candidate_scores(recognizer, np_bgr, prompt_chars)
        ocr_rows.append(row)

    # Global assignment
    if len(ocr_rows) == len(prompt_chars):
        ocr_rows = assign_prompt_globally(ocr_rows, prompt_chars)

    # Build points in PROMPT ORDER
    used = set()
    mapping = []
    for ch in prompt_chars:
        for i, row in enumerate(ocr_rows):
            if i not in used and row.get("char") == ch:
                mapping.append(i)
                used.add(i)
                break
        else:
            mapping.append(-1)

    if -1 in mapping:
        mapping = list(range(len(ocr_rows)))

    points = []
    for pi, bi in enumerate(mapping):
        if bi >= len(boxes):
            continue
        box = boxes[bi]
        cx = (box[0] + box[2]) / 2 / img_w
        cy = (box[1] + box[3]) / 2 / img_h
        row = ocr_rows[bi]
        points.append({
            "char": prompt_chars[pi] if pi < len(prompt_chars) else "",
            "score": row.get("score", 0.0),
            "nx": round(cx, 4),
            "ny": round(cy, 4),
        })

    return {"points": points}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, req: Request):
    return JSONResponse({"status": "ignored"}, status_code=200)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8888, log_level="info")
