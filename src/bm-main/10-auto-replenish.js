// ── Auto-Replenish: auto-solve each captcha opened in batch mode ──

var CAPTCHA_GRID_ROWS = 3;
var CAPTCHA_GRID_COLS = 3;

function findCaptchaContainer() {
  return document.querySelector('#tCaptchaDyContent, #tCaptchaDyMainWrap, .tencent-captcha-dy__content');
}

function getCaptchaImageRect() {
  var el = document.querySelector('.tencent-captcha-dy__image-area, .tencent-captcha-dy__verify-bg-img');
  return el ? el.getBoundingClientRect() : null;
}

function getBestCaptchaRect() {
  var container = document.querySelector('.tencent-captcha-dy__image-area, .tencent-captcha-dy__verify-bg-img');
  if (!container) return null;
  // Prefer the actual img/canvas element (excludes container padding)
  var imgEl = container.querySelector('img, canvas') || container;
  var r = imgEl.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function getBackgroundImageUrl(el) {
  var bg = '';
  try {
    bg = (el.style && el.style.backgroundImage) || window.getComputedStyle(el).backgroundImage || '';
  } catch(e) {}
  var m = bg.match(/url\(["']?([^"')]+)/);
  if (!m) return null;
  try { return new URL(m[1], location.href).href; } catch(e) { return m[1]; }
}

function getCaptchaImageData() {
  var container = document.querySelector('.tencent-captcha-dy__image-area, .tencent-captcha-dy__verify-bg-img');
  if (!container) return null;

  // Strategy 1: find the actual captcha bg div (has background-image)
  var bgEl = container.querySelector('.tencent-captcha-dy__bg-img, .tencent-captcha-dy__verify-bg-img, [class*="bg-img"], [class*="verify-bg"]');
  if (bgEl) {
    var bgUrl = getBackgroundImageUrl(bgEl);
    if (bgUrl) {
      var br = bgEl.getBoundingClientRect();
      return {
        rect: { x: br.x, y: br.y, w: br.width, h: br.height },
        dataUrl: bgUrl,
        naturalW: br.width,
        naturalH: br.height,
      };
    }
  }

  // Strategy 2: find large img/canvas elements (skip tiny icons ≤ 50px)
  var images = container.querySelectorAll('img, canvas');
  for (var i = 0; i < images.length; i++) {
    var el = images[i];
    var nw = el.naturalWidth || el.width || 0;
    var nh = el.naturalHeight || el.height || 0;
    if (nw < 50 || nh < 50) continue;
    var rect = el.getBoundingClientRect();
    var dataUrl = null;
    if (el.tagName === 'IMG') {
      if (el.src && el.src !== '' && !el.src.startsWith('blob:')) {
        dataUrl = el.src;
      } else {
        try {
          var c = document.createElement('canvas');
          c.width = nw;
          c.height = nh;
          c.getContext('2d').drawImage(el, 0, 0);
          dataUrl = c.toDataURL('image/png');
        } catch(e) {
          dataUrl = el.src || null;
        }
      }
    } else if (el.tagName === 'CANVAS') {
      dataUrl = el.toDataURL('image/png');
    }
    if (dataUrl) {
      return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, dataUrl: dataUrl, naturalW: nw, naturalH: nh };
    }
  }

  // Strategy 3: container has background-image
  var bgUrl = getBackgroundImageUrl(container);
  if (bgUrl) {
    var cr = container.getBoundingClientRect();
    return {
      rect: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
      dataUrl: bgUrl,
      naturalW: cr.width,
      naturalH: cr.height,
    };
  }

  return null;
}

function getCaptchaImageData() {
  var container = document.querySelector('.tencent-captcha-dy__image-area, .tencent-captcha-dy__verify-bg-img');
  if (!container) return null;
  var imgEl = container.querySelector('img, canvas') || container;
  var rect = imgEl.getBoundingClientRect();
  var dataUrl = null;
  var naturalW = imgEl.naturalWidth || imgEl.width || rect.width;
  var naturalH = imgEl.naturalHeight || imgEl.height || rect.height;
  if (imgEl.tagName === 'IMG') {
    if (imgEl.src && imgEl.src !== '' && !imgEl.src.startsWith('blob:')) {
      dataUrl = imgEl.src;
    } else {
      try {
        var c = document.createElement('canvas');
        c.width = naturalW;
        c.height = naturalH;
        c.getContext('2d').drawImage(imgEl, 0, 0);
        dataUrl = c.toDataURL('image/png');
      } catch(e) {
        dataUrl = imgEl.src || null;
      }
    }
  } else if (imgEl.tagName === 'CANVAS') {
    dataUrl = imgEl.toDataURL('image/png');
  } else {
    // No img or canvas — try extracting CSS background-image URL
    var bgUrl = getBackgroundImageUrl(container);
    if (bgUrl) {
      dataUrl = bgUrl;
      naturalW = container.offsetWidth || rect.width;
      naturalH = container.offsetHeight || rect.height;
    } else {
      return null;
    }
  }
  return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, dataUrl: dataUrl, naturalW: naturalW, naturalH: naturalH };
}

function getCaptchaGridCells() {
  var rect = getCaptchaImageRect();
  if (!rect) return null;
  var cells = [];
  var cellW = rect.width / CAPTCHA_GRID_COLS;
  var cellH = rect.height / CAPTCHA_GRID_ROWS;
  for (var row = 0; row < CAPTCHA_GRID_ROWS; row++) {
    for (var col = 0; col < CAPTCHA_GRID_COLS; col++) {
      cells.push({
        index: row * CAPTCHA_GRID_COLS + col,
        cx: rect.left + col * cellW + cellW / 2,
        cy: rect.top + row * cellH + cellH / 2,
      });
    }
  }
  return { cells: cells, cellW: cellW, cellH: cellH };
}

function readPromptText() {
  var headerEl = document.querySelector('.tencent-captcha-dy__header-text');
  if (headerEl) {
    var text = (headerEl.textContent || '').trim();
    var idx = text.indexOf('依次点击');
    if (idx !== -1) {
      var after = text.substring(idx + 4);
      var parts = after.split(/[：:]/);
      var charsPart = parts.length >= 2 ? parts[1] : after;
      var chars = charsPart.replace(/[，、,.\s]/g, '').split('');
      var clean = chars.filter(function(c) {
        return c.length === 1 && c.match(/[\u4e00-\u9fff\u3400-\u4dbf]/);
      });
      if (clean.length >= 3) return clean.slice(0, 3);
    }
  }
  return null;
}

function clickElement(clientX, clientY) {
  var opts = { clientX: clientX, clientY: clientY, bubbles: true, cancelable: true, view: window, button: 0 };
  var target = document.elementFromPoint(clientX, clientY) || document.body;
  target.dispatchEvent(new MouseEvent('mousedown', opts));
  target.dispatchEvent(new MouseEvent('mouseup', opts));
  target.dispatchEvent(new MouseEvent('click', opts));
}

function waitForCaptcha(timeoutMs) {
  return new Promise(function(resolve) {
    var start = Date.now();
    function check() {
      var container = findCaptchaContainer();
      if (container && container.offsetParent !== null) {
        resolve(container); return;
      }
      if (Date.now() - start > timeoutMs) { resolve(null); return; }
      setTimeout(check, 200);
    }
    setTimeout(check, 500);
  });
}

// Called from 04-captcha.js produceCaptcha() when _batchMode && _replenishEnabled
function autoSolveCurrentCaptcha() {
  console.log('[miaosha] auto-solve started');
  waitForCaptcha(12000).then(function(container) {
    if (!container) {
      console.log('[miaosha] captcha container not found');
      var lg = document.getElementById('_log');
      if (lg) lg.innerHTML += '> Auto-replenish: captcha not found<br>';
      return;
    }
    console.log('[miaosha] captcha container found');
    setTimeout(function() {
      if (!_batchMode || !_replenishEnabled) return;
      var promptChars = readPromptText();
      if (!promptChars || promptChars.length < 3) {
        console.log('[miaosha] prompt chars not found');
        return;
      }
      console.log('[miaosha] prompt=' + promptChars.join(','));
      var bestRect = getBestCaptchaRect();
      if (!bestRect) {
        console.log('[miaosha] captcha rect not found');
        return;
      }
      console.log('[miaosha] bestRect=' + JSON.stringify(bestRect));
      // Send to ISOLATED world for OCR via screenshot
      postMsg('AUTO_REPLENISH_MODAL_OPEN', {
        iframeRect: bestRect,
        promptChars: promptChars,
      });
    }, 1000);
  });
}

function clickConfirmButton() {
  // Try multiple strategies to find the confirm button
  var btn = null;
  // Strategy 1: by text "确定" or "确认" within captcha container
  var container = findCaptchaContainer();
  if (container) {
    var allEls = container.querySelectorAll('button, a, div[class*="btn"], div[class*="footer"], span[class*="btn"]');
    for (var i = 0; i < allEls.length; i++) {
      var txt = (allEls[i].textContent || '').trim();
      if (txt.indexOf('确定') !== -1 || txt.indexOf('确认') !== -1) { btn = allEls[i]; break; }
    }
  }
  // Strategy 2: search whole document
  if (!btn) {
    var allEls = document.querySelectorAll('button, a, div[class*="btn"], div[class*="footer"]');
    for (var i = 0; i < allEls.length; i++) {
      var txt = (allEls[i].textContent || '').trim();
      if (txt.indexOf('确定') !== -1 || txt.indexOf('确认') !== -1) { btn = allEls[i]; break; }
    }
  }
  // Strategy 3: common Tencent Captcha class names
  if (!btn) {
    btn = document.querySelector('.tencent-captcha-dy__footer-btn, .tCaptcha-dy__footer-btn, #tCaptchaDyContent button, .tCaptcha-btn');
    if (!btn) {
      // Strategy 4: last button in the captcha container
      if (container) {
        var buttons = container.querySelectorAll('button');
        btn = buttons[buttons.length - 1];
      }
    }
  }
  if (btn) {
    var rect = btn.getBoundingClientRect();
    clickElement(rect.left + rect.width / 2, rect.top + rect.height / 2);
    console.log('[miaosha] clicked confirm button');
    return true;
  }
  console.log('[miaosha] confirm button not found');
  return false;
}

function waitForCaptchaClose(timeoutMs) {
  return new Promise(function(resolve) {
    var start = Date.now();
    function check() {
      var container = findCaptchaContainer();
      if (!container || container.offsetParent === null) {
        resolve(true); return;
      }
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 200);
    }
    setTimeout(check, 500);
  });
}

function waitForNextCaptcha(timeoutMs) {
  return waitForCaptcha(timeoutMs);
}

// Receive click coords from ISOLATED world
window.addEventListener('message', function(ev) {
  if (ev.source !== window || !ev.data || !ev.data.__miaosha_cmd) return;
  if (ev.data.type === 'CAPTCHA_CLICK' && _batchMode && _replenishEnabled) {
    var d = ev.data.data;
    if (d && d.points && d.points.length > 0) {
      console.log('[miaosha] CAPTCHA_CLICK received: ' + d.points.length + ' points');
      var totalClicks = d.points.length;
      for (var j = 0; j < totalClicks; j++) {
        var pt = d.points[j];
        console.log('[miaosha] point ' + j + ' char=' + pt.char + ' at (' + pt.pageX + ',' + pt.pageY + ')');
        (function(cx, cy, isLast) {
          setTimeout(function() {
            clickElement(cx, cy);
            if (isLast) {
              setTimeout(function() {
                clickConfirmButton();
                waitForCaptchaClose(5000).then(function(closed) {
                  if (closed) {
                    console.log('[miaosha] captcha closed, ticket produced');
                    var lg = document.getElementById('_log');
                    if (lg) lg.innerHTML += '> Auto-replenish: captcha solved<br>';
                    if (_batchMode && _replenishEnabled) {
                      console.log('[miaosha] scheduling next auto-solve');
                      setTimeout(autoSolveCurrentCaptcha, 2000);
                    }
                  }
                });
              }, 800);
            }
          }, j * 400);
        })(pt.pageX, pt.pageY, j === totalClicks - 1);
      }
    }
  }
});
