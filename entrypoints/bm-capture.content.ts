// ISOLATED world content script for bigmodel.cn
// Injects MAIN world XHR interceptor and relays payment/ticket data to WXT storage
// Also implements R3: Tab Audio+Visual reminder when user is on bigmodel.cn
import { storage } from '#imports';
import { buildAutoFirePlan } from '../lib/api/fire-plan';
import { calibrate } from '../lib/api/runtime-calibration';
import { SALE_ALARM_MINUTES, getNextSaleTime, saleTimeStore, type SaleTimeConfig } from '../lib/settings/sale-time';
import { captchaStore } from '../lib/settings/captcha';
import { replenishStore } from '../lib/settings/replenish';
import { FireConductor, type FireShot } from '../lib/api/fire-conductor';

const TICKET_KEY = 'local:ticketPool';
const AUTH_KEY = 'local:authHeaders';
const BATCH_PREVIEW_KEY = 'local:batchPreview';
const RUNTIME_CALIBRATION_KEY = 'local:runtimeCalibration';
const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CALIBRATION_FAST_WINDOW_MS = 10 * 60 * 1000;
const CALIBRATION_NORMAL_WINDOW_MS = 60 * 60 * 1000;
const CALIBRATION_FAST_INTERVAL_MS = 60 * 1000;
const CALIBRATION_NORMAL_INTERVAL_MS = 3 * 60 * 1000;
const CALIBRATION_IDLE_INTERVAL_MS = 10 * 60 * 1000;
const EARLY_FIRE_BOUNDARY_MS = 5 * 60 * 1000;
const REMINDER_PHASE_MINUTES_ASC = [...SALE_ALARM_MINUTES].sort((a, b) => a - b);

interface RuntimeCalibrationSnapshot {
  latencyMs: number;
  clockOffsetMs: number;
  sampleCount: number;
  calibratedAt: number;
  reason: string;
}

// ── R3: Flash Sale Reminder ──────────────────────────────────────────────────

interface ReminderState {
  reminded: Record<string, boolean>;
  saleEpoch?: number;
}

async function getSaleConfig(): Promise<SaleTimeConfig> {
  return await saleTimeStore.get();
}

function getSalePhase(config: SaleTimeConfig): number | null {
  const now = Date.now();
  const sale = getNextSaleTime(config);
  const remaining = sale - now;
  // T-5 is still a reminder phase (it fires when probing stops).
  // Stop showing reminders only once the sale epoch itself has passed.
  if (remaining <= 0) return null;
  for (const minutesBefore of REMINDER_PHASE_MINUTES_ASC) {
    if (remaining <= minutesBefore * 60 * 1000) return minutesBefore;
  }
  return null;
}

function createOverlay(min: number) {
  const existing = document.getElementById('miaosha-flash-overlay');
  if (existing) existing.remove();

  const reminderText = min <= 5
    ? `🔥 距智谱秒杀还有 ${min} 分钟！请立刻录入验证码，越多越好`
    : `🔥 距智谱秒杀还有 ${min} 分钟`;
  const actionText = min <= 5 ? '去录入验证码' : '立即准备';

  const overlay = document.createElement('div');
  overlay.id = 'miaosha-flash-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: linear-gradient(135deg, #dc2626, #ef4444);
      color: #fff; padding: 12px 20px; font-size: 15px;
      font-weight: 800; text-align: center;
      display: flex; align-items: center; justify-content: center; gap: 12px;
      box-shadow: 0 4px 20px rgba(220,38,38,0.4);
      animation: miaoshaPulse 1s ease-in-out infinite alternate;
      cursor: pointer; font-family: system-ui, -apple-system, sans-serif;
    ">
      <span>${reminderText}</span>
      <button id="miaosha-open-btn" style="
        background: #fff; color: #dc2626; border: none;
        padding: 5px 14px; border-radius: 20px; font-weight: 700;
        cursor: pointer; font-size: 13px;
      ">${actionText}</button>
    </div>
    <style>
      @keyframes miaoshaPulse {
        from { opacity: 0.85; transform: scale(1); }
        to { opacity: 1; transform: scale(1.01); }
      }
    </style>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'miaosha-open-btn') return;
    overlay.remove();
  });
  document.getElementById('miaosha-open-btn')?.addEventListener('click', () => {
    overlay.remove();
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
  });
}

function playBeep() {
  try {
    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      // Chrome autoplay policy: cannot resume without user gesture. Silently skip.
      audioCtx.close();
      return;
    }
    const buf = audioCtx.createBuffer(1, 44100, 44100);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin(2 * Math.PI * 880 * i / 44100) * 0.25;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start();
    setTimeout(() => { src.stop(); audioCtx.close(); }, 200);
  } catch {}
}

/** Play `count` alarm beeps with 350 ms gaps. Used for soldOut-cleared alert. */
async function playAlarmBeeps(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    playBeep();
    if (i < count - 1) await new Promise<void>((r) => setTimeout(r, 350));
  }
}

function createReminderState(saleEpoch: number): ReminderState {
  return {
    reminded: Object.fromEntries(SALE_ALARM_MINUTES.map((minutesBefore) => [String(minutesBefore), false])),
    saleEpoch,
  };
}

async function loadReminderState(saleEpoch: number): Promise<ReminderState> {
  const defaultState = createReminderState(saleEpoch);
  const stored = await storage.getItem<ReminderState>('local:reminderState');
  if (!stored || stored.saleEpoch !== saleEpoch) return defaultState;
  return {
    ...defaultState,
    ...stored,
    reminded: {
      ...defaultState.reminded,
      ...(stored.reminded ?? {}),
    },
  };
}

