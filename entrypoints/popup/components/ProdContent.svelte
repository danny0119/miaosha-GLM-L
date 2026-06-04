<script lang="ts">
  import { replenishStore, type ReplenishConfig } from '../../../lib/settings/replenish';
  import { REPLENISH_CONFIG_DEFAULT } from '../../../lib/settings/replenish';

  let replenishCfg = $state<ReplenishConfig>(REPLENISH_CONFIG_DEFAULT);
  let ticketCount = $state(0);
  let replenishActive = $state(false);
  let loaded = $state(false);

  $effect(() => {
    replenishStore.get().then((cfg) => {
      replenishCfg = cfg;
      loaded = true;
    });
    queryTicketCount();
  });

  async function queryTicketCount() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.bigmodel.cn/*' });
      const tab = tabs[0];
      if (tab?.id) {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TICKET_COUNT' });
        if (resp?.count != null) ticketCount = resp.count;
      }
    } catch {}
  }

  function openBigmodel() {
    chrome.tabs.create({ url: 'https://bigmodel.cn/glm-coding' });
  }

  async function triggerReplenish() {
    replenishActive = true;
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.bigmodel.cn/*' });
      const tab = tabs[0];
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'START_REPLENISH',
          targetCount: replenishCfg.targetCount,
        });
      } else {
        // Open bigmodel.cn first, then send
        const newTab = await chrome.tabs.create({ url: 'https://bigmodel.cn/glm-coding' });
        // Wait for tab to load, then send
        await new Promise((r) => setTimeout(r, 3000));
        await chrome.tabs.sendMessage(newTab.id!, {
          type: 'START_REPLENISH',
          targetCount: replenishCfg.targetCount,
        });
      }
    } catch (e: any) {
      replenishActive = false;
    }
  }

  // Listen for replenish status updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'REPLENISH_STATUS') {
      replenishActive = msg.active;
    }
    if (msg.type === 'TICKET_POOL_UPDATED') {
      ticketCount = msg.count ?? ticketCount;
    }
  });

  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    if (replenishActive) {
      pollingTimer = setInterval(queryTicketCount, 2000);
    } else {
      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
    }
    return () => { if (pollingTimer) clearInterval(pollingTimer); };
  });
</script>

<div class="prod-content">
  <div class="launch-card">
    <div class="launch-icon">&#128640;</div>
    <div class="launch-title">智谱 Coding Plan</div>
    <div class="launch-desc">打开智谱平台，开始秒杀准备</div>
    <button class="launch-btn" onclick={openBigmodel}>
      &#9654; 开始秒杀
    </button>
    <div class="launch-hint">在 bigmodel.cn 页面中使用 Captcha Pool 收集 tickets</div>
  </div>

  <div class="replenish-card">
    <div class="replenish-header">
      <span class="replenish-icon">&#127919;</span>
      <span class="replenish-title">自动补弹</span>
      <span class="replenish-badge" class:active={replenishActive} class:inactive={!replenishActive}>
        {replenishActive ? '补弹中' : (replenishCfg.enabled ? '已开启' : '已关闭')}
      </span>
    </div>
    <div class="replenish-stats">
      <div class="replenish-stat">
        <span class="stat-value">{ticketCount}</span>
        <span class="stat-label">当前子弹</span>
      </div>
      <div class="replenish-stat">
        <span class="stat-value">{replenishCfg.targetCount}</span>
        <span class="stat-label">目标</span>
      </div>
    </div>
    <button class="replenish-btn"
      onclick={triggerReplenish}
      disabled={replenishActive || !replenishCfg.enabled}>
      {replenishActive ? '补弹中...' : '一键补充'}
    </button>
  </div>
</div>

<style>
  .prod-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 16px;
    gap: 12px;
    overflow-y: auto;
  }

  .launch-card {
    text-align: center;
    max-width: 280px;
    padding: 16px;
    background: rgba(255,255,255,0.5);
    border-radius: 16px;
    border: 1px solid rgba(148,163,184,0.2);
    box-shadow: 0 4px 16px rgba(148,163,184,0.08);
    width: 100%;
  }
  @media (prefers-color-scheme: dark) {
    .launch-card { background: rgba(15,23,42,0.4); }
  }

  .launch-icon { font-size: 36px; margin-bottom: 8px; }
  .launch-title { font-size: 15px; font-weight: 800; color: #1e293b; margin-bottom: 4px; }
  .launch-desc { font-size: 11px; color: #94a3b8; margin-bottom: 12px; }
  .launch-btn {
    width: 100%; padding: 12px; border: 0; border-radius: 12px;
    background: linear-gradient(135deg, #6366f1, #818cf8);
    color: #fff; font-family: inherit; font-size: 13px; font-weight: 800;
    cursor: pointer; box-shadow: 0 6px 20px rgba(99, 102, 241, 0.25);
    transition: all 0.2s;
  }
  .launch-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35); }
  .launch-hint { font-size: 9px; color: #94a3b8; margin-top: 8px; }

  .replenish-card {
    width: 100%; padding: 14px 16px;
    background: rgba(255,255,255,0.5); border-radius: 16px;
    border: 1px solid rgba(148,163,184,0.2);
    box-shadow: 0 4px 16px rgba(148,163,184,0.08);
  }
  @media (prefers-color-scheme: dark) {
    .replenish-card { background: rgba(15,23,42,0.4); }
  }

  .replenish-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .replenish-icon { font-size: 18px; }
  .replenish-title { font-size: 14px; font-weight: 800; color: #1e293b; flex: 1; }
  .replenish-badge {
    padding: 3px 8px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: 0.05em;
  }
  .replenish-badge.active { background: rgba(16,185,129,0.14); color: #059669; border: 1px solid rgba(16,185,129,0.24); }
  .replenish-badge.inactive { background: rgba(148,163,184,0.14); color: #64748b; border: 1px solid rgba(148,163,184,0.2); }

  .replenish-stats { display: flex; gap: 16px; margin-bottom: 10px; }
  .replenish-stat { flex: 1; text-align: center; }
  .stat-value { display: block; font-size: 20px; font-weight: 800; color: #6366f1; }
  .stat-label { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

  .replenish-btn {
    width: 100%; padding: 10px; border: 1px solid rgba(99,102,241,0.28);
    border-radius: 12px; background: rgba(99,102,241,0.08); color: #6366f1;
    font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
    transition: all 0.2s;
  }
  .replenish-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .replenish-btn:not(:disabled):hover { background: rgba(99,102,241,0.16); transform: translateY(-1px); }
</style>
