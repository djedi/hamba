<script lang="ts">
  import { onMount } from "svelte";
  import { accounts, selectedAccountId, isSettingsOpen, showToast } from "$lib/stores";
  import { api } from "$lib/api";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // Settings tabs
  type SettingsTab = "account" | "appearance" | "keyboard" | "notifications" | "ai";
  let activeTab = $state<SettingsTab>("account");

  // Appearance settings (stored in localStorage)
  let theme = $state<"dark" | "light">("dark");
  let fontSize = $state<"12" | "14" | "16">("14");

  // Notification settings (stored in localStorage)
  let notificationsEnabled = $state(false);
  let notifyImportantOnly = $state(false);
  let soundEnabled = $state(true);

  // AI status
  let aiConfigured = $state(false);
  let aiLoading = $state(true);

  // Account being deleted
  let deletingAccountId = $state<string | null>(null);

  // Keyboard shortcuts data
  const shortcuts = [
    { category: "Navigation", items: [
      { keys: ["j", "k"], description: "Navigate up/down" },
      { keys: ["o", "Enter"], description: "Open email" },
      { keys: ["u", "Escape"], description: "Back to list" },
      { keys: ["Space"], description: "Scroll down" },
      { keys: ["Shift+Space"], description: "Scroll up" },
    ]},
    { category: "Go to", items: [
      { keys: ["gi"], description: "Go to Inbox" },
      { keys: ["gs"], description: "Go to Starred" },
      { keys: ["gt"], description: "Go to Sent" },
      { keys: ["gd"], description: "Go to Drafts" },
      { keys: ["gx"], description: "Go to Trash" },
      { keys: ["ga"], description: "Go to Archive" },
      { keys: ["gh"], description: "Go to Snoozed" },
      { keys: ["gr"], description: "Go to Reminders" },
      { keys: ["gl"], description: "Go to Scheduled" },
    ]},
    { category: "Actions", items: [
      { keys: ["e", "y"], description: "Archive" },
      { keys: ["#", "Backspace"], description: "Trash" },
      { keys: ["s"], description: "Star/Unstar" },
      { keys: ["!"], description: "Toggle important" },
      { keys: ["Shift+I"], description: "Toggle read/unread" },
      { keys: ["h"], description: "Snooze" },
      { keys: ["Shift+H"], description: "Set reminder" },
    ]},
    { category: "Compose", items: [
      { keys: ["c"], description: "New email" },
      { keys: ["r"], description: "Reply" },
      { keys: ["a"], description: "Reply all" },
      { keys: ["f"], description: "Forward" },
      { keys: ["Cmd+Enter"], description: "Send" },
      { keys: ["Cmd+J"], description: "AI compose" },
    ]},
    { category: "Inbox Tabs", items: [
      { keys: ["1"], description: "Important" },
      { keys: ["2"], description: "Other" },
      { keys: ["3"], description: "All" },
    ]},
    { category: "Other", items: [
      { keys: ["Cmd+K"], description: "Command palette" },
      { keys: ["Cmd+,"], description: "Settings" },
      { keys: ["/"], description: "Search" },
      { keys: ["?"], description: "Keyboard shortcuts" },
      { keys: ["Shift+R"], description: "Sync" },
    ]},
  ];

  onMount(async () => {
    // Load saved preferences from localStorage
    if (typeof localStorage !== "undefined") {
      theme = (localStorage.getItem("settings.theme") as "dark" | "light") || "dark";
      fontSize = (localStorage.getItem("settings.fontSize") as "12" | "14" | "16") || "14";
      notificationsEnabled = localStorage.getItem("settings.notifications") === "true";
      notifyImportantOnly = localStorage.getItem("settings.notifyImportantOnly") === "true";
      soundEnabled = localStorage.getItem("settings.sound") !== "false";
    }

    // Check AI status
    try {
      const status = await api.getAiStatus();
      aiConfigured = status.configured;
    } catch (e) {
      aiConfigured = false;
    } finally {
      aiLoading = false;
    }
  });

  // Save preferences when they change
  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("settings.theme", theme);
      // Apply theme to document
      document.documentElement.setAttribute("data-theme", theme);
    }
  });

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("settings.fontSize", fontSize);
      // Apply font size to document
      document.documentElement.style.fontSize = `${fontSize}px`;
    }
  });

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("settings.notifications", String(notificationsEnabled));
    }
  });

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("settings.notifyImportantOnly", String(notifyImportantOnly));
    }
  });

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("settings.sound", String(soundEnabled));
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      showToast("Notifications not supported in this browser", "error");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      notificationsEnabled = true;
      showToast("Notifications enabled", "success");
    } else {
      showToast("Notification permission denied", "error");
    }
  }

  async function deleteAccount(accountId: string) {
    if (!confirm("Are you sure you want to remove this account? Your emails will be deleted from this app but not from the server.")) {
      return;
    }

    deletingAccountId = accountId;
    try {
      await api.deleteAccount(accountId);
      accounts.update(($accounts) => $accounts.filter((a) => a.id !== accountId));

      // If this was the selected account, select another one
      if ($selectedAccountId === accountId) {
        const remaining = $accounts.filter((a) => a.id !== accountId);
        if (remaining.length > 0) {
          selectedAccountId.set(remaining[0].id);
        } else {
          selectedAccountId.set(null);
        }
      }

      showToast("Account removed", "success");
    } catch (e) {
      showToast("Failed to remove account", "error");
    } finally {
      deletingAccountId = null;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => e.key === "Escape" && onClose()} role="presentation" tabindex="-1">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-content">
      <nav class="tabs">
        <button class="tab" class:active={activeTab === "account"} onclick={() => (activeTab = "account")}>
          Account
        </button>
        <button class="tab" class:active={activeTab === "appearance"} onclick={() => (activeTab = "appearance")}>
          Appearance
        </button>
        <button class="tab" class:active={activeTab === "keyboard"} onclick={() => (activeTab = "keyboard")}>
          Keyboard
        </button>
        <button class="tab" class:active={activeTab === "notifications"} onclick={() => (activeTab = "notifications")}>
          Notifications
        </button>
        <button class="tab" class:active={activeTab === "ai"} onclick={() => (activeTab = "ai")}>
          AI
        </button>
      </nav>

      <div class="tab-content">
        {#if activeTab === "account"}
          <div class="section">
            <h3>Connected Accounts</h3>
            <div class="accounts-list">
              {#each $accounts as account (account.id)}
                <div class="account-item">
                  <div class="account-info">
                    <span class="account-avatar" class:gmail={account.provider_type === "gmail"} class:imap={account.provider_type === "imap"}>
                      {account.provider_type === "gmail" ? "G" : "@"}
                    </span>
                    <div class="account-details">
                      <span class="account-email">{account.email}</span>
                      <span class="account-type">{account.provider_type === "gmail" ? "Gmail" : "IMAP"}</span>
                    </div>
                  </div>
                  <button
                    class="remove-btn"
                    onclick={() => deleteAccount(account.id)}
                    disabled={deletingAccountId === account.id}
                  >
                    {deletingAccountId === account.id ? "Removing..." : "Remove"}
                  </button>
                </div>
              {/each}

              {#if $accounts.length === 0}
                <div class="empty">No accounts connected</div>
              {/if}
            </div>
            <p class="help-text">
              To add a new account, use the "Add account" button in the sidebar.
            </p>
          </div>
        {:else if activeTab === "appearance"}
          <div class="section">
            <h3>Theme</h3>
            <div class="setting-row">
              <label for="theme-select">Color theme</label>
              <select id="theme-select" bind:value={theme}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>

          <div class="section">
            <h3>Font Size</h3>
            <div class="setting-row">
              <label for="font-select">Base font size</label>
              <select id="font-select" bind:value={fontSize}>
                <option value="12">Small (12px)</option>
                <option value="14">Medium (14px)</option>
                <option value="16">Large (16px)</option>
              </select>
            </div>
          </div>
        {:else if activeTab === "keyboard"}
          <div class="section shortcuts-section">
            <p class="help-text">
              Hamba uses Vim-style keyboard shortcuts for fast navigation. Press <kbd>?</kbd> anytime to see this list.
            </p>
            <div class="shortcuts-grid">
              {#each shortcuts as group}
                <div class="shortcut-group">
                  <h4>{group.category}</h4>
                  {#each group.items as shortcut}
                    <div class="shortcut-item">
                      <span class="shortcut-keys">
                        {#each shortcut.keys as key, i}
                          <kbd>{key}</kbd>{#if i < shortcut.keys.length - 1}<span class="key-separator">/</span>{/if}
                        {/each}
                      </span>
                      <span class="shortcut-desc">{shortcut.description}</span>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {:else if activeTab === "notifications"}
          <div class="section">
            <h3>Desktop Notifications</h3>
            <div class="setting-row">
              <label for="notifications-toggle">Enable notifications</label>
              <div class="toggle-wrapper">
                {#if typeof Notification !== "undefined" && Notification.permission === "granted"}
                  <input
                    type="checkbox"
                    id="notifications-toggle"
                    bind:checked={notificationsEnabled}
                  />
                {:else}
                  <button class="primary small" onclick={requestNotificationPermission}>
                    Enable
                  </button>
                {/if}
              </div>
            </div>

            {#if notificationsEnabled}
              <div class="setting-row">
                <label for="notify-important">Important emails only</label>
                <input
                  type="checkbox"
                  id="notify-important"
                  bind:checked={notifyImportantOnly}
                />
              </div>
            {/if}
          </div>

          <div class="section">
            <h3>Sound</h3>
            <div class="setting-row">
              <label for="sound-toggle">Play sound for new mail</label>
              <input
                type="checkbox"
                id="sound-toggle"
                bind:checked={soundEnabled}
              />
            </div>
          </div>
        {:else if activeTab === "ai"}
          <div class="section">
            <h3>AI Features</h3>
            {#if aiLoading}
              <p class="loading">Checking AI status...</p>
            {:else if aiConfigured}
              <div class="ai-status configured">
                <span class="status-icon">✓</span>
                <div class="status-text">
                  <strong>AI is configured</strong>
                  <p>AI-powered features are available:</p>
                  <ul>
                    <li><kbd>Cmd+J</kbd> - AI compose in email</li>
                    <li>Smart reply suggestions</li>
                    <li>Email summarization</li>
                    <li>Split inbox classification</li>
                  </ul>
                </div>
              </div>
            {:else}
              <div class="ai-status not-configured">
                <span class="status-icon">!</span>
                <div class="status-text">
                  <strong>AI is not configured</strong>
                  <p>To enable AI features, add your Anthropic API key to the backend:</p>
                  <code>ANTHROPIC_API_KEY=your-key-here</code>
                  <p>Then restart the backend server.</p>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-primary);
    border-radius: 12px;
    width: 640px;
    max-width: 90vw;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 24px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .modal-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .tabs {
    display: flex;
    flex-direction: column;
    width: 140px;
    padding: 16px 0;
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .tab {
    background: transparent;
    border: none;
    padding: 10px 16px;
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
  }

  .tab:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .tab.active {
    color: var(--text-primary);
    background: var(--bg-tertiary);
    border-left: 2px solid var(--accent);
    padding-left: 14px;
  }

  .tab-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
  }

  .section {
    margin-bottom: 24px;
  }

  .section h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px;
    color: var(--text-primary);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .setting-row label {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .setting-row select {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 14px;
  }

  .setting-row input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }

  .toggle-wrapper {
    display: flex;
    align-items: center;
  }

  .help-text {
    font-size: 13px;
    color: var(--text-muted);
    margin: 12px 0 0;
  }

  .accounts-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .account-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
  }

  .account-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .account-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
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

  .account-details {
    display: flex;
    flex-direction: column;
  }

  .account-email {
    font-size: 14px;
    color: var(--text-primary);
  }

  .account-type {
    font-size: 12px;
    color: var(--text-muted);
  }

  .remove-btn {
    background: transparent;
    border: 1px solid var(--danger);
    color: var(--danger);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .remove-btn:hover {
    background: var(--danger);
    color: white;
  }

  .remove-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 20px;
  }

  .shortcuts-section .help-text {
    margin: 0 0 16px;
  }

  .shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }

  .shortcut-group h4 {
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
    letter-spacing: 0.5px;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 13px;
  }

  .shortcut-keys {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .key-separator {
    color: var(--text-muted);
    font-size: 11px;
  }

  .shortcut-desc {
    color: var(--text-secondary);
  }

  kbd {
    display: inline-block;
    padding: 2px 6px;
    font-family: monospace;
    font-size: 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
  }

  .loading {
    color: var(--text-muted);
    font-style: italic;
  }

  .ai-status {
    display: flex;
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
  }

  .ai-status.configured {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .ai-status.not-configured {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .ai-status .status-icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }

  .ai-status.configured .status-icon {
    background: var(--success);
    color: white;
  }

  .ai-status.not-configured .status-icon {
    background: #f59e0b;
    color: white;
  }

  .ai-status .status-text {
    flex: 1;
  }

  .ai-status .status-text strong {
    display: block;
    margin-bottom: 4px;
  }

  .ai-status .status-text p {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 4px 0;
  }

  .ai-status .status-text ul {
    margin: 8px 0;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .ai-status .status-text li {
    margin: 4px 0;
  }

  .ai-status .status-text code {
    display: block;
    background: var(--bg-primary);
    padding: 8px 12px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    margin: 8px 0;
    color: var(--accent);
  }

  button.primary.small {
    padding: 6px 12px;
    font-size: 13px;
  }
</style>
