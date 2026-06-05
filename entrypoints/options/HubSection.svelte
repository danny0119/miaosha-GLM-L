<script lang="ts">
  import { listAccounts, addAccount, deleteAccount, updateAccount, setCredentials, getCredentials, getAuthHeaders, type Account } from '../../lib/api/account-store';
  import { getHubConfig, setHubConfig, HUB_CONFIG_DEFAULT, type HubConfig } from '../../lib/api/hub-config';

  let accounts = $state<Account[]>([]);
  let loaded = $state(false);
  let hubConfig = $state<HubConfig>({ ...HUB_CONFIG_DEFAULT });
  let hubSaving = $state(false);
  let hubSaveMessage = $state('');

  let showAddModal = $state(false);
  let editAccountId = $state<string | null>(null);
  let addUsername = $state('');
  let addPassword = $state('');
  let editUsername = $state('');
  let editPassword = $state('');
  let savingAccount = $state(false);
  let accountError = $state('');

  let authStatuses = $state<Record<string, boolean>>({});

  $effect(() => {
    Promise.all([
      listAccounts(),
      getHubConfig(),
    ]).then(([accts, cfg]) => {
      accounts = accts;
      hubConfig = cfg;
      loaded = true;
      refreshAuthStatuses(accts);
    });
  });

  async function refreshAuthStatuses(accts?: Account[]) {
    const list = accts ?? accounts;
    const statuses: Record<string, boolean> = {};
    for (const a of list) {
      const h = await getAuthHeaders(a.id);
      statuses[a.id] = !!h;
    }
    authStatuses = statuses;
  }

  function openAddModal() {
    addUsername = '';
    addPassword = '';
    accountError = '';
    showAddModal = true;
    editAccountId = null;
  }

  function openEditModal(acct: Account) {
    editAccountId = acct.id;
    editUsername = acct.username;
    editPassword = '';
    accountError = '';
    showAddModal = true;
  }

  async function handleSaveAccount() {
    accountError = '';
    if (editAccountId) {
      if (!editUsername.trim()) { accountError = '请输入用户名'; return; }
      savingAccount = true;
      try {
        await updateAccount(editAccountId, editUsername.trim());
        if (editPassword.trim()) {
          await setCredentials(editAccountId, { username: editUsername.trim(), password: editPassword.trim() });
        }
        accounts = await listAccounts();
        showAddModal = false;
        editAccountId = null;
      } finally {
        savingAccount = false;
      }
    } else {
      if (!addUsername.trim()) { accountError = '请输入用户名'; return; }
      savingAccount = true;
      try {
        const acct = await addAccount(addUsername.trim());
        if (addPassword.trim()) {
          await setCredentials(acct.id, { username: addUsername.trim(), password: addPassword.trim() });
        }
        accounts = await listAccounts();
        refreshAuthStatuses();
        showAddModal = false;
      } finally {
        savingAccount = false;
      }
    }
  }

  async function handleDeleteAccount(id: string) {
    await deleteAccount(id);
    accounts = await listAccounts();
    refreshAuthStatuses();
  }

  function openIncognito(acct: Account) {
    chrome.runtime.sendMessage({ type: 'HUB_OPEN_INCOGNITO', accountId: acct.id });
  }

  async function handleHubConfirm() {
    hubSaving = true;
    hubSaveMessage = '';
    try {
      await setHubConfig(hubConfig);
      hubSaveMessage = '已生效：' + (hubConfig.enabled ? '多账号模式已开启' : '多账号模式已关闭');
    } finally {
      hubSaving = false;
    }
  }

  function handleHubReset() {
    hubConfig = { ...HUB_CONFIG_DEFAULT };
  }

  function isHubDirty(): boolean {
    return hubConfig.enabled !== HUB_CONFIG_DEFAULT.enabled
      || hubConfig.fireIntervalMs !== HUB_CONFIG_DEFAULT.fireIntervalMs;
  }
</script>

