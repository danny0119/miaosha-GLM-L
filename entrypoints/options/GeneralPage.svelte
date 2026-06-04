<script lang="ts">
  import { devEnvironment, type DevMode } from '../../lib/settings/dev';
  import {
    SALE_TIME_DEFAULT,
    getNextSaleTime,
    saleTimeStore,
    type SaleAlarmStatusSnapshot,
    type SaleTimeConfig,
  } from '../../lib/settings/sale-time';
  import {
    CAPTCHA_CONFIG_DEFAULT,
    captchaStore,
    type CaptchaConfig,
  } from '../../lib/settings/captcha';
  import {
    REPLENISH_CONFIG_DEFAULT,
    replenishStore,
    type ReplenishConfig,
  } from '../../lib/settings/replenish';

  let mode = $state<DevMode>('development');
  let loaded = $state(false);

  let saleHour = $state(9);
  let saleMinute = $state(54);
  let saleSecond = $state(59);
  let saleMs = $state(999);
  let saleTimezone = $state('Asia/Shanghai');
  let committedSale = $state<SaleTimeConfig | null>(null);
  let alarmStatus = $state<SaleAlarmStatusSnapshot | null>(null);
  let saleSaving = $state(false);
  let saleSaveMessage = $state('');

  let batchSessionLimit = $state(CAPTCHA_CONFIG_DEFAULT.batchSessionLimit);
  let committedCaptcha = $state<CaptchaConfig | null>(null);
  let captchaSaving = $state(false);
  let captchaSaveMessage = $state('');

  let replenishEnabled = $state(REPLENISH_CONFIG_DEFAULT.enabled);
  let replenishTarget = $state(REPLENISH_CONFIG_DEFAULT.targetCount);
  let replenishLeadSec = $state(REPLENISH_CONFIG_DEFAULT.leadTimeSec);
  let committedReplenish = $state<ReplenishConfig | null>(null);
  let replenishSaving = $state(false);
  let replenishSaveMessage = $state('');

  const TIMEZONES = [
    { value: 'Asia/Shanghai',    label: '🇨🇳 北京时间 (UTC+8)' },
    { value: 'Asia/Tokyo',       label: '🇯🇵 东京时间 (UTC+9)' },
    { value: 'Asia/Seoul',       label: '🇰🇷 首尔时间 (UTC+9)' },
    { value: 'America/New_York', label: '🇺🇸 纽约时间 (UTC-5)' },
    { value: 'America/Los_Angeles', label: '🇺🇸 洛杉矶时间 (UTC-8)' },
    { value: 'Europe/London',     label: '🇬🇧 伦敦时间 (UTC+0)' },
    { value: 'Europe/Paris',     label: '🇫🇷 巴黎时间 (UTC+1)' },
  ];

    $effect(() => {
    Promise.all([
      devEnvironment.get(),
      saleTimeStore.get(),
      saleTimeStore.getAlarmStatus(),
      captchaStore.get(),
      replenishStore.get(),
    ]).then(([m, s, status, captcha, replenish]) => {
      mode = m;
      saleHour = s.hour;
      saleMinute = s.minute;
      saleSecond = s.second;
      saleMs = s.ms;
      saleTimezone = s.timezone;
      committedSale = { ...s };
      alarmStatus = status;
      batchSessionLimit = captcha.batchSessionLimit;
      committedCaptcha = { ...captcha };
      replenishEnabled = replenish.enabled;
      replenishTarget = replenish.targetCount;
      replenishLeadSec = replenish.leadTimeSec;
      committedReplenish = { ...replenish };
      loaded = true;
    });
  });

  function handleModeChange(newMode: DevMode) {
    mode = newMode;
    devEnvironment.set(newMode);
  }

  function currentSaleConfig(): SaleTimeConfig {
    return {
      hour: Number(saleHour),
      minute: Number(saleMinute),
      second: Number(saleSecond),
      ms: Math.max(0, Math.min(999, Number(saleMs) || 0)),
      timezone: saleTimezone,
    };
  }

  function sameSaleConfig(a: SaleTimeConfig | null, b: SaleTimeConfig): boolean {
    return !!a
      && a.hour === b.hour
      && a.minute === b.minute
      && a.second === b.second
      && a.ms === b.ms
      && a.timezone === b.timezone;
  }

  function isSaleDirty(): boolean {
    return !sameSaleConfig(committedSale, currentSaleConfig());
  }

  function formatTs(ts: number, timezone = saleTimezone): string {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3,
    }).format(new Date(ts));
  }

  function computeNextSaleTs(): string {
    try {
      const config = currentSaleConfig();
      const saleUtc = getNextSaleTime(config);
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: config.timezone,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        fractionalSecondDigits: 3,
      }).format(new Date(saleUtc));
    } catch {
      return '计算失败';
    }
  }

  function formatRelative(ms: number): string {
    if (ms <= 0) return '已过期';
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${minutes}m ${seconds}s`;
  }

  async function handleSaleTimeConfirm() {
    const config = currentSaleConfig();
    saleSaving = true;
    saleSaveMessage = '';
    try {
      await saleTimeStore.set(config);
      const response = await chrome.runtime.sendMessage({ type: 'SALE_TIME_UPDATED', config });
      committedSale = { ...config };
      alarmStatus = response?.alarmStatus ?? await saleTimeStore.getAlarmStatus();
      saleSaveMessage = `已校正 ${alarmStatus?.pendingCount ?? 0} 个未生效提醒，${alarmStatus?.expiredCount ?? 0} 个已过期提醒`;
    } finally {
      saleSaving = false;
    }
  }

  async function handleReset() {
    saleHour = SALE_TIME_DEFAULT.hour;
    saleMinute = SALE_TIME_DEFAULT.minute;
    saleSecond = SALE_TIME_DEFAULT.second;
    saleMs = SALE_TIME_DEFAULT.ms;
    saleTimezone = SALE_TIME_DEFAULT.timezone;
    await handleSaleTimeConfirm();
  }

  function isCaptchaDirty(): boolean {
    return batchSessionLimit !== (committedCaptcha?.batchSessionLimit ?? CAPTCHA_CONFIG_DEFAULT.batchSessionLimit);
  }

  async function handleCaptchaConfirm() {
    const clamped = Math.max(1, Math.min(200, Number(batchSessionLimit) || CAPTCHA_CONFIG_DEFAULT.batchSessionLimit));
    batchSessionLimit = clamped;
    const config: CaptchaConfig = { batchSessionLimit: clamped };
    captchaSaving = true;
    captchaSaveMessage = '';
    try {
      await captchaStore.set(config);
      committedCaptcha = { ...config };
      captchaSaveMessage = `已生效：每轮录入 ${clamped} 个验证码`;
    } finally {
      captchaSaving = false;
    }
  }

  async function handleCaptchaReset() {
    batchSessionLimit = CAPTCHA_CONFIG_DEFAULT.batchSessionLimit;
    await handleCaptchaConfirm();
  }

  function currentReplenishConfig(): ReplenishConfig {
    return {
      enabled: replenishEnabled,
      targetCount: Math.max(1, Math.min(200, Number(replenishTarget) || REPLENISH_CONFIG_DEFAULT.targetCount)),
      leadTimeSec: Math.max(60, Math.min(600, Number(replenishLeadSec) || REPLENISH_CONFIG_DEFAULT.leadTimeSec)),
    };
  }

  function isReplenishDirty(): boolean {
    if (!committedReplenish) return true;
    const cur = currentReplenishConfig();
    return cur.enabled !== committedReplenish.enabled
      || cur.targetCount !== committedReplenish.targetCount
      || cur.leadTimeSec !== committedReplenish.leadTimeSec;
  }

  async function handleReplenishConfirm() {
    const config = currentReplenishConfig();
    replenishSaving = true;
    replenishSaveMessage = '';
    try {
      await replenishStore.set(config);
      committedReplenish = { ...config };
      replenishSaveMessage = `已生效：${config.enabled ? '已开启' : '已关闭'}，目标 ${config.targetCount} 子弹，提前 ${config.leadTimeSec}s`;
    } finally {
      replenishSaving = false;
    }
  }

  async function handleReplenishReset() {
    replenishEnabled = REPLENISH_CONFIG_DEFAULT.enabled;
    replenishTarget = REPLENISH_CONFIG_DEFAULT.targetCount;
    replenishLeadSec = REPLENISH_CONFIG_DEFAULT.leadTimeSec;
    await handleReplenishConfirm();
  }
</script>

<div class="page-stack">
  <section class="section-card">
    <div class="section-heading">
      <span class="accent-bar"></span>
      <h3>DEV Environment</h3>
    </div>
    <p class="section-note">Select the environment mode for the extension. Development mode enables debug features and verbose logging.</p>

    {#if loaded}
      <div class="settings-grid">
        <div class="radio-card" class:is-selected={mode === 'development'}>
          <label class="radio-label">
            <input type="radio" name="dev-mode" value="development" checked={mode === 'development'} onchange={() => handleModeChange('development')} />
            <div class="radio-content">
              <div class="radio-header">
                <span class="radio-icon dev-icon">&#128736;</span>
                <div>
                  <strong>Development</strong>
                  <span class="radio-badge dev-badge">DEV</span>
                </div>
              </div>
              <p>Enable debug features and verbose logging</p>
            </div>
          </label>
        </div>

        <div class="radio-card" class:is-selected={mode === 'production'}>
          <label class="radio-label">
            <input type="radio" name="dev-mode" value="production" checked={mode === 'production'} onchange={() => handleModeChange('production')} />
            <div class="radio-content">
              <div class="radio-header">
                <span class="radio-icon prod-icon">&#9889;</span>
                <div>
                  <strong>Production</strong>
                  <span class="radio-badge prod-badge">PROD</span>
                </div>
              </div>
              <p>Optimized for end users</p>
            </div>
          </label>
        </div>
      </div>

      <div class="status-bar">
        <span class="status-dot" class:dev={mode === 'development'} class:prod={mode === 'production'}></span>
        <span class="status-text">Current mode: <code>{mode}</code></span>
      </div>
    {:else}
      <div class="loading-skeleton">
        <div class="skeleton-row"></div>
        <div class="skeleton-row"></div>
      </div>
    {/if}
  </section>

  <section class="section-card">
    <div class="section-heading">
      <span class="accent-bar" style="background: var(--violet); box-shadow: 0 0 14px rgba(99,102,241,0.35);"></span>
      <h3>&#128293; 秒杀时间</h3>
    </div>
    <p class="section-note">设置每日秒杀开始时间。Badge 和闹钟提醒将在此时间前 60/30/15/5 分钟触发；T-5 提醒触发时，saleout 探测同步停止，进入最晚自动 Fire 准备阶段。</p>

    {#if loaded}
      <div class="sale-time-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="sale-hour">小时</label>
            <select id="sale-hour" class="form-select" bind:value={saleHour}>
              {#each Array.from({ length: 24 }, (_, i) => i) as h}
                <option value={h}>{h.toString().padStart(2, '0')}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="sale-minute">分</label>
            <select id="sale-minute" class="form-select" bind:value={saleMinute}>
              {#each Array.from({ length: 60 }, (_, i) => i) as m}
                <option value={m}>{m.toString().padStart(2, '0')}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="sale-second">秒</label>
            <select id="sale-second" class="form-select" bind:value={saleSecond}>
              {#each Array.from({ length: 60 }, (_, i) => i) as s}
                <option value={s}>{s.toString().padStart(2, '0')}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="sale-ms">毫秒</label>
            <input id="sale-ms" type="number" class="form-select form-input-num" min="0" max="999" step="1" bind:value={saleMs} />
          </div>
          <div class="form-group" style="flex: 2;">
            <label class="form-label" for="sale-tz">时区</label>
            <select id="sale-tz" class="form-select" bind:value={saleTimezone}>
              {#each TIMEZONES as tz}
                <option value={tz.value}>{tz.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="next-sale-preview">
          <span class="preview-label">下次触发</span>
          <span class="preview-value">
            <span class="highlight-val">{computeNextSaleTs()}</span>
          </span>
          {#if isSaleDirty()}
            <span class="dirty-pill">待确认</span>
          {/if}
        </div>

        {#if alarmStatus}
          <div class="alarm-status-panel">
            <div class="alarm-status-head">
              <span>提醒校正</span>
              <code>{formatTs(alarmStatus.nextSaleTime, alarmStatus.config.timezone)}</code>
            </div>
            <div class="alarm-status-list">
              {#each alarmStatus.items as item}
                <div class="alarm-status-row" class:is-pending={item.status === 'pending'} class:is-expired={item.status === 'expired'}>
                  <span class="alarm-name">T-{item.minutesBefore}m</span>
                  <span class="alarm-time">{formatTs(item.notificationTime, alarmStatus.config.timezone)}</span>
                  <span class="alarm-relative">{formatRelative(item.msUntilNotification)}</span>
                  <span class="alarm-state">{item.status === 'pending' ? '未生效' : '已过期'}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="sale-time-actions">
          {#if saleSaveMessage}
            <span class="save-message">{saleSaveMessage}</span>
          {/if}
          <button class="btn-confirm" type="button" onclick={handleSaleTimeConfirm} disabled={saleSaving || !isSaleDirty()}>
            {saleSaving ? '校正中...' : '确定生效'}
          </button>
          <button class="btn-reset" type="button" onclick={handleReset}>
            ↺ 重置默认 <span class="reset-hint">09:54:59.999 (UTC+8)</span>
          </button>
        </div>
      </div>
    {:else}
      <div class="loading-skeleton">
        <div class="skeleton-row"></div>
      </div>
    {/if}
  </section>

  <section class="section-card">
    <div class="section-heading">
      <span class="accent-bar" style="background: var(--amber); box-shadow: 0 0 14px rgba(217,119,6,0.35);"></span>
      <h3>&#127915; 验证码录入</h3>
    </div>
    <p class="section-note">设置一次 Batch 录入验证码的最大个数。达到上限后自动停止。</p>

    {#if loaded}
      <div class="sale-time-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="batch-limit">每轮录入个数</label>
            <input id="batch-limit" type="number" class="form-select form-input-num" min="1" max="200" step="1" bind:value={batchSessionLimit} />
          </div>
          <div class="form-group" style="flex: 2;">
            <div class="next-sale-preview" style="margin-top: 0;">
              <span class="preview-label">当前值</span>
              <span class="preview-value">
                <span class="highlight-val">{batchSessionLimit} 个</span>
              </span>
              {#if isCaptchaDirty()}
                <span class="dirty-pill">待确认</span>
              {/if}
            </div>
          </div>
        </div>

        <div class="sale-time-actions">
          {#if captchaSaveMessage}
            <span class="save-message">{captchaSaveMessage}</span>
          {/if}
          <button class="btn-confirm" type="button" onclick={handleCaptchaConfirm} disabled={captchaSaving || !isCaptchaDirty()}>
            {captchaSaving ? '保存中...' : '确定生效'}
          </button>
          <button class="btn-reset" type="button" onclick={handleCaptchaReset}>
            ↺ 重置默认 <span class="reset-hint">{CAPTCHA_CONFIG_DEFAULT.batchSessionLimit} 个</span>
          </button>
        </div>
      </div>
    {:else}
      <div class="loading-skeleton">
        <div class="skeleton-row"></div>
      </div>
    {/if}
  </section>

  <section class="section-card">
    <div class="section-heading">
      <span class="accent-bar" style="background: var(--indigo); box-shadow: 0 0 14px rgba(99,102,241,0.35);"></span>
      <h3>&#127919; 自动补弹</h3>
    </div>
    <p class="section-note">抢购前自动补充验证码子弹。T-5min 子弹过期，建议提前 300s（5分钟）开始补弹。</p>

    {#if loaded}
      <div class="sale-time-form">
        <div class="form-row">
          <div class="form-group" style="flex: 0 0 auto;">
            <label class="form-label" for="replenish-toggle">开启</label>
            <label class="toggle-label">
              <input id="replenish-toggle" type="checkbox" bind:checked={replenishEnabled} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="form-group">
            <label class="form-label" for="replenish-target">目标子弹数</label>
            <input id="replenish-target" type="number" class="form-select form-input-num" min="1" max="200" step="1" bind:value={replenishTarget} disabled={!replenishEnabled} />
          </div>
          <div class="form-group">
            <label class="form-label" for="replenish-lead">提前秒数</label>
            <input id="replenish-lead" type="number" class="form-select form-input-num" min="60" max="600" step="10" bind:value={replenishLeadSec} disabled={!replenishEnabled} />
          </div>
        </div>
        <div class="next-sale-preview">
          <span class="preview-label">当前设定</span>
          <span class="preview-value">
            <span class="highlight-val">{replenishEnabled ? '已开启' : '已关闭'}</span>
            {#if replenishEnabled}
              <span style="margin-left:8px;color:var(--text-muted);font-size:12px;">{replenishTarget} 弹 / 提前 {replenishLeadSec}s</span>
            {/if}
          </span>
          {#if isReplenishDirty()}
            <span class="dirty-pill">待确认</span>
          {/if}
        </div>

        <div class="sale-time-actions">
          {#if replenishSaveMessage}
            <span class="save-message">{replenishSaveMessage}</span>
          {/if}
          <button class="btn-confirm" type="button" onclick={handleReplenishConfirm} disabled={replenishSaving || !isReplenishDirty()}>
            {replenishSaving ? '保存中...' : '确定生效'}
          </button>
          <button class="btn-reset" type="button" onclick={handleReplenishReset}>
            ↺ 重置默认 <span class="reset-hint">{REPLENISH_CONFIG_DEFAULT.enabled ? '开' : '关'} / {REPLENISH_CONFIG_DEFAULT.targetCount} 弹 / {REPLENISH_CONFIG_DEFAULT.leadTimeSec}s</span>
          </button>
        </div>
      </div>
    {:else}
      <div class="loading-skeleton">
        <div class="skeleton-row"></div>
      </div>
    {/if}
  </section>
</div>

<style>
  .page-stack { display: flex; flex-direction: column; gap: 24px; }

  .section-card {
    background: linear-gradient(135deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.24) 100%);
    border: 1px solid var(--panel-border);
    border-top-color: rgba(255,255,255,0.88);
    border-left-color: rgba(255,255,255,0.88);
    box-shadow: var(--card-shadow);
    border-radius: var(--radius-xl);
    padding: 28px 30px;
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  @media (prefers-color-scheme: dark) {
    .section-card {
      background: linear-gradient(135deg, rgba(30,41,59,0.78) 0%, rgba(15,23,42,0.52) 100%);
      border-top-color: rgba(255,255,255,0.12);
      border-left-color: rgba(255,255,255,0.12);
    }
  }
  .section-card::before {
    content: '';
    position: absolute;
    inset: -80px auto auto -80px;
    width: 200px; height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(16,185,129,0.09), transparent 68%);
    pointer-events: none;
  }

  .section-heading { display: flex; align-items: center; gap: 12px; margin: 0 0 8px; position: relative; z-index: 1; }
  .accent-bar { width: 6px; height: 26px; border-radius: 999px; background: var(--primary); box-shadow: 0 0 14px rgba(16,185,129,0.35); flex: 0 0 auto; }
  .section-heading h3 { margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--text-strong); letter-spacing: -0.02em; }
  .section-note { margin: 0 0 24px 18px; color: var(--text-muted); font-size: 13px; line-height: 1.6; position: relative; z-index: 1; }

  .settings-grid { display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 1; }
  .radio-card {
    border-radius: var(--radius-lg);
    border: 1px solid var(--panel-border-soft);
    background: rgba(255,255,255,0.36);
    box-shadow: 0 10px 24px rgba(148,163,184,0.1);
    transition: all 200ms ease;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  @media (prefers-color-scheme: dark) { .radio-card { background: rgba(15,23,42,0.46); } }
  .radio-card:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(148,163,184,0.16); }
  .radio-card.is-selected {
    border-color: rgba(16,185,129,0.36);
    background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(20,184,166,0.04));
    box-shadow: 0 0 0 1px rgba(16,185,129,0.12), 0 14px 32px rgba(16,185,129,0.12);
  }
  .radio-label { display: flex; align-items: flex-start; gap: 16px; padding: 20px 22px; cursor: pointer; width: 100%; }
  .radio-label input[type='radio'] { position: absolute; opacity: 0; pointer-events: none; }
  .radio-content { flex: 1; min-width: 0; }
  .radio-header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .radio-icon { width: 40px; height: 40px; border-radius: 14px; display: grid; place-items: center; font-size: 18px; flex: 0 0 auto; }
  .dev-icon { background: rgba(251,191,36,0.16); color: #d97706; }
  .prod-icon { background: rgba(16,185,129,0.14); color: var(--primary); }
  .radio-header strong { font-size: 15px; font-weight: 700; color: var(--text-strong); }
  .radio-header > div { display: flex; align-items: center; gap: 8px; }
  .radio-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
  .dev-badge { background: rgba(251,191,36,0.16); color: #d97706; border: 1px solid rgba(251,191,36,0.28); }
  .prod-badge { background: rgba(16,185,129,0.14); color: var(--primary-strong); border: 1px solid rgba(16,185,129,0.24); }
  .radio-content p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; }

  .status-bar { display: flex; align-items: center; gap: 10px; margin-top: 20px; padding: 14px 18px; border-radius: 14px; background: rgba(255,255,255,0.34); border: 1px solid var(--panel-border-soft); position: relative; z-index: 1; }
  @media (prefers-color-scheme: dark) { .status-bar { background: rgba(15,23,42,0.34); } }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
  .status-dot.dev { background: #f59e0b; box-shadow: 0 0 10px rgba(245,158,11,0.4); }
  .status-dot.prod { background: var(--primary); box-shadow: 0 0 10px rgba(16,185,129,0.4); }
  .status-text { font-size: 13px; color: var(--text-muted); }
  .status-text code { background: rgba(148,163,184,0.16); padding: 2px 8px; border-radius: 6px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; font-weight: 600; color: var(--text-strong); }

  .sale-time-form { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 16px; }
  .form-row { display: flex; gap: 12px; align-items: flex-end; }
  .form-group { display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .form-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .form-select {
    padding: 10px 12px; border-radius: 12px; border: 1px solid var(--panel-border-soft);
    background: rgba(255,255,255,0.5); color: var(--text-strong); font-family: inherit; font-size: 14px; font-weight: 600;
    cursor: pointer; transition: border-color 180ms ease, box-shadow 180ms ease; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236d7c91' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 32px;
  }
  @media (prefers-color-scheme: dark) { .form-select { background-color: rgba(15,23,42,0.46); } }
  .form-select:focus { outline: none; border-color: var(--violet); box-shadow: 0 0 0 3px var(--violet-soft); }
  .form-input-num { background-image: none; padding-right: 12px; -moz-appearance: textfield; }
  .form-input-num::-webkit-inner-spin-button, .form-input-num::-webkit-outer-spin-button { opacity: 1; }

  .next-sale-preview { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: 12px; background: var(--violet-soft); border: 1px solid rgba(99,102,241,0.18); }
  .preview-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .preview-value { font-size: 14px; font-weight: 600; color: var(--text-strong); }
  .highlight-val { color: var(--violet); font-weight: 800; font-size: 16px; }
  .dirty-pill { margin-left: auto; padding: 3px 8px; border-radius: 999px; background: var(--amber-soft); color: var(--amber); border: 1px solid rgba(217,119,6,0.18); font-size: 11px; font-weight: 800; }

  .alarm-status-panel { border-radius: 14px; border: 1px solid var(--panel-border-soft); background: rgba(255,255,255,0.34); overflow: hidden; }
  @media (prefers-color-scheme: dark) { .alarm-status-panel { background: rgba(15,23,42,0.32); } }
  .alarm-status-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); color: var(--text-muted); font-size: 12px; font-weight: 800; }
  .alarm-status-head code { color: var(--violet); font-size: 11px; font-weight: 800; background: rgba(99,102,241,0.08); padding: 3px 7px; border-radius: 8px; }
  .alarm-status-list { display: flex; flex-direction: column; }
  .alarm-status-row { display: grid; grid-template-columns: 68px minmax(180px,1fr) 76px 68px; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid rgba(188,200,214,0.28); font-size: 12px; }
  .alarm-status-row:last-child { border-bottom: 0; }
  .alarm-name { font-family: 'SF Mono', Monaco, Consolas, monospace; font-weight: 800; color: var(--text-strong); }
  .alarm-time { color: var(--text-main); font-weight: 600; }
  .alarm-relative { color: var(--text-muted); font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 11px; }
  .alarm-state { justify-self: end; padding: 3px 7px; border-radius: 999px; font-size: 11px; font-weight: 800; }
  .alarm-status-row.is-pending .alarm-state { color: var(--primary-strong); background: var(--primary-soft); }
  .alarm-status-row.is-expired { opacity: 0.66; }
  .alarm-status-row.is-expired .alarm-state { color: var(--rose); background: var(--rose-soft); }

  .sale-time-actions { display: flex; align-items: center; gap: 10px; justify-content: flex-end; }
  .save-message { margin-right: auto; color: var(--primary-strong); font-size: 12px; font-weight: 700; }
  .btn-confirm, .btn-reset {
    display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 12px;
    border: 1px solid rgba(99,102,241,0.28); background: rgba(99,102,241,0.08); color: var(--violet);
    font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
    transition: background 180ms ease, transform 180ms ease, box-shadow 180ms ease;
  }
  .btn-confirm { border-color: rgba(16,185,129,0.32); background: rgba(16,185,129,0.12); color: var(--primary-strong); }
  .btn-confirm:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }
  .btn-confirm:not(:disabled):hover, .btn-reset:hover { background: rgba(99,102,241,0.16); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(99,102,241,0.18); }
  .btn-confirm:not(:disabled):hover { background: rgba(16,185,129,0.2); box-shadow: 0 4px 14px rgba(16,185,129,0.18); }
  .btn-confirm:active, .btn-reset:active { transform: translateY(0); }
  .reset-hint { font-size: 11px; font-weight: 600; opacity: 0.7; font-family: 'SF Mono', Monaco, Consolas, monospace; }

  .loading-skeleton { display: flex; flex-direction: column; gap: 16px; }
  .skeleton-row { height: 80px; border-radius: var(--radius-lg); background: linear-gradient(90deg, rgba(148,163,184,0.12), rgba(148,163,184,0.06), rgba(148,163,184,0.12)); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  @media (max-width: 960px) { .form-row, .sale-time-actions { flex-wrap: wrap; } }

  .toggle-label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 0; }
  .toggle-label input[type="checkbox"] { position: absolute; opacity: 0; pointer-events: none; }
  .toggle-slider {
    position: relative; width: 44px; height: 24px; border-radius: 999px; background: rgba(148,163,184,0.3);
    transition: background 200ms; flex: 0 0 auto;
  }
  .toggle-slider::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
    background: #fff; transition: transform 200ms; box-shadow: 0 2px 6px rgba(0,0,0,0.18);
  }
  .toggle-label input:checked + .toggle-slider { background: linear-gradient(135deg, #6366f1, #818cf8); }
  .toggle-label input:checked + .toggle-slider::after { transform: translateX(20px); }
</style>
