function produceCaptcha() {
  if (typeof window.TencentCaptcha === 'undefined') { postMsg('CAPTCHA_ERROR', { msg: 'SDK not loaded' }); return; }
  try {
    var c = new window.TencentCaptcha(CAPTCHA_APPID, function(res) {
      _activeCaptcha = null;
      if (res.ret === 0 && res.ticket) {
        postMsg('CAPTCHA_PRODUCED', { ticket: res.ticket, randstr: res.randstr });
        // Batch mode: count and auto-stop at session limit
        if (_batchMode) {
          _batchCount++;
          if (_batchCount >= BATCH_SESSION_LIMIT) {
            setBatchMode(false);
            return;
          }
          setTimeout(produceCaptcha, 300);
        }
      }
      else {
        postMsg('CAPTCHA_ERROR', { msg: 'Failed (ret=' + res.ret + ')' });
        if (_batchMode) { setTimeout(produceCaptcha, 500); }
      }
    }, { mode: 'popup' });
    _activeCaptcha = c;
    c.show();
    // If batch mode with replenish, auto-solve this captcha
    if (_batchMode && _replenishEnabled) {
      console.log('[miaosha] Auto-replenish: scheduling auto-solve');
      setTimeout(autoSolveCurrentCaptcha, 1000);
    } else {
      console.log('[miaosha] Auto-replenish skipped: batchMode=' + _batchMode + ' replenishEnabled=' + _replenishEnabled);
    }
  } catch(e) { postMsg('CAPTCHA_ERROR', { msg: e.message }); }
}

// Force-destroy the currently active captcha modal (for ESC / force-stop)
function destroyActiveCaptcha() {
  if (!_activeCaptcha) return;
  try { _activeCaptcha.destroy(); } catch(e) {}
  _activeCaptcha = null;
}

function setBatchMode(on) {
  _batchMode = on;
  if (on) {
    _batchCount = 0;
    // Override batch limit when auto-replenish is on
    if (_replenishEnabled) {
      BATCH_SESSION_LIMIT = _replenishTarget;
    }
  }
  var btn = document.getElementById('_ab');
  if (btn) {
    if (on) {
      btn.innerHTML = '&#9632; Stop Batch <span style="font-size:7px;font-weight:600;opacity:.6;margin-left:4px">(Esc)</span>';
      btn.style.borderColor = '#dc2626';
      btn.style.color = '#dc2626';
      btn.style.background = 'rgba(220,38,38,0.03)';
    } else {
      btn.innerHTML = '+ Solve Captcha';
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.style.background = '';
    }
  }
  // Notify ISOLATED world to show/hide the full-width force-stop banner
  postMsg('BATCH_MODE_STATUS', { active: on });
  if (on) {
    produceCaptcha();
  } else {
    // Immediately close any active captcha modal
    destroyActiveCaptcha();
  }
}

function toggleBatchMode() { setBatchMode(!_batchMode); }

// ── Keyboard shortcut: Escape to stop batch ──
function setupCaptchaKeyboard() {
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _batchMode) {
      e.preventDefault();
      e.stopPropagation();
      // Force-destroy the modal BEFORE setting batch mode off,
      // so the modal closes instantly without waiting for callback.
      destroyActiveCaptcha();
      setBatchMode(false);
    }
  }, true);
}
setupCaptchaKeyboard();

// ── Listen for replenish config from ISOLATED world ──
window.addEventListener('message', function(ev) {
  if (ev.source !== window || !ev.data || !ev.data.__miaosha_overlay) return;
  if (ev.data.type === 'REPLENISH_CONFIG' && ev.data.data) {
    _replenishEnabled = !!ev.data.data.enabled;
    _replenishTarget = ev.data.data.targetCount || 30;
    console.log('[miaosha] REPLENISH_CONFIG received', _replenishEnabled, _replenishTarget);
  }
});
