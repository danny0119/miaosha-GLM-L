// ── Overlay HTML ──
function buildHTML() {
  return '<style>' + CSS + '</style>' +

    // Header
    '<div class="h"><span>&#128736;</span><h3>智谱秒杀助手</h3><button class="mn" id="_mn">&#8722;</button></div>' +
    '<div class="b" id="_bd">' +

    // Card 1: Preparations
    '<div class="c"><div class="ch"><span class="ct">&#128736; Preparations</span><span class="tg tg-a">AUDIT</span></div>' +
    '<div class="pg">' +
      '<div class="pc"><span class="pd" id="_ck"></span><span class="pn">Cookie</span></div>' +
      '<div class="pc"><span class="pd" id="_ui"></span><span class="pn">User Info</span></div>' +
      '<div class="pc"><span class="pd" id="_pi"></span><span class="pn">Product ID</span></div>' +
      '<div class="pc" id="_cp"><span class="pd w" id="_cpd"></span><span class="pn">Captcha</span><span class="pb" id="_cpb"></span></div>' +
    '</div>' +
    '<div id="_authBanner" style="display:none;margin-top:5px;padding:5px 8px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;font-size:7px;color:#dc2626;text-align:center">' +
    '&#9888; 请 <a href="/login" style="color:#6366f1;text-decoration:underline;font-weight:700">登录 / 注册</a> 后再使用助手' +
    '</div>' +
    '</div>' +

    // Card 2: Target Products
    '<div class="c" id="_prodCard">' +
    '<div class="ch"><span class="ct">&#128230; Target Products</span><span class="tg tg-a" id="_prodTag">LOADING</span></div>' +
    '<div class="pr-bill" id="_bill">' +
      '<button class="pr-bl" data-b="monthly">月付</button>' +
      '<button class="pr-bl on" data-b="quarterly">季付 9折</button>' +
      '<button class="pr-bl" data-b="yearly">年付 8折</button>' +
    '</div>' +
    '<div id="_prodList"><div style="font-size:8px;color:#94a3b8;text-align:center;padding:8px">Loading products...</div></div>' +
    '<div class="pr-sel" id="_prodSel"></div>' +
    '</div>' +

    // Card 3: Captcha Pool
    '<div class="c" id="_poolCard">' +
    '<div class="pl-h"><span class="pl-l">&#127915; Captcha Pool</span><span class="pl-c" id="_plc">0 <span class="pl-t"></span></span></div>' +
    '<div class="gr" id="_grid"></div>' +
    '<button class="ab" id="_ab">+ Solve Captcha</button>' +
    '</div>' +

    // Card 3: Fire
    '<div class="c">' +
    '<div class="ch"><span class="ct">&#128293; Fire</span><span class="tg tg-r">LAUNCH</span></div>' +
    '<div class="fm" id="_meter"></div>' +
    '<div class="fi"><div><div class="fn" style="color:#f43f5e" id="_fc">0</div><div class="fl">tickets</div></div>' +
    '<div><div class="fn" style="color:#6366f1" id="_selc">0</div><div class="fl">selected</div></div>' +
    '<div><div class="fn" style="color:#10b981" id="_mx">0</div><div class="fl">requests</div></div></div>' +
    '<button class="fb" id="_fb" disabled>&#9889; FIRE (0)</button>' +
    '<div style="font-size:8px;color:#64748b;text-align:center;padding:3px 0" id="_ammo"></div>' +
    '<div style="font-size:8px;color:#94a3b8;text-align:center;padding:2px 0" id="_auths">Auth: pending</div>' +
    '<div style="font-size:8px;color:#94a3b8;text-align:center;padding:2px 0" id="_auto">Auto: waiting…</div>' +
    '<div class="lg" id="_log"></div>' +
    '</div>' +

    // Card 4: Hub (multi-account)
    '<div class="c" id="_hubCard">' +
    '<div class="ch"><span class="ct">&#128101; Hub</span><span class="tg tg-b" id="_hubTag">OFF</span></div>' +
    '<div id="_hubBody" style="display:none">' +
    '<div class="hub-status" style="display:flex;gap:12px;justify-content:center;padding:6px 0 10px;font-size:8px;color:#94a3b8">' +
      '<span>Accounts: <strong id="_hubAcctCount" style="color:#64748b">0</strong></span>' +
      '<span>Authed: <strong id="_hubAuthedCount" style="color:#10b981">0</strong></span>' +
    '</div>' +
    '<div id="_hubAcctList" style="font-size:7px;margin-bottom:8px"></div>' +
    '<button class="fb" id="_hfb" disabled>&#128101; HUB FIRE (0)</button>' +
    '</div>' +
    '</div>' +

    // Card 5: Runtime
    '<div class="c">' +
    '<div class="ch"><span class="ct">&#9201; Runtime</span><span class="tg tg-g">LIVE</span></div>' +
    '<div class="rr"><div class="rb"><div class="rv" style="color:#06b6d4" id="_lat">--<span style="font-size:9px;color:#94a3b8">ms</span></div><div class="rl">Latency</div></div>' +
    '<div class="rb"><div class="rv" style="color:#f59e0b" id="_clk">--<span style="font-size:9px;color:#94a3b8">ms</span></div><div class="rl">Clock Offset</div></div></div>' +
    '</div>' +

    // Card 5: Payment
    '<div class="c"><div class="pw" id="_pay"><div class="ph"><span>&#128179;</span><span class="pt">Payment</span><span class="ps sg" id="_pays">WAITING</span></div>' +
    '<div class="pw-t" id="_payt">Waiting for order data...</div></div></div>' +

    '</div>';
}

