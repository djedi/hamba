<script lang="ts">
  import { accounts, selectedAccountId, unreadCount, isLoading, view, currentFolder, drafts } from "$lib/stores";

  interface Props {
    onSync: () => void;
    onAddAccount: () => void;
  }

  let { onSync, onAddAccount }: Props = $props();

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
</script>

<aside class="sidebar">
  <div class="logo">
    <span class="logo-icon">⚡</span>
    <span class="logo-text">Hamba</span>
  </div>

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
    <button class="nav-item" class:active={$currentFolder === "trash" && ($view === "inbox" || $view === "email")} onclick={goToTrash}>
      <span class="nav-icon">🗑️</span>
      <span class="nav-label">Trash</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "archive" && ($view === "inbox" || $view === "email")} onclick={goToArchive}>
      <span class="nav-icon">📦</span>
      <span class="nav-label">Archive</span>
    </button>
  </nav>

  <div class="accounts">
    <h3>Accounts</h3>
    {#each $accounts as account}
      <button
        class="account"
        class:active={account.id === $selectedAccountId}
        onclick={() => selectedAccountId.set(account.id)}
      >
        <span class="account-avatar" class:gmail={account.provider_type === "gmail"} class:imap={account.provider_type === "imap"}>
          {getProviderIcon(account.provider_type || "gmail")}
        </span>
        <span class="account-email">{account.email}</span>
      </button>
    {/each}
    <button class="account add" onclick={onAddAccount}>
      <span class="account-avatar">+</span>
      <span class="account-email">Add account</span>
    </button>
  </div>

  <div class="sidebar-footer">
    <button class="sync-btn" onclick={onSync} disabled={$isLoading}>
      {#if $isLoading}
        <span class="spinner"></span> Syncing...
      {:else}
        🔄 Sync
      {/if}
    </button>
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
    <div class="shortcut"><kbd>␣</kbd> scroll</div>
    <div class="shortcut"><kbd>e</kbd><kbd>y</kbd> archive</div>
    <div class="shortcut"><kbd>s</kbd> star</div>
    <div class="shortcut"><kbd>#</kbd><kbd>⌫</kbd> trash</div>
    <div class="shortcut"><kbd>⇧R</kbd> sync</div>
    <div class="shortcut"><kbd>⌘K</kbd> command</div>
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
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    margin-bottom: 24px;
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
    margin-bottom: 24px;
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
    width: 100%;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
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
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .sync-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
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
</style>