<section class="section-card">
  <div class="section-heading">
    <span class="accent-bar" style="background:var(--violet);box-shadow:0 0 14px rgba(99,102,241,0.35);"></span>
    <h3>👥 多账号</h3>
  </div>
  <p class="section-note">管理多个秒杀账号。每个账号使用独立的无痕窗口实现 Cookie 隔离。</p>

  {#if loaded}
    <div class="hub-config-row">
      <div class="form-group">
        <label class="form-label" for="hub-toggle">开启多账号模式</label>
        <label class="toggle-label">
          <input id="hub-toggle" type="checkbox" bind:checked={hubConfig.enabled} />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="hub-actions">
      {#if hubSaveMessage}
        <span class="save-message">{hubSaveMessage}</span>
      {/if}
      <button class="btn-confirm" type="button" onclick={handleHubConfirm} disabled={hubSaving || !isHubDirty()}>
        {hubSaving ? '保存中...' : '确定生效'}
      </button>
      <button class="btn-reset" type="button" onclick={handleHubReset}>
        ↺ 重置默认
      </button>
    </div>

    <div class="accounts-section">
      <div class="accounts-header">
        <span class="accounts-title">账号列表</span>
        <button class="btn-add-account" type="button" onclick={openAddModal}>
          ＋ 添加账号
        </button>
      </div>

      {#if accounts.length === 0}
        <div class="empty-state">暂无账号，点击上方按钮添加。</div>
      {:else}
        <div class="accounts-list">
          {#each accounts as acct}
            <div class="account-row">
              <div class="account-info">
                <span class="account-name">{acct.username}</span>
                <span class="account-id">{acct.id}</span>
                <span class="auth-badge" class:is-authed={authStatuses[acct.id]} class:is-unauth={!authStatuses[acct.id]}>
                  {authStatuses[acct.id] ? '已认证' : '未认证'}
                </span>
              </div>
              <div class="account-actions">
                <button class="btn-incognito" type="button" onclick={() => openIncognito(acct)} title="打开无痕窗口登录">
                  🪟 登录
                </button>
                <button class="btn-edit" type="button" onclick={() => openEditModal(acct)} title="编辑">
                  ✎
                </button>
                <button class="btn-delete" type="button" onclick={() => handleDeleteAccount(acct.id)} title="删除">
                  ✕
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="loading-skeleton">
      <div class="skeleton-row"></div>
    </div>
  {/if}
</section>

{#if showAddModal}
  <div class="modal-overlay" role="presentation" onclick={() => { if (!savingAccount) showAddModal = false; }} onkeydown={(e) => { if (e.key === 'Escape' && !savingAccount) showAddModal = false; }}>
    <div class="modal-card" role="dialog" tabindex="0" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="modal-heading">
        <h3>{editAccountId ? '编辑账号' : '添加账号'}</h3>
      </div>
      <div class="modal-body">
        {#if editAccountId}
          <div class="form-group">
            <label class="form-label" for="modal-username">用户名</label>
            <input id="modal-username" type="text" class="form-input" placeholder="输入 bigmodel.cn 用户名" bind:value={editUsername} />
          </div>
          <div class="form-group">
            <label class="form-label" for="modal-password">密码</label>
            <input id="modal-password" type="password" class="form-input" placeholder="留空则不修改" bind:value={editPassword} />
          </div>
        {:else}
          <div class="form-group">
            <label class="form-label" for="modal-username">用户名</label>
            <input id="modal-username" type="text" class="form-input" placeholder="输入 bigmodel.cn 用户名" bind:value={addUsername} />
          </div>
          <div class="form-group">
            <label class="form-label" for="modal-password">密码</label>
            <input id="modal-password" type="password" class="form-input" placeholder="输入密码" bind:value={addPassword} />
          </div>
        {/if}
        {#if accountError}
          <div class="form-error">{accountError}</div>
        {/if}
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" type="button" onclick={() => { if (!savingAccount) showAddModal = false; }} disabled={savingAccount}>取消</button>
        <button class="btn-confirm" type="button" onclick={handleSaveAccount} disabled={savingAccount}>
          {savingAccount ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .hub-config-row { margin-bottom: 12px; position: relative; z-index: 1; }
  .hub-actions { display: flex; align-items: center; gap: 10px; justify-content: flex-end; margin-bottom: 20px; position: relative; z-index: 1; }

  .accounts-section { position: relative; z-index: 1; }
  .accounts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .accounts-title { font-size: 13px; font-weight: 700; color: var(--text-strong); }
  .btn-add-account {
    padding: 6px 14px; border-radius: 10px; border: 1px solid rgba(16,185,129,0.28);
    background: rgba(16,185,129,0.1); color: var(--primary-strong);
    font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
    transition: background 180ms ease, transform 180ms ease;
  }
  .btn-add-account:hover { background: rgba(16,185,129,0.18); transform: translateY(-1px); }

  .accounts-list { display: flex; flex-direction: column; gap: 8px; }
  .account-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-radius: 14px;
    border: 1px solid var(--panel-border-soft);
    background: rgba(255,255,255,0.3);
    transition: background 180ms ease;
  }
  .account-row:hover { background: rgba(255,255,255,0.45); }
  @media (prefers-color-scheme: dark) { .account-row { background: rgba(15,23,42,0.3); } .account-row:hover { background: rgba(15,23,42,0.45); } }

  .account-info { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .account-name { font-size: 13px; font-weight: 700; color: var(--text-strong); }
  .account-id { font-size: 11px; color: var(--text-muted); font-family: 'SF Mono', Monaco, Consolas, monospace; }
  .auth-badge {
    display: inline-flex; padding: 2px 8px; border-radius: 999px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.05em;
  }
  .auth-badge.is-authed { background: rgba(16,185,129,0.12); color: var(--primary-strong); border: 1px solid rgba(16,185,129,0.2); }
  .auth-badge.is-unauth { background: rgba(148,163,184,0.12); color: var(--text-muted); border: 1px solid rgba(148,163,184,0.16); }

  .account-actions { display: flex; align-items: center; gap: 6px; }
  .account-actions button {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 8px;
    border: 1px solid var(--panel-border-soft); background: transparent;
    font-family: inherit; font-size: 13px; cursor: pointer;
    transition: background 180ms ease, transform 180ms ease;
    color: var(--text-muted);
  }
  .btn-incognito { width: auto !important; padding: 0 10px; gap: 4px; font-size: 11px; font-weight: 700; background: var(--violet-soft) !important; border-color: rgba(99,102,241,0.24) !important; color: var(--violet) !important; }
  .btn-incognito:hover { background: rgba(99,102,241,0.2) !important; transform: translateY(-1px); }
  .account-actions button:hover { background: rgba(148,163,184,0.12); transform: translateY(-1px); }
  .btn-delete:hover { background: var(--rose-soft) !important; border-color: rgba(244,63,94,0.2) !important; color: var(--rose) !important; }

  .empty-state { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; border-radius: 14px; border: 1px dashed var(--panel-border-soft); }

  /* Modal */
  .modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.32); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
  }
  .modal-card {
    width: min(400px, calc(100vw - 48px));
    background: var(--bg-base);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--card-shadow);
    overflow: hidden;
  }
  .modal-heading { padding: 24px 24px 0; }
  .modal-heading h3 { margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--text-strong); }
  .modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
  .modal-actions { padding: 0 24px 24px; display: flex; justify-content: flex-end; gap: 10px; }

  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .form-input {
    padding: 10px 12px; border-radius: 12px; border: 1px solid var(--panel-border-soft);
    background: var(--panel-surface); color: var(--text-strong);
    font-family: inherit; font-size: 14px; font-weight: 600;
    transition: border-color 180ms ease, box-shadow 180ms ease;
  }
  .form-input:focus { outline: none; border-color: var(--violet); box-shadow: 0 0 0 3px var(--violet-soft); }

  .form-error { color: var(--rose); font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px; background: var(--rose-soft); }

  .btn-cancel {
    padding: 9px 18px; border-radius: 12px;
    border: 1px solid var(--panel-border-soft);
    background: transparent; color: var(--text-muted);
    font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .btn-cancel:hover { background: rgba(148,163,184,0.08); }

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

  .save-message { margin-right: auto !important; color: var(--primary-strong); font-size: 12px; font-weight: 700; }
</style>
