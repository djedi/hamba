<script lang="ts">
  import { accounts, selectedAccountId, unreadCount, isLoading, view, currentFolder, drafts, labels, selectedLabelId, labelActions, scheduledEmails, isSettingsOpen } from "$lib/stores";
  import { isOnline, pendingActionsCount, syncNow } from "$lib/offline";
  import ConnectionStatus from "./ConnectionStatus.svelte";

  interface Props {
    onSync: () => void;
    onAddAccount: () => void;
    onManageLabels?: () => void;
    onManageSnippets?: () => void;
  }

  let { onSync, onAddAccount, onManageLabels, onManageSnippets }: Props = $props();

  function getProviderIcon(providerType: string): string {
    return providerType === "gmail" ? "G" : "@";
  }

  function goToInbox() {
    currentFolder.set("inbox");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToStarred() {
    currentFolder.set("starred");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToSent() {
    currentFolder.set("sent");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToDrafts() {
    currentFolder.set("drafts");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToTrash() {
    currentFolder.set("trash");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToArchive() {
    currentFolder.set("archive");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToSnoozed() {
    currentFolder.set("snoozed");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToReminders() {
    currentFolder.set("reminders");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToScheduled() {
    currentFolder.set("scheduled");
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function goToLabel(labelId: string) {
    currentFolder.set("label");
    selectedLabelId.set(labelId);
    view.set("inbox");
    // Clear URL param
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }
</script>

<aside class="sidebar">
  <div class="logo">
    <span class="logo-icon">⚡</span>
    <span class="logo-text">Hamba</span>
  </div>

  <div class="sidebar-content">
  <nav class="nav">
    <button class="nav-item" class:active={$currentFolder === "inbox" && ($view === "inbox" || $view === "email")} onclick={goToInbox}>
      <span class="nav-icon">📥</span>
      <span class="nav-label">Inbox</span>
      {#if $unreadCount > 0}
        <span class="badge">{$unreadCount}</span>
      {/if}
    </button>
    <button class="nav-item" class:active={$currentFolder === "starred" && ($view === "inbox" || $view === "email")} onclick={goToStarred}>
      <span class="nav-icon">⭐</span>
      <span class="nav-label">Starred</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "sent" && ($view === "inbox" || $view === "email")} onclick={goToSent}>
      <span class="nav-icon">📤</span>
      <span class="nav-label">Sent</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "drafts" && ($view === "inbox" || $view === "email")} onclick={goToDrafts}>
      <span class="nav-icon">📝</span>
      <span class="nav-label">Drafts</span>
      {#if $drafts.length > 0}
        <span class="badge">{$drafts.length}</span>
      {/if}
    </button>
    <button class="nav-item" class:active={$currentFolder === "snoozed" && ($view === "inbox" || $view === "email")} onclick={goToSnoozed}>
      <span class="nav-icon">⏰</span>
      <span class="nav-label">Snoozed</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "reminders" && ($view === "inbox" || $view === "email")} onclick={goToReminders}>
      <span class="nav-icon">🔔</span>
      <span class="nav-label">Reminders</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "scheduled" && ($view === "inbox" || $view === "email")} onclick={goToScheduled}>
      <span class="nav-icon">📅</span>
      <span class="nav-label">Scheduled</span>
      {#if $scheduledEmails.length > 0}
        <span class="badge">{$scheduledEmails.length}</span>
      {/if}
    </button>
    <button class="nav-item" class:active={$currentFolder === "trash" && ($view === "inbox" || $view === "email")} onclick={goToTrash}>
      <span class="nav-icon">🗑️</span>
      <span class="nav-label">Trash</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "archive" && ($view === "inbox" || $view === "email")} onclick={goToArchive}>
      <span class="nav-icon">📦</span>
      <span class="nav-label">Archive</span>
    </button>
  </nav>

  {#if $labels.length > 0}
    <div class="labels-section">
      <div class="labels-header">
        <h3>Labels</h3>
        {#if onManageLabels}
          <button class="manage-labels-btn" onclick={onManageLabels} title="Manage labels">+</button>
        {/if}
      </div>
      <div class="labels-list">
        {#each $labels as label (label.id)}
          <button
            class="label-item"
            class:active={$currentFolder === "label" && $selectedLabelId === label.id}
            onclick={() => goToLabel(label.id)}
          >
            <span class="label-dot" style="background-color: {label.color}"></span>
            <span class="label-name">{label.name}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="accounts">
    <h3>Accounts</h3>
    {#each $accounts as account, i}
      <button
        class="account"
        class:active={account.id === $selectedAccountId}
        onclick={() => selectedAccountId.set(account.id)}
        title={`${account.email} (⌘${i + 1})`}
      >
        <span class="account-indicator" class:active={account.id === $selectedAccountId}></span>
        <span class="account-avatar" class:gmail={account.provider_type === "gmail"} class:imap={account.provider_type === "imap"}>
          {getProviderIcon(account.provider_type || "gmail")}
        </span>
        <span class="account-email">{account.email}</span>
        {#if account.unread_count && account.unread_count > 0}
          <span class="badge account-badge">{account.unread_count}</span>
        {/if}
      </button>
    {/each}
    <button class="account add" onclick={onAddAccount}>
      <span class="account-indicator"></span>
      <span class="account-avatar">+</span>
      <span class="account-email">Add account</span>
    </button>
  </div>

  <div class="snippets-section">
    <div class="snippets-header">
      <h4>Snippets</h4>
      {#if onManageSnippets}
        <button class="manage-snippets-btn" onclick={onManageSnippets} title="Manage snippets">⚙</button>
      {/if}
    </div>
    <div class="snippet-hint">Type <code>;shortcut</code> in compose</div>
  </div>

  <div class="shortcuts">
    <h4>Shortcuts</h4>
    <div class="shortcut"><kbd>j</kbd><kbd>k</kbd> navigate</div>
    <div class="shortcut"><kbd>o</kbd> open</div>
    <div class="shortcut"><kbd>gi</kbd> inbox</div>
    <div class="shortcut"><kbd>gs</kbd> starred</div>
    <div class="shortcut"><kbd>gt</kbd> sent</div>
    <div class="shortcut"><kbd>gd</kbd> drafts</div>
    <div class="shortcut"><kbd>gx</kbd> trash</div>
    <div class="shortcut"><kbd>ga</kbd> archive</div>
    <div class="shortcut"><kbd>gh</kbd> snoozed</div>
    <div class="shortcut"><kbd>gr</kbd> reminders</div>
    <div class="shortcut"><kbd>gl</kbd> scheduled</div>
    <div class="shortcut"><kbd>␣</kbd> scroll</div>
    <div class="shortcut"><kbd>e</kbd><kbd>y</kbd> archive</div>
    <div class="shortcut"><kbd>s</kbd> star</div>
    <div class="shortcut"><kbd>h</kbd> snooze</div>
    <div class="shortcut"><kbd>⇧H</kbd> remind</div>
    <div class="shortcut"><kbd>!</kbd> important</div>
    <div class="shortcut"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> inbox tabs</div>
    <div class="shortcut"><kbd>#</kbd><kbd>⌫</kbd> trash</div>
    <div class="shortcut"><kbd>⇧R</kbd> sync</div>
    <div class="shortcut"><kbd>⌘K</kbd> command</div>
    <div class="shortcut"><kbd>⌘,</kbd> settings</div>
    <div class="shortcut"><kbd>⌘1</kbd><kbd>⌘2</kbd><kbd>⌘3</kbd> accounts</div>
  </div>
  </div>

  <div class="sidebar-footer">
    <ConnectionStatus />
    {#if $pendingActionsCount > 0 && $isOnline}
      <button class="sync-pending-btn" onclick={() => syncNow()}>
        <span class="pending-icon">⏳</span>
        <span>Sync {$pendingActionsCount} pending</span>
      </button>
    {/if}
    <div class="footer-buttons">
      <button class="settings-btn" onclick={() => isSettingsOpen.set(true)} title="Settings (⌘,)">
        ⚙️
      </button>
      <button class="sync-btn" onclick={onSync} disabled={$isLoading || !$isOnline}>
        {#if $isLoading}
          <span class="spinner"></span> Syncing...
        {:else}
          🔄 Sync
        {/if}
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: 220px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 16px;
    height: 100%;
    overflow: hidden;
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    margin-bottom: 24px;
    flex-shrink: 0;
  }

  .logo-icon {
    font-size: 24px;
  }

  .logo-text {
    font-size: 18px;
    font-weight: 700;
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
  }

  .labels-section {
    margin-bottom: 16px;
  }

  .labels-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    margin-bottom: 8px;
  }

  .labels-header h3 {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    letter-spacing: 0.5px;
  }

  .manage-labels-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0;
    line-height: 1;
  }

  .manage-labels-btn:hover {
    color: var(--accent);
  }

  .labels-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
    width: 100%;
  }

  .label-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .label-item.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .label-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .label-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .nav-icon {
    font-size: 16px;
    width: 24px;
  }

  .nav-label {
    flex: 1;
  }

  .badge {
    background: var(--accent);
    color: white;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: 600;
  }

  .accounts {
    margin-bottom: 24px;
  }

  .accounts h3 {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 8px;
    padding: 0 8px;
    letter-spacing: 0.5px;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    padding-left: 4px;
    width: 100%;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    position: relative;
  }

  .account:hover {
    background: var(--bg-hover);
  }

  .account.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .account.add {
    color: var(--accent);
  }

  .account-indicator {
    width: 3px;
    height: 20px;
    border-radius: 2px;
    background: transparent;
    flex-shrink: 0;
    transition: background 0.15s ease;
  }

  .account-indicator.active {
    background: var(--accent);
  }

  .account-badge {
    font-size: 10px;
    padding: 1px 5px;
    margin-left: auto;
  }

  .account-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
  }

  .account-avatar.gmail {
    background: #ea4335;
    color: white;
  }

  .account-avatar.imap {
    background: #6366f1;
    color: white;
  }

  .account-email {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .sidebar-footer {
    flex-shrink: 0;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sync-pending-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--accent);
    cursor: pointer;
    font-size: 13px;
  }

  .sync-pending-btn:hover {
    background: var(--bg-hover);
  }

  .pending-icon {
    font-size: 14px;
  }

  .footer-buttons {
    display: flex;
    gap: 8px;
  }

  .settings-btn {
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .settings-btn:hover {
    background: var(--bg-hover);
  }

  .sync-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .sync-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--text-muted);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .shortcuts {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .shortcuts h4 {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .snippets-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .snippets-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .snippets-header h4 {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    letter-spacing: 0.5px;
  }

  .manage-snippets-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    line-height: 1;
  }

  .manage-snippets-btn:hover {
    color: var(--accent);
  }

  .snippet-hint {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .snippet-hint code {
    background: var(--bg-primary);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    color: var(--accent);
  }
</style>