// ── Overlay Injection ──
function injectOverlay() {
  if (document.getElementById(O)) return;
  // Only show overlay UI on the target page
  if (location.pathname !== '/glm-coding') return;
  var overlay = document.createElement('div');
  overlay.id = O;
  overlay.innerHTML = buildHTML();
  (document.body || document.documentElement).appendChild(overlay);

  // Meter
  var meter = document.getElementById('_meter');
  if (meter) { var mh = ''; for (var i=0;i<10;i++) mh += '<div class="fp" id="_fp'+i+'"></div>'; meter.innerHTML = mh; }

  // State polling
  function poll() { cmdToOverlay('GET_TICKET_COUNT'); }
  setInterval(poll, 1000);
  setTimeout(poll, 500);

  // Setup XHR interception after DOM is ready
  setupXhrInterception();

  // Listen for state updates
  window.addEventListener('message', function(ev) {
    if (ev.source !== window || !ev.data || !ev.data.__miaosha_overlay) return;
    var d = ev.data;

    // Ticket count + TTL
    if (d.type === 'TICKET_COUNT') {
      var c = (d.data && d.data.count) || d.count || 0;
      var t = (d.data && d.data.ttl) || d.ttl || 0;
      _ticketCount = c;
      var plc = document.getElementById('_plc');
      if (plc) plc.innerHTML = c + ' <span class="pl-t">' + (c > 0 && t > 0 ? '(' + Math.ceil(t/1000) + 's)' : '') + '</span>';
      // Grid
      var g = document.getElementById('_grid');
      if (g) { var gh = ''; for (var i=0;i<10;i++) gh += '<div class="sl' + (i < c ? ' f' : '') + '">' + (i < c ? (i+1) : '') + '</div>'; g.innerHTML = gh; }
      syncSelectionStatus();
    }

    // Fire results
    if (d.type === 'FIRE_RESULT') {
      var lg = document.getElementById('_log');
      if (lg) { lg.innerHTML += d.line + '<br>'; lg.scrollTop = lg.scrollHeight; }
    }

    // Sale time config → schedule auto-fire
    if (d.type === 'SALE_TIME_CONFIG' && d.data && d.data.nextSaleTime) {
      scheduleAutoFire(d.data.nextSaleTime);
    }

    // Captcha config → update batch session limit
    if (d.type === 'CAPTCHA_CONFIG' && d.data) {
      var limit = Number(d.data.batchSessionLimit);
      if (limit > 0 && isFinite(limit)) {
        BATCH_SESSION_LIMIT = Math.round(limit);
      }
    }

    // Runtime calibration (latency + clock offset) from multi-probe estimator
    if (d.type === 'RUNTIME_CALIBRATION' && d.data) {
      var ok = applyRuntimeCalibration(d.data);
      if (ok) {
        var lgCal = document.getElementById('_log');
        if (lgCal) {
          var source = d.data.reason || 'runtime';
          var samples = typeof d.data.sampleCount === 'number' ? d.data.sampleCount : 0;
          lgCal.innerHTML += '> Runtime calibrated (' + source + '): L=' + _rt.latencyMs + 'ms O=' + _rt.clockOffsetMs + 'ms n=' + samples + '<br>';
          lgCal.scrollTop = lgCal.scrollHeight;
        }
      }
    }

    // Batch preview data from extension storage (background alarm or page XHR)
    if (d.type === 'BATCH_PREVIEW_DATA' && d.data) {
      _authFailed = false;
      var banner = document.getElementById('_authBanner');
      if (banner) banner.style.display = 'none';
      updateProductMatrix(d.data);
    }

    // Stock cleared: any product transitioned soldOut true→false.
    // Content script has already played 10 alarm beeps.
    // Here: auto-select cleared products, persist, then fire if tickets ready.
    if (d.type === 'SOLDOUT_CLEARED' && d.data) {
      var clearedIds = d.data.clearedIds || [];
      var lgSo = document.getElementById('_log');
      var autoElSo = document.getElementById('_auto');
      var tsSo = new Date().toISOString().slice(11, 23);

      if (lgSo) {
        lgSo.innerHTML += '> ⚡ STOCK CLEARED (' + clearedIds.length + (clearedIds.length !== 1 ? ' products' : ' product') + ') @ ' + tsSo + '<br>';
        lgSo.scrollTop = lgSo.scrollHeight;
      }

      // Replace all selections with only the cleared products
      _selectedProducts = {};
      for (var ci = 0; ci < clearedIds.length; ci++) {
        _selectedProducts[clearedIds[ci]] = true;
      }
      persistSelection();
      renderProducts();
      syncSelectionStatus();

      if (autoElSo) { autoElSo.style.color = '#ef4444'; autoElSo.textContent = '⚡ STOCK CLEARED'; }

      // Auto-fire after a short delay to let the PRODUCT_SELECTION_CHANGED storage write settle
      var summarySo = getSelectionSummary();
      if (summarySo.launchable > 0) {
        if (lgSo) { lgSo.innerHTML += '> Auto-fire: soldout-cleared (' + summarySo.launchable + ' requests)<br>'; lgSo.scrollTop = lgSo.scrollHeight; }
        if (autoElSo) autoElSo.textContent = '⚡ FIRING (soldout cleared)';
        setTimeout(function() {
          window.postMessage({ __miaosha_cmd: true, type: 'PREFIRE_FIRE', data: { startMs: Date.now(), reason: 'soldout-cleared' } }, '*');
        }, 150);
      } else {
        if (lgSo) { lgSo.innerHTML += '> STOCK CLEARED — add captcha + select product to fire!<br>'; lgSo.scrollTop = lgSo.scrollHeight; }
        if (autoElSo) autoElSo.textContent = '⚡ Waiting: add captcha + select product';
      }
    }

    // Burst fire success
    if (d.type === 'BURST_FIRE_SUCCESS' && d.data) {
      var autoEl = document.getElementById('_auto');
      if (autoEl) autoEl.style.color = '#059669';
      if (autoEl) autoEl.textContent = 'SUCCESS: bizId=' + (d.data.bizId || '?').slice(-8);
    }

    // Burst fire depleted
    if (d.type === 'BURST_FIRE_DEPLETED') {
      var autoElD = document.getElementById('_auto');
      if (autoElD) autoElD.style.color = '#dc2626';
      if (autoElD) autoElD.textContent = 'Depleted (' + (d.data && d.data.total || 0) + ' shots)';
    }

    // Hub status
    if (d.type === 'HUB_STATUS') {
      var hubData = d.data;
      var hubTag = document.getElementById('_hubTag');
      var hubBody = document.getElementById('_hubBody');
      var hubAcctCount = document.getElementById('_hubAcctCount');
      var hubAuthedCount = document.getElementById('_hubAuthedCount');
      var hubAcctList = document.getElementById('_hubAcctList');
      var hfb = document.getElementById('_hfb');

      if (hubTag) hubTag.textContent = hubData.enabled ? 'ON' : 'OFF';
      if (hubTag) hubTag.className = 'tg ' + (hubData.enabled ? 'tg-g' : 'tg-b');
      if (hubBody) hubBody.style.display = hubData.enabled ? 'block' : 'none';

      var accts = hubData.accounts || [];
      var authed = accts.filter(function(a) { return a.authed; });
      if (hubAcctCount) hubAcctCount.textContent = accts.length;
      if (hubAuthedCount) hubAuthedCount.textContent = authed.length;

      if (hubAcctList) {
        var html = '';
        for (var hi = 0; hi < accts.length; hi++) {
          var a = accts[hi];
          html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;border-bottom:1px solid rgba(148,163,184,0.12);font-size:7px">' +
            '<span style="font-weight:600;color:#334155">' + a.username.replace(/[<>&"']/g,function(c){return '&#'+c.charCodeAt(0)+';'}) + '</span>' +
            '<span style="color:' + (a.authed ? '#10b981' : '#94a3b8') + ';font-weight:700">' + (a.authed ? 'AUTHED' : 'NO AUTH') + '</span>' +
            '</div>';
        }
        hubAcctList.innerHTML = html;
      }

      if (hfb) {
        hfb.disabled = !hubData.enabled || authed.length === 0;
        hfb.textContent = '👥 HUB FIRE (' + authed.length + ')';
      }
    }

    // Prefire gate status (auth/ticket hard-stop reasons)
    if (d.type === 'PREFIRE_STATUS') {
      renderPrefireAuthStatus(d.data);
      var lg2 = document.getElementById('_log');
      if (lg2) {
        if (d.data && d.data.ok) {
          lg2.innerHTML += '> Prefire OK (' + (d.data.source || 'unknown') + ')<br>';
        } else {
          var why = d.data && d.data.reason ? d.data.reason : 'unknown';
          lg2.innerHTML += '> Prefire blocked: ' + why + '<br>';
        }
        lg2.scrollTop = lg2.scrollHeight;
      }
    }

    // Payment state
    if (d.type === 'PAYMENT_STATE') {
      var ps = document.getElementById('_pays');
      var pt = document.getElementById('_payt');
      var payDiv = document.getElementById('_pay');
      var s = d.data.status;
      if (ps) {
        if (s === 'pending') { ps.textContent = 'SCANNING'; ps.className = 'ps s-b'; }
        else if (s === 'success') { ps.textContent = 'PAID'; ps.className = 'ps s-g'; }
        else if (s === 'error') { ps.textContent = 'ERROR'; ps.className = 'ps'; ps.style.cssText = 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca'; }
        else { ps.textContent = 'WAITING'; ps.className = 'ps sg'; }
      }
      if (pt) {
        if (s === 'pending' && d.data.qrCode) {
          pt.innerHTML = '<img class="pw-q" src="' + d.data.qrCode + '"/>' +
            '<div class="pw-am">' + (d.data.amount ? '¥' + d.data.amount : '') + '</div>';
        } else if (s === 'success') {
          pt.innerHTML = '<div class="pw-am" style="color:#059669">&#10003; Paid</div>';
        } else if (s === 'error') {
          pt.innerHTML = '<div class="pw-am" style="color:#dc2626">' + (d.data.errorMsg || 'Error') + '</div>';
        } else {
          pt.innerHTML = 'Waiting for order data...';
        }
      }
    }
  });

  // Buttons
  document.getElementById('_ab').addEventListener('click', function() { toggleBatchMode(); });
  document.getElementById('_fb').addEventListener('click', function() {
    window.postMessage({ __miaosha_cmd: true, type: 'PREFIRE_FIRE', data: { startMs: Date.now(), reason: 'manual' } }, '*');
    var lg = document.getElementById('_log'); if (lg) lg.innerHTML += '> Manual prefire + fire…<br>';
  });
  var hfbBtn = document.getElementById('_hfb');
  if (hfbBtn) hfbBtn.addEventListener('click', function() {
    window.postMessage({ __miaosha_cmd: true, type: 'HUB_FIRE', data: { startMs: Date.now() } }, '*');
    var lg = document.getElementById('_log'); if (lg) lg.innerHTML += '> Hub fire triggered…<br>';
  });

  // Minimize
  document.getElementById('_mn').addEventListener('click', function() {
    var bd = document.getElementById('_bd');
    if (bd) { var h = bd.style.display === 'none'; bd.style.display = h ? 'block' : 'none'; this.innerHTML = h ? '&#8722;' : '+'; }
  });

  // Drag
  (function() {
    var hd = overlay.querySelector('.h');
    var ox, oy, left, top, dragging = false;
    hd.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; ox = e.clientX; oy = e.clientY;
      var r = overlay.getBoundingClientRect(); left = r.left; top = r.top;
      overlay.style.transition = 'none'; overlay.style.right = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      overlay.style.left = (left + e.clientX - ox) + 'px';
      overlay.style.top = (top + e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (dragging) { dragging = false; overlay.style.transition = ''; }
    });
  })();

  var wasAuthReady = false;

  // ── Real state checking ──
  function checkRealState() {
    // Cookie check
    var hasCookie = document.cookie.indexOf('bigmodel_token_production') !== -1;
    var ckEl = document.getElementById('_ck');
    if (ckEl) { ckEl.className = 'pd ' + (hasCookie ? 'ok' : 'w'); }

    // User Info check — requires auth token cookie AND org context (both needed for API auth)
    var hasUser = false;
    try {
      hasUser = hasCookie &&
        !!localStorage.getItem('Bigmodel-Organization') &&
        !!localStorage.getItem('Bigmodel-Project');
    } catch(e) {}
    var uiEl = document.getElementById('_ui');
    if (uiEl) { uiEl.className = 'pd ' + (hasUser ? 'ok' : 'w'); }

    // Auth transition (logged out -> logged in): trigger immediate product sync.
    var authReady = hasCookie && hasUser;
    if (authReady && !wasAuthReady) {
      cmdToOverlay('REFRESH_BATCH_PREVIEW');
    }
    wasAuthReady = authReady;

    // Auth banner — show when no cookie or API auth failure detected
    var authBannerEl = document.getElementById('_authBanner');
    if (authBannerEl) { authBannerEl.style.display = (!hasCookie || _authFailed) ? 'block' : 'none'; }

    // Product ID check — ready only after product matrix is loaded.
    var hasProductIds = getAllProducts().length > 0;
    var piEl = document.getElementById('_pi');
    if (piEl) { piEl.className = 'pd ' + (hasProductIds ? 'ok' : 'w'); }
  }

  // Check state immediately and every 3 seconds
  checkRealState();
  setInterval(checkRealState, 3000);

  // Initial state poll
  setTimeout(poll, 200);
  // Poll hub status every 5 seconds
  function pollHub() { cmdToOverlay('GET_HUB_STATUS'); }
  setInterval(pollHub, 5000);
  setTimeout(pollHub, 600);
  // Request sale time from isolated world (schedules auto-fire after response)
  setTimeout(function() { cmdToOverlay('GET_SALE_TIME'); }, 800);
  // Request latest runtime calibration snapshot (latency + clock offset)
  setTimeout(function() { cmdToOverlay('GET_RUNTIME_CALIBRATION'); }, 900);

  // Setup product selector UI
  setTimeout(setupProductUI, 300);
}

setTimeout(injectOverlay, 1500);

// ── Message Listener ──
window.addEventListener('message', function(ev) {
  if (ev.source !== window) return;
  if (ev.data?.__miaosha_cmd) {
    if (ev.data.type === 'PRODUCE_CAPTCHA') produceCaptcha();
  }
});
