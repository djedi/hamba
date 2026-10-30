<script lang="ts">
  import { Inbox, Star, Send, FilePen, AlarmClock, Bell, CalendarClock, Trash2, Archive, Settings, Hourglass, RefreshCw, Sun, Monitor, Moon, Keyboard } from "@lucide/svelte";
  import { unreadCount, isLoading, view, currentFolder, drafts, labels, selectedLabelId, labelActions, scheduledEmails, isSettingsOpen, isShortcutOverlayOpen } from "$lib/stores";
  import { isOnline, pendingActionsCount, syncNow } from "$lib/offline";
  import { themePreference, type ThemePreference } from "$lib/theme";
  import ConnectionStatus from "./ConnectionStatus.svelte";

  interface Props {
    onSync: () => void;
    onManageLabels?: () => void;
    onManageSnippets?: () => void;
  }

  let { onSync, onManageLabels, onManageSnippets }: Props = $props();

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

  const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "system", label: "System", icon: Monitor },
    { value: "dark", label: "Dark", icon: Moon },
  ];
</script>

<aside class="sidebar">
  <div class="logo">
    <img src="/favicon-96x96.png" alt="Hamba" class="logo-icon" width="22" height="22" />
    <span class="logo-text">Hamba</span>
  </div>

  <div class="sidebar-content">
  <nav class="nav">
    <button class="nav-item" class:active={$currentFolder === "inbox" && ($view === "inbox" || $view === "email")} onclick={goToInbox}>
      <span class="nav-icon"><Inbox size={16} /></span>
      <span class="nav-label">Inbox</span>
      {#if $unreadCount > 0}
        <span class="badge">{$unreadCount}</span>
      {/if}
    </button>
    <button class="nav-item" class:active={$currentFolder === "starred" && ($view === "inbox" || $view === "email")} onclick={goToStarred}>
      <span class="nav-icon"><Star size={16} /></span>
      <span class="nav-label">Starred</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "sent" && ($view === "inbox" || $view === "email")} onclick={goToSent}>
      <span class="nav-icon"><Send size={16} /></span>
      <span class="nav-label">Sent</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "drafts" && ($view === "inbox" || $view === "email")} onclick={goToDrafts}>
      <span class="nav-icon"><FilePen size={16} /></span>
      <span class="nav-label">Drafts</span>
      {#if $drafts.length > 0}
        <span class="badge">{$drafts.length}</span>
      {/if}
    </button>
    <button class="nav-item" class:active={$currentFolder === "snoozed" && ($view === "inbox" || $view === "email")} onclick={goToSnoozed}>
      <span class="nav-icon"><AlarmClock size={16} /></span>
      <span class="nav-label">Snoozed</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "reminders" && ($view === "inbox" || $view === "email")} onclick={goToReminders}>
      <span class="nav-icon"><Bell size={16} /></span>
      <span class="nav-label">Reminders</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "scheduled" && ($view === "inbox" || $view === "email")} onclick={goToScheduled}>
      <span class="nav-icon"><CalendarClock size={16} /></span>
      <span class="nav-label">Scheduled</span>
      {#if $scheduledEmails.length > 0}
        <span class="badge">{$scheduledEmails.length}</span>
      {/if}
    </button>
    <button class="nav-item" class:active={$currentFolder === "trash" && ($view === "inbox" || $view === "email")} onclick={goToTrash}>
      <span class="nav-icon"><Trash2 size={16} /></span>
      <span class="nav-label">Trash</span>
    </button>
    <button class="nav-item" class:active={$currentFolder === "archive" && ($view === "inbox" || $view === "email")} onclick={goToArchive}>
      <span class="nav-icon"><Archive size={16} /></span>
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

  <div class="snippets-section">
    <div class="snippets-header">
      <h4>Snippets</h4>
      {#if onManageSnippets}
        <button class="manage-snippets-btn" onclick={onManageSnippets} title="Manage snippets" aria-label="Manage snippets"><Settings size={14} /></button>
      {/if}
    </div>
    <div class="snippet-hint">Type <code>;shortcut</code> in compose</div>
  </div>

  <button class="shortcuts-hint" onclick={() => isShortcutOverlayOpen.set(true)} title="Show all keyboard shortcuts">
    <Keyboard size={14} /> Keyboard shortcuts <kbd>?</kbd>
  </button>
  </div>

  <div class="sidebar-footer">
    <ConnectionStatus />
    {#if $pendingActionsCount > 0 && $isOnline}
      <button class="sync-pending-btn" onclick={() => syncNow()}>
        <span class="pending-icon"><Hourglass size={14} /></span>
        <span>Sync {$pendingActionsCount} pending</span>
      </button>
    {/if}
    <div class="footer-buttons">
      <button class="settings-btn" onclick={() => isSettingsOpen.set(true)} title="Settings (⌘,)" aria-label="Settings">
        <Settings size={16} />
      </button>
      <button class="sync-btn" onclick={onSync} disabled={$isLoading || !$isOnline}>
        {#if $isLoading}
          <span class="spinner"></span> Syncing...
        {:else}
          <RefreshCw size={16} /> Sync
        {/if}
      </button>
    </div>
    <div class="theme-toggle" role="radiogroup" aria-label="Theme">
      {#each themeOptions as opt (opt.value)}
        <button
          class="theme-opt"
          class:active={$themePreference === opt.value}
          role="radio"
          aria-checked={$themePreference === opt.value}
          aria-label="{opt.label} theme"
          title="{opt.label} theme (⇧T to cycle)"
          onclick={() => themePreference.set(opt.value)}
        >
          <opt.icon size={13} />
        </button>
      {/each}
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
    padding: 12px;
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
    width: 22px;
    height: 22px;
    object-fit: contain;
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
    padding: 5px 10px;
    background: transparent;
    border: none;
    border-radius: var(--r-md);
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-selected);
    color: var(--text-primary);
  }

  .nav-item:hover .nav-icon {
    filter: drop-shadow(0 0 3px var(--account-glow));
  }

  .nav-item.active .nav-icon {
    color: var(--account-color);
    filter: drop-shadow(0 0 5px var(--account-glow));
  }

  .nav-item.active {
    box-shadow: inset 2px 0 0 var(--account-color);
  }

  .nav-icon {
    display: inline-flex;
    align-items: center;
    width: 24px;
  }

  .nav-label {
    flex: 1;
  }

  .badge {
    background: var(--accent);
    color: white;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .sidebar-footer {
    flex-shrink: 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    display: inline-flex;
  }

  .footer-buttons {
    display: flex;
    gap: 8px;
  }

  .settings-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

  .theme-toggle {
    display: flex;
    height: 24px;
    padding: 2px;
    gap: 2px;
    background: var(--bg-tertiary);
    border-radius: var(--r-md);
  }

  .theme-opt {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--r-sm);
  }

  .theme-opt:hover {
    background: transparent;
    color: var(--text-primary);
  }

  .theme-opt.active {
    background: var(--bg-primary);
    color: var(--accent);
    box-shadow: 0 0 0 1px var(--border);
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

  .shortcuts-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    margin-top: 12px;
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .shortcuts-hint:hover {
    background: var(--bg-hover, var(--bg-tertiary));
    color: var(--text-secondary, var(--text-primary));
  }

  .shortcuts-hint kbd {
    margin-left: auto;
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
    display: inline-flex;
    align-items: center;
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