async function saveReminderState(state: ReminderState) {
  await storage.setItem('local:reminderState', state);
}

async function checkAndRemind() {
  const config = await getSaleConfig();
  const saleEpoch = getNextSaleTime(config);
  const phase = getSalePhase(config);
  if (!phase) return;

  const state = await loadReminderState(saleEpoch);
  const key = String(phase);
  if (state.reminded[key]) return;

  createOverlay(phase);
  playBeep();

  state.reminded[key] = true;
  await saveReminderState(state);
}

async function initReminderLoop() {
  // Check every 60 seconds
  setInterval(checkAndRemind, 60_000);
  await checkAndRemind();
}
// ── End R3 ─────────────────────────────────────────────────────────────────

// ── Force-Stop Banner (shown during batch captcha mode) ────────────────────

function createForceStopBanner() {
  removeForceStopBanner();
  const el = document.createElement('div');
  el.id = 'miaosha-force-stop-banner';
  el.innerHTML = `
    <div style="
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: linear-gradient(135deg, #dc2626, #ef4444);
      color: #fff; padding: 10px 20px; font-size: 14px;
      font-weight: 800; text-align: center;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      box-shadow: 0 4px 20px rgba(220,38,38,0.4);
      animation: miaoshaPulse 1s ease-in-out infinite alternate;
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <span>&#9632; Batch Mode Active — solving captchas</span>
      <kbd style="
        padding: 2px 8px; background: rgba(255,255,255,0.25);
        border: 1px solid rgba(255,255,255,0.5); border-radius: 4px;
        font-size: 12px; font-weight: 700; font-family: monospace;
      ">Esc</kbd>
      <span>to force stop</span>
    </div>
    <style>
      @keyframes miaoshaPulse {
        from { opacity: 0.85; transform: scale(1); }
        to { opacity: 1; transform: scale(1.01); }
      }
    </style>
  `;
  document.body.appendChild(el);
}

function removeForceStopBanner() {
  document.getElementById('miaosha-force-stop-banner')?.remove();
}

function isExpired(t: any): boolean {
  return Date.now() - t.createdAt > TICKET_TTL_MS;
}

function postToOverlay(msg: any) {
  window.postMessage({ __miaosha_overlay: true, ...msg }, '*');
}

function isAuthValid(auth: any): boolean {
  return !!(auth?.authorization && auth?.bigmodelOrganization && auth?.bigmodelProject);
}

function tokenSuffix(authz: string | undefined): string {
  if (!authz || typeof authz !== 'string') return '';
  const raw = authz.replace(/^Bearer\s+/i, '');
  return raw.slice(-6);
}

export default defineContentScript({
  matches: ['*://*.bigmodel.cn/*'],
  runAt: 'document_idle',

  async main() {
    // Inject MAIN world script
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('/bm-main.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    // ── Sandbox iframe for TrOCR model ──
    let sandboxIframe: HTMLIFrameElement | null = null;
    const sandboxPending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    function initSandboxIframe() {
      sandboxIframe = document.createElement('iframe');
      sandboxIframe.src = chrome.runtime.getURL('ocr-sandbox.html');
      sandboxIframe.style.display = 'none';
      sandboxIframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
      sandboxIframe.onload = () => {
        const wasmUrl = chrome.runtime.getURL('wasm/');
        sandboxIframe!.contentWindow?.postMessage(
          { target: 'ocr-sandbox', type: 'init', wasmPaths: wasmUrl },
          '*'
        );
      };
      document.body.appendChild(sandboxIframe);
    }
    initSandboxIframe();
    // ── End sandbox iframe ──





    // ── Safe storage wrapper ──
    async function safeGet<T>(key: string): Promise<T | null> {
      try { return await storage.getItem<T>(key); } catch { return null; }
    }
    async function safeSet(key: string, value: any): Promise<void> {
      try { await storage.setItem(key, value); } catch {}
    }

    async function captureAuthFromPage() {
      try {
        const cookies = document.cookie.split(';').reduce((acc, c) => {
          const [k, ...vParts] = c.trim().split('=');
          acc[k] = vParts.join('=');
          return acc;
        }, {} as Record<string, string>);
        const jwt = cookies.bigmodel_token_production;
        const org = localStorage.getItem('Bigmodel-Organization');
        const proj = localStorage.getItem('Bigmodel-Project');
        if (!jwt || !org || !proj) return null;
        const now = Date.now();
        const auth = {
          authorization: jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}`,
          bigmodelOrganization: org,
          bigmodelProject: proj,
          capturedAt: now,
          source: 'live-page',
        };
        await safeSet(AUTH_KEY, auth);
        return auth;
      } catch {
        return null;
      }
    }

    async function getFreshAuthHeaders() {
      const captured = await captureAuthFromPage();
      if (isAuthValid(captured)) return captured;
      const cached = await safeGet<any>(AUTH_KEY);
      if (isAuthValid(cached)) return cached;
      return null;
    }

    async function getPrefireAuthStatus() {
      const auth = await getFreshAuthHeaders();
      if (!isAuthValid(auth)) {
        return {
          ok: false,
          reason: 'missing-auth',
        };
      }

      const capturedAt = typeof auth.capturedAt === 'number' ? auth.capturedAt : Date.now();
      return {
        ok: true,
        headers: auth,
        source: auth.source === 'live-page' ? 'live-page' : 'storage-fallback',
        capturedAt,
        ageMs: Math.max(0, Date.now() - capturedAt),
        org: auth.bigmodelOrganization,
        project: auth.bigmodelProject,
        tokenSuffix: tokenSuffix(auth.authorization),
      };
    }

    async function fetchBatchPreviewWithAuth() {
      const authHeaders = await getFreshAuthHeaders();
      if (!authHeaders?.authorization || !authHeaders?.bigmodelOrganization || !authHeaders?.bigmodelProject) {
        return null;
      }

      try {
        const res = await fetch('https://bigmodel.cn/api/biz/pay/batch-preview', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            authorization: authHeaders.authorization,
            'bigmodel-organization': authHeaders.bigmodelOrganization,
            'bigmodel-project': authHeaders.bigmodelProject,
          },
          body: JSON.stringify({ invitationCode: '' }),
        });

        const data = await res.json();
        if (data?.code === 200 && data?.data?.productList) {
          await safeSet(BATCH_PREVIEW_KEY, data);
          return data.data.productList as any[];
        }
        return null;
      } catch {
        return null;
      }
    }

    let calibrationInFlight = false;
    let calibrationTimer: ReturnType<typeof setTimeout> | null = null;

    function selectCalibrationInterval(msUntilSale: number): number {
      if (msUntilSale <= CALIBRATION_FAST_WINDOW_MS) return CALIBRATION_FAST_INTERVAL_MS;
      if (msUntilSale <= CALIBRATION_NORMAL_WINDOW_MS) return CALIBRATION_NORMAL_INTERVAL_MS;
      return CALIBRATION_IDLE_INTERVAL_MS;
    }

    async function pushRuntimeCalibrationToOverlay() {
      const cached = await safeGet<RuntimeCalibrationSnapshot>(RUNTIME_CALIBRATION_KEY);
      if (!cached) return false;
      if (!Number.isFinite(cached.latencyMs) || !Number.isFinite(cached.clockOffsetMs)) return false;
      postToOverlay({ type: 'RUNTIME_CALIBRATION', data: cached });
      return true;
    }

    async function runRuntimeCalibration(reason: string) {
      if (calibrationInFlight) return false;
      calibrationInFlight = true;
      try {
        const authHeaders = await getFreshAuthHeaders();
        if (!isAuthValid(authHeaders)) return false;

        const result = await calibrate({
          authorization: authHeaders.authorization,
          bigmodelOrganization: authHeaders.bigmodelOrganization,
          bigmodelProject: authHeaders.bigmodelProject,
        });

        if (!Number.isFinite(result.latencyMs) || !Number.isFinite(result.clockOffsetMs) || result.probes.length === 0) {
          return false;
        }

        const snapshot: RuntimeCalibrationSnapshot = {
          latencyMs: Math.max(0, Math.round(result.latencyMs)),
          clockOffsetMs: Math.round(result.clockOffsetMs),
          sampleCount: result.probes.length,
          calibratedAt: Date.now(),
          reason,
        };

        await safeSet(RUNTIME_CALIBRATION_KEY, snapshot);
        postToOverlay({ type: 'RUNTIME_CALIBRATION', data: snapshot });
        return true;
      } catch {
        return false;
      } finally {
        calibrationInFlight = false;
      }
    }

    async function scheduleNextRuntimeCalibration() {
      if (calibrationTimer) {
        clearTimeout(calibrationTimer);
        calibrationTimer = null;
      }

      try {
        const cfg = await getSaleConfig();
        const msUntilSale = Math.max(0, getNextSaleTime(cfg) - Date.now());
        const nextDelay = selectCalibrationInterval(msUntilSale);
        calibrationTimer = setTimeout(async () => {
          await runRuntimeCalibration('periodic');
          await scheduleNextRuntimeCalibration();
        }, nextDelay);
      } catch {
        calibrationTimer = setTimeout(async () => {
          await runRuntimeCalibration('periodic-fallback');
          await scheduleNextRuntimeCalibration();
        }, CALIBRATION_NORMAL_INTERVAL_MS);
      }
    }

    async function startRuntimeCalibrationLoop() {
      await pushRuntimeCalibrationToOverlay();
      await runRuntimeCalibration('init');
      await scheduleNextRuntimeCalibration();
    }

    // ── SoldOut Watcher: probes batch-preview starting at T-60m ──────────────
    // Detects the moment any product transitions soldOut: true → false and fires
    // a 10-beep alarm + SOLDOUT_CLEARED overlay event + optional immediate auto-fire.

    let soldOutWatcherTimer: ReturnType<typeof setTimeout> | null = null;
    let soldOutWatcherArmed = false;
    let lastSoldOutMap: Record<string, boolean> | null = null;
    let soldOutAlarmFired = false;

    function getSoldOutProbeInterval(msUntilSale: number): number {
      if (msUntilSale <= 15 * 60 * 1000) return 1000;  // T-15m → T-5m: every 1 s
      if (msUntilSale <= 30 * 60 * 1000) return 2000;  // T-30m → T-15m: every 2 s
      return 5000;                                      // T-60m → T-30m: every 5 s
    }

    /** Fetch batch-preview, update overlay/storage, return list of newly-cleared product IDs. */
    async function runSoldOutProbe(): Promise<string[]> {
      const authHeaders = await getFreshAuthHeaders();
      if (!isAuthValid(authHeaders)) return [];
      try {
        const res = await fetch('https://bigmodel.cn/api/biz/pay/batch-preview', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            authorization: authHeaders.authorization,
            'bigmodel-organization': authHeaders.bigmodelOrganization,
            'bigmodel-project': authHeaders.bigmodelProject,
          },
          body: JSON.stringify({ invitationCode: '' }),
        });
        const data = await res.json();
        if (data?.code !== 200 || !Array.isArray(data?.data?.productList)) return [];

        const productList: any[] = data.data.productList;
        // Keep storage + overlay up to date
        await safeSet(BATCH_PREVIEW_KEY, data);
        postToOverlay({ type: 'BATCH_PREVIEW_DATA', data: productList });

        // Build current soldOut map
        const currentMap: Record<string, boolean> = {};
        for (const p of productList) {
          currentMap[p.productId] = !!(p.soldOut || p.forbidden || p.canPurchase === false);
        }

        // Detect true → false transitions
        const cleared: string[] = [];
        if (lastSoldOutMap !== null) {
          for (const id of Object.keys(currentMap)) {
            if (lastSoldOutMap[id] === true && currentMap[id] === false) {
              cleared.push(id);
            }
          }
        }
        lastSoldOutMap = currentMap;
        return cleared;
      } catch {
        return [];
      }
    }

    async function soldOutWatcherTick() {
      if (!soldOutWatcherArmed || soldOutAlarmFired) return;

      const cfg = await getSaleConfig();
      const saleEpoch = getNextSaleTime(cfg);
      const msUntilSale = saleEpoch - Date.now();

      // T-5 is the hard boundary: stop all soldOut probing and earliest-fire checks.
      if (msUntilSale <= EARLY_FIRE_BOUNDARY_MS) {
        stopSoldOutWatcher();
        return;
      }

      const cleared = await runSoldOutProbe();

      if (cleared.length > 0) {
        soldOutAlarmFired = true;
        soldOutWatcherArmed = false;
        // Play 10 alarm beeps (async, don't await — don't block fire path)
        void playAlarmBeeps(10);
        // Notify overlay: it will update selections + dispatch PREFIRE_FIRE if tickets ready
        postToOverlay({ type: 'SOLDOUT_CLEARED', data: { clearedIds: cleared, detectedAt: Date.now() } });
        return;
      }

      // Schedule next probe
      if (soldOutWatcherArmed) {
        if (soldOutWatcherTimer) clearTimeout(soldOutWatcherTimer);
        soldOutWatcherTimer = setTimeout(soldOutWatcherTick, getSoldOutProbeInterval(Math.max(0, msUntilSale)));
      }
    }

    function stopSoldOutWatcher() {
      if (soldOutWatcherTimer) { clearTimeout(soldOutWatcherTimer); soldOutWatcherTimer = null; }
      soldOutWatcherArmed = false;
    }

    async function startSoldOutWatcher() {
      stopSoldOutWatcher();
      lastSoldOutMap = null;
      soldOutAlarmFired = false;

      const cfg = await getSaleConfig();
      const saleEpoch = getNextSaleTime(cfg);
      const msUntilSale = saleEpoch - Date.now();
      const WATCH_WINDOW_MS = 60 * 60 * 1000; // activate at T-60m

      if (msUntilSale > WATCH_WINDOW_MS) {
        // Schedule activation at T-60
        soldOutWatcherTimer = setTimeout(async () => {
          soldOutWatcherArmed = true;
          await soldOutWatcherTick();
        }, msUntilSale - WATCH_WINDOW_MS);
      } else if (msUntilSale > EARLY_FIRE_BOUNDARY_MS) {
        // Already inside the T-60 ~ T-5 early-fire window.
        soldOutWatcherArmed = true;
        await soldOutWatcherTick();
      }
      // else: already inside/past the T-5 cutoff — skip
    }
    // ── End SoldOut Watcher ───────────────────────────────────────────────────

    // ── Auto-Replenish bridge: push config to MAIN world ──

    async function pushReplenishConfigToMain() {
      try {
        const replCfg = await replenishStore.get();
        postToOverlay({ type: 'REPLENISH_CONFIG', data: { enabled: replCfg.enabled, targetCount: replCfg.targetCount } });
      } catch {}
    }

    // ── Batch Preview bridge: storage → MAIN world ──
    async function pushBatchPreviewToOverlay() {
      const cached = await safeGet<any>(BATCH_PREVIEW_KEY);
      if (cached?.data?.productList) {
        postToOverlay({ type: 'BATCH_PREVIEW_DATA', data: cached.data.productList });
        return true;
      }
      return false;
    }

    async function refreshBatchPreviewToOverlay() {
      const fresh = await fetchBatchPreviewWithAuth();
      if (fresh && fresh.length > 0) {
        postToOverlay({ type: 'BATCH_PREVIEW_DATA', data: fresh });
        return true;
      }
      return false;
    }
    // Push on init (after MAIN world script loads)
    pushBatchPreviewToOverlay().then((hasCached) => {
      if (!hasCached) {
        refreshBatchPreviewToOverlay();
      }
    });
    // Push on storage change (background alarm wrote new data)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[BATCH_PREVIEW_KEY]) {
        const newList = changes[BATCH_PREVIEW_KEY].newValue?.data?.productList;
        if (newList) postToOverlay({ type: 'BATCH_PREVIEW_DATA', data: newList });
      }
      if (area === 'local' && (changes.saleTimeConfig || changes['local:saleTimeConfig'])) {
        void scheduleNextRuntimeCalibration();
        void startSoldOutWatcher(); // reset watcher when sale time changes
      }
      // Push captcha config to MAIN world when changed in options
      if (area === 'local' && changes['local:captchaConfig']) {
        const cfg = changes['local:captchaConfig'].newValue;
        if (cfg?.batchSessionLimit) {
          postToOverlay({ type: 'CAPTCHA_CONFIG', data: { batchSessionLimit: cfg.batchSessionLimit } });
        }
      }
      // Push replenish config to MAIN world when changed
      if (area === 'local' && changes['local:replenishConfig']) {
        void pushReplenishConfigToMain();
      }
    });

    // ── Helper: get valid ticket count + oldest TTL ──
    async function getTicketInfo() {
      const pool: any[] = (await safeGet<any[]>(TICKET_KEY)) ?? [];
      const valid = pool.filter((t) => !isExpired(t));
      if (valid.length !== pool.length) {
        await safeSet(TICKET_KEY, valid);
      }
      const oldestTtl = valid.length > 0 ? Math.max(0, TICKET_TTL_MS - (Date.now() - valid[0].createdAt)) : 0;
      return { count: valid.length, ttl: oldestTtl };
    }

    async function getLaunchSnapshot() {
      const pool: any[] = (await safeGet<any[]>(TICKET_KEY)) ?? [];
      const valid = pool.filter((t) => !isExpired(t));
      const selData = await safeGet<any>('local:selectedProducts');
      const selectedIds: string[] = selData?.selected
        ? Object.keys(selData.selected).filter((k) => selData.selected[k])
        : [];
      return { valid, selectedIds };
    }

    function consumeReservedTickets(pool: any[], reservedTickets: Array<{ ticket: string; createdAt: number }>) {
      if (reservedTickets.length === 0) return pool;
      const reservedKeys = new Set(reservedTickets.map((ticket) => ticket.ticket + ':' + ticket.createdAt));
      return pool.filter((ticket) => !reservedKeys.has(ticket.ticket + ':' + ticket.createdAt));
    }

    async function runAutoFirePlan(startMs: number, authHeaders: any) {
      const { valid, selectedIds } = await getLaunchSnapshot();
      if (valid.length === 0) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> No valid tickets' });
        return;
      }
      if (selectedIds.length === 0) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> No products selected' });
        return;
      }

      const plan = buildAutoFirePlan({ tickets: valid, selectedIds, startMs });
      const allShots = [...plan.initialShots, ...plan.followUpShots];
      if (allShots.length === 0) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> Auto-fire plan empty' });
        return;
      }

      const remainingPool = consumeReservedTickets(valid, plan.reservedTickets);
      await safeSet(TICKET_KEY, remainingPool);
      const remainingInfo = await getTicketInfo();
      postToOverlay({ type: 'TICKET_COUNT', count: remainingInfo.count, ttl: remainingInfo.ttl });
      try { chrome.runtime.sendMessage({ type: 'TICKET_POOL_UPDATED', count: remainingInfo.count }); } catch {}

      if (valid.length < selectedIds.length) {
        postToOverlay({
          type: 'FIRE_RESULT',
          line: '> Auto initial partial: ' + valid.length + ' tickets for ' + selectedIds.length + ' selected products',
        });
      }

      const totalShots = allShots.length;
      const initialCount = plan.initialShots.length;
      postToOverlay({
        type: 'FIRE_RESULT',
        line: '> Auto plan: ' + initialCount + ' initial concurrent + ' + plan.followUpShots.length + ' adaptive follow-up shots',
      });

      postToOverlay({
        type: 'FIRE_BATCH_START',
        data: {
          queue: allShots.map((shot, idx) => ({ shotIdx: idx, productId: shot.productId, wave: shot.wave, scheduledAt: shot.scheduledAt })),
          totalShots,
          startMs,
          initialCount,
          followUpCount: plan.followUpShots.length,
        },
      });

      const shots: FireShot[] = allShots.map((s) => ({
        ticket: s.ticket,
        randstr: s.randstr,
        productId: s.productId,
        wave: s.wave,
        scheduledAt: s.scheduledAt,
      }));

      const conductor = new FireConductor(
        shots,
        async (shot, shotIdx) => {
          const t1 = Date.now();
          const tag = '>[#' + (shotIdx + 1) + '/' + totalShots + '][' + (shot.wave || 'burst') + '] ' + shot.productId.slice(-6);
          try {
            const res = await fetch('https://bigmodel.cn/api/biz/pay/preview', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'content-type': 'application/json;charset=UTF-8',
                'authorization': authHeaders.authorization,
                'bigmodel-organization': authHeaders.bigmodelOrganization,
                'bigmodel-project': authHeaders.bigmodelProject,
              },
              body: JSON.stringify({ productId: shot.productId, ticket: shot.ticket, randstr: shot.randstr }),
            });
            const body = await res.json();
            const rtt = Date.now() - t1;

            if (body.code === 200 && body.data && !body.data.soldOut && body.data.bizId) {
              postToOverlay({ type: 'FIRE_RESULT', line: tag + ': ORDER bizId=' + body.data.bizId + ' (' + rtt + 'ms)' });
              return { shotIdx, productId: shot.productId, outcome: 'success' as const, code: 200, rtt, bizId: body.data.bizId, wave: shot.wave };
            } else if (body.code === 200 && body.data?.soldOut) {
              postToOverlay({ type: 'FIRE_RESULT', line: tag + ': sold-out today (' + rtt + 'ms)' });
              return { shotIdx, productId: shot.productId, outcome: 'soldout' as const, code: 200, rtt, wave: shot.wave };
            } else if (body.code === 555) {
              postToOverlay({ type: 'FIRE_RESULT', line: tag + ': server-busy-555 (' + rtt + 'ms)' });
              return { shotIdx, productId: shot.productId, outcome: 'busy' as const, code: 555, rtt, wave: shot.wave };
            } else {
              postToOverlay({ type: 'FIRE_RESULT', line: tag + ': code=' + body.code + ' ' + (body.msg || '') + ' (' + rtt + 'ms)' });
              return { shotIdx, productId: shot.productId, outcome: 'error' as const, code: body.code, rtt, wave: shot.wave };
            }
          } catch (e: any) {
            postToOverlay({ type: 'FIRE_RESULT', line: tag + ': net-err: ' + (e?.message || 'unknown') });
            return { shotIdx, productId: shot.productId, outcome: 'neterr' as const, rtt: Math.round(Date.now() - t1), wave: shot.wave };
          }
        },
        {
          maxConcurrent: Math.min(Math.max(initialCount, 3), 4),
          maxRetries: 6,
          retryBackoffMs: 200,
          retryBackoffFactor: 2,
          onShot: (result) => {
            postToOverlay({ type: 'FIRE_SHOT_RESULT', data: result });
          },
          onSuccess: async (result) => {
            const ps = {
              bizId: result.bizId as string,
              amount: 0,
              productId: result.productId,
              status: 'pending' as const,
              updatedAt: Date.now(),
            };
            await safeSet('local:paymentState', ps);
            postToOverlay({ type: 'BURST_FIRE_SUCCESS', data: ps });
          },
          onDepleted: () => {
            postToOverlay({ type: 'FIRE_RESULT', line: '> Auto plan complete — ammo depleted (' + totalShots + ' shots)' });
            postToOverlay({ type: 'BURST_FIRE_DEPLETED', data: { total: totalShots } });
          },
        },
      );

      conductor.start();
    }

    // ── Serial Fire: 1850ms interval, round-robin product assignment ──
    // Single account 2s rate limit → serial 1850ms spacing
    // 1 product selected → a-a-a-a (all tickets at same product)
    // 2+ products selected → a-b-a-b (round-robin alternating)
    async function burstFire(startMs: number, authOverride?: any) {
      const { valid, selectedIds } = await getLaunchSnapshot();
      if (valid.length === 0) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> No valid tickets' });
        return;
      }

      const authHeaders = isAuthValid(authOverride) ? authOverride : await getFreshAuthHeaders();
      if (!isAuthValid(authHeaders)) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> No auth headers' });
        return;
      }
      if (selectedIds.length === 0) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> No products selected' });
        return;
      }

      const totalShots = valid.length;

      // Build serial queue: round-robin product assignment
      // 1 product → a-a-a; 2+ products → a-b-a-b
      const queue: Array<{ ticket: string; randstr: string; productId: string }> = [];
      for (let i = 0; i < totalShots; i++) {
        queue.push({
          ticket: valid[i].ticket,
          randstr: valid[i].randstr,
          productId: selectedIds[i % selectedIds.length],
        });
      }

      // Consume ALL tickets
      await safeSet(TICKET_KEY, []);
      postToOverlay({ type: 'TICKET_COUNT', count: 0, ttl: 0 });
      try { chrome.runtime.sendMessage({ type: 'TICKET_POOL_UPDATED', count: 0 }); } catch {}

      // Build display pattern
      const pattern = selectedIds.length === 1
        ? selectedIds[0].slice(-6)
        : queue.map(q => q.productId.slice(-6)).join(' → ');

      postToOverlay({
        type: 'FIRE_RESULT',
        line: '> Serial: ' + totalShots + ' shots @ 1850ms (' + pattern + ')',
      });

      postToOverlay({
        type: 'FIRE_BATCH_START',
        data: {
          queue: queue.map((item, idx) => ({ shotIdx: idx, productId: item.productId })),
          totalShots,
          startMs,
        },
      });

      const SERIAL_INTERVAL_MS = 1850;

      // Serial fire loop: one shot at a time, 1850ms apart
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        const shotIdx = i;
        const tag = '>[#' + (shotIdx + 1) + '/' + totalShots + '] ' + item.productId.slice(-6);

        if (shotIdx > 0) {
          await new Promise(r => setTimeout(r, SERIAL_INTERVAL_MS));
        }

        try {
          const t1 = Date.now();
          const res = await fetch('https://bigmodel.cn/api/biz/pay/preview', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json;charset=UTF-8',
              'authorization': authHeaders.authorization,
              'bigmodel-organization': authHeaders.bigmodelOrganization,
              'bigmodel-project': authHeaders.bigmodelProject,
            },
            body: JSON.stringify({ productId: item.productId, ticket: item.ticket, randstr: item.randstr }),
          });
          const body = await res.json();
          const rtt = Date.now() - t1;

          if (body.code === 200 && body.data && !body.data.soldOut && body.data.bizId) {
            postToOverlay({ type: 'FIRE_RESULT', line: tag + ': ORDER bizId=' + body.data.bizId + ' (' + rtt + 'ms)' });
            // Start payment polling
            const ps = {
              bizId: body.data.bizId as string,
              amount: 0,
              productId: item.productId,
              status: 'pending' as const,
              updatedAt: Date.now(),
            };
            await safeSet('local:paymentState', ps);
            postToOverlay({ type: 'BURST_FIRE_SUCCESS', data: ps });
            return;
          } else if (body.code === 200 && body.data?.soldOut) {
            postToOverlay({ type: 'FIRE_RESULT', line: tag + ': sold-out today (' + rtt + 'ms)' });
          } else if (body.code === 555) {
            postToOverlay({ type: 'FIRE_RESULT', line: tag + ': server-busy-555 (' + rtt + 'ms)' });
          } else {
            postToOverlay({ type: 'FIRE_RESULT', line: tag + ': code=' + body.code + ' ' + (body.msg || '') + ' (' + rtt + 'ms)' });
          }
        } catch (e: any) {
          postToOverlay({ type: 'FIRE_RESULT', line: tag + ': net-err: ' + (e?.message || 'unknown') });
        }
      }

      // All shots exhausted without success
      postToOverlay({ type: 'FIRE_RESULT', line: '> Serial complete — all ammo expended (' + totalShots + ' shots)' });
      postToOverlay({ type: 'BURST_FIRE_DEPLETED', data: { total: totalShots } });
    }

    async function prefireAndBurst(startMs: number, reason: string) {
      const authStatus = await getPrefireAuthStatus();
      if (!authStatus.ok) {
        postToOverlay({
          type: 'PREFIRE_STATUS',
          data: {
            ok: false,
            reason: authStatus.reason,
            fireReason: reason,
          },
        });
        postToOverlay({ type: 'FIRE_RESULT', line: '> Prefire blocked: auth unavailable' });
        return;
      }

      postToOverlay({
        type: 'PREFIRE_STATUS',
        data: {
          ok: true,
          source: authStatus.source,
          capturedAt: authStatus.capturedAt,
          ageMs: authStatus.ageMs,
          tokenSuffix: authStatus.tokenSuffix,
          org: authStatus.org,
          project: authStatus.project,
          fireReason: reason,
        },
      });

      if (reason === 'auto') {
        await runAutoFirePlan(startMs, authStatus.headers);
        return;
      }

      await burstFire(startMs, authStatus.headers);
    }

    // ── Listen for messages from MAIN world script + sandbox iframe ──
    window.addEventListener('message', async (event) => {
      // Messages from sandbox iframe
      if (event.data?.target === 'bm-capture') {
        if (event.data.type === 'result') {
          console.log('[capture] sandbox result received, msgId:', event.data.msgId, 'chars:', event.data.chars, 'error:', event.data.error);
          const p = sandboxPending.get(event.data.msgId);
          if (p) {
            sandboxPending.delete(event.data.msgId);
            if (event.data.error) p.reject(new Error(event.data.error));
            else p.resolve({ chars: event.data.chars });
          } else {
            console.warn('[capture] no pending for msgId:', event.data.msgId);
          }
        }
        return;
      }

      if (event.source !== window) return;

      // From overlay (MAIN world) — commands
      if (event.data?.__miaosha_cmd) {
        if (event.data.type === 'GET_TICKET_COUNT') {
          const info = await getTicketInfo();
          postToOverlay({ type: 'TICKET_COUNT', count: info.count, ttl: info.ttl });
        }
        if (event.data.type === 'FIRE_ALL') {
          // Manual fire: start immediately
          prefireAndBurst(Date.now(), 'legacy-fire-all');
        }
        if (event.data.type === 'BURST_FIRE') {
          // Auto-fire from scheduler: startMs pre-computed by bm-main.js
          const startMs: number = (event.data.data?.startMs) ?? Date.now();
          prefireAndBurst(startMs, event.data.data?.reason ?? 'burst-fire');
        }
        // Unified pre-fire gate (manual + auto)
        if (event.data.type === 'PREFIRE_FIRE') {
          const startMs: number = (event.data.data?.startMs) ?? Date.now();
          const reason: string = event.data.data?.reason ?? 'prefire-fire';
          prefireAndBurst(startMs, reason);
        }
        // Auto-fire scheduler requests sale time from bm-main.js
        if (event.data.type === 'GET_SALE_TIME') {
          const cfg = await getSaleConfig();
          const nst = getNextSaleTime(cfg);
          postToOverlay({ type: 'SALE_TIME_CONFIG', data: { config: cfg, nextSaleTime: nst } });
        }
        if (event.data.type === 'GET_RUNTIME_CALIBRATION') {
          const pushed = await pushRuntimeCalibrationToOverlay();
          if (!pushed) {
            await runRuntimeCalibration('manual-request');
          }
        }
        // MAIN world requests batch preview data from storage
        if (event.data.type === 'REQUEST_BATCH_PREVIEW') {
          const pushed = await pushBatchPreviewToOverlay();
          if (!pushed) {
            await refreshBatchPreviewToOverlay();
          }
        }
        // Force refresh (used by regression gate and manual recovery)
        if (event.data.type === 'REFRESH_BATCH_PREVIEW') {
          await refreshBatchPreviewToOverlay();
        }
      }

      // From XHR interceptor (MAIN world) — events
      if (!event.data?.__miaosha) return;
      const { type, payload } = event.data;

      // ── Product selection changed ──
      if (type === 'PRODUCT_SELECTION_CHANGED' && payload) {
        await safeSet('local:selectedProducts', payload);
      }

      // ── Captcha ticket produced ──
      if (type === 'CAPTCHA_PRODUCED' && payload?.ticket) {
        const pool: any[] = (await safeGet<any[]>(TICKET_KEY)) ?? [];
        if (!pool.some((t: any) => t.ticket === payload.ticket)) {
          pool.push({ ticket: payload.ticket, randstr: payload.randstr, createdAt: Date.now() });
          await safeSet(TICKET_KEY, pool);
        }
        // Update overlay
        const info = await getTicketInfo();
        postToOverlay({ type: 'TICKET_COUNT', count: info.count, ttl: info.ttl });
        // Notify popup
        try { chrome.runtime.sendMessage({ type: 'TICKET_POOL_UPDATED', count: info.count }); } catch {}
      }

      if (type === 'CAPTCHA_ERROR' && payload) {
        postToOverlay({ type: 'FIRE_RESULT', line: '> Captcha error: ' + payload.msg });
        try { chrome.runtime.sendMessage({ type: 'CAPTCHA_ERROR', msg: payload.msg }); } catch {}
      }

      // ── Batch mode status → full-width force-stop banner ──
      if (type === 'BATCH_MODE_STATUS') {
        if (payload?.active) {
          createForceStopBanner();
        } else {
          removeForceStopBanner();
        }
      }

      // ── Auto-replenish: captcha modal detected, start solving ──
      if (type === 'AUTO_REPLENISH_MODAL_OPEN' && payload) {
        const iframeRect = payload.iframeRect;
        const promptChars: string[] | null = payload.promptChars;
        if (iframeRect && promptChars && promptChars.length >= 3) {
          const dpr = window.devicePixelRatio || 1;
          console.log('[capture] SOLVE_CAPTCHA_REQUEST sending', { iframeRect, promptChars, dpr });
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'SOLVE_CAPTCHA_REQUEST',
              iframeRect,
              promptChars,
              dpr,
            });
            console.log('[capture] SOLVE_CAPTCHA_RESPONSE', response);
            if (response?.points?.length > 0) {
              window.postMessage({
                __miaosha_cmd: true,
                type: 'CAPTCHA_CLICK',
                data: { points: response.points },
              }, '*');
            } else {
              const errMsg = response?.error || 'empty points';
              console.error('[capture] solve failed:', errMsg);
              postToOverlay({ type: 'FIRE_RESULT', line: '> Auto-replenish: solve failed: ' + errMsg });
            }
          } catch (e: any) {
            console.error('[capture] solve error:', e);
            postToOverlay({ type: 'FIRE_RESULT', line: '> Auto-replenish: solve error: ' + (e?.message || 'unknown') });
            window.postMessage({ __miaosha_cmd: true, type: 'CAPTCHA_CLICK', data: { points: null } }, '*');
          }
        }
      }

      // ── Payment preview intercepted ──
      if (type === 'PAYMENT_PREVIEW' && payload) {
        const status = payload.soldOut ? 'error' : (payload.bizId ? 'pending' : 'waiting');
        const ps = { qrCode: payload.qrCode, bizId: payload.bizId, amount: payload.amount, productId: payload.productId, status, updatedAt: Date.now(), errorMsg: payload.soldOut ? 'Sold out' : undefined };
        await safeSet('local:paymentState', ps);
        postToOverlay({ type: 'PAYMENT_STATE', data: ps });
      }

      if (type === 'PAYMENT_PREVIEW_ERROR' && payload) {
        const ps = { qrCode: null, bizId: null, amount: null, productId: null, status: 'error', updatedAt: Date.now(), errorMsg: payload.msg || `Error ${payload.code}` };
        await safeSet('local:paymentState', ps);
        postToOverlay({ type: 'PAYMENT_STATE', data: ps });
      }

      if (type === 'PAYMENT_CHECK' && payload) {
        const status = payload.bizId === 'SUCCESS' ? 'success'
          : payload.bizId === 'EXPIRE' ? 'expired' : 'pending';
        const current = await safeGet<any>('local:paymentState');
        if (current) {
          const updated = { ...current, status, updatedAt: Date.now() };
          await safeSet('local:paymentState', updated);
          postToOverlay({ type: 'PAYMENT_STATE', data: updated });
        }
      }
    });



    // ── Helper: receive RECOGNIZE_REQUEST from background, proxy to sandbox iframe ──
    function receiveRecognizeRequest(msg: any, sendResponse: (r: any) => void) {
      (async () => {
        try {
          sandboxIframe?.contentWindow?.postMessage(
            { target: 'ocr-sandbox', type: 'recognize', msgId: msg.msgId, buffers: msg.buffers },
            '*'
          );
          const result = await new Promise<any>((resolve, reject) => {
            sandboxPending.set(msg.msgId, { resolve, reject });
            setTimeout(() => {
              const p = sandboxPending.get(msg.msgId);
              if (p) { sandboxPending.delete(msg.msgId); reject(new Error('OCR timeout in sandbox')); }
            }, 135000);
          });
          sendResponse({ chars: result.chars });
        } catch (e: any) {
          sendResponse({ error: e.message || String(e) });
        }
      })();
    }

    // ── Listen for commands from popup + background ──
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.target === 'bm-capture' && msg.type === 'RECOGNIZE_REQUEST') {
        receiveRecognizeRequest(msg, sendResponse);
        return true;
      }
      if (msg.type === 'PRODUCE_CAPTCHA') {
        window.postMessage({ __miaosha_cmd: true, type: 'PRODUCE_CAPTCHA' }, '*');
        sendResponse({ ok: true });
      }
      if (msg.type === 'GET_TICKET_COUNT') {
        getTicketInfo().then((info) => sendResponse({ count: info.count }));
        return true;
      }
      if (msg.type === 'OPEN_POPUP') {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
      }
      if (msg.type === 'START_REPLENISH') {
        const targetCount = msg.targetCount || 30;
        window.postMessage({ __miaosha_cmd: true, type: 'AUTO_REPLENISH', data: { targetCount } }, '*');
        sendResponse({ ok: true });
      }
      if (msg.type === 'STOP_REPLENISH') {
        window.postMessage({ __miaosha_cmd: true, type: 'STOP_REPLENISH' }, '*');
        sendResponse({ ok: true });
      }
    });

    // Push replenish config immediately (independent from other sync)
    setTimeout(() => void pushReplenishConfigToMain(), 100);

    // Initial overlay sync
    setTimeout(async () => {
      try {
        const info = await getTicketInfo();
        postToOverlay({ type: 'TICKET_COUNT', count: info.count, ttl: info.ttl });
        // Push sale time so bm-main.js can schedule auto-fire
        const cfg = await getSaleConfig();
        const nst = getNextSaleTime(cfg);
        postToOverlay({ type: 'SALE_TIME_CONFIG', data: { config: cfg, nextSaleTime: nst } });
        // Push captcha batch limit to MAIN world
        const captchaCfg = await captchaStore.get();
        postToOverlay({ type: 'CAPTCHA_CONFIG', data: { batchSessionLimit: captchaCfg.batchSessionLimit } });
      } catch {}
    }, 2000);

    void startRuntimeCalibrationLoop();
    void startSoldOutWatcher();

    // R3: Start flash sale reminder loop (checks every 60s for 60/30/15 min marks)
    initReminderLoop();
  },
});
