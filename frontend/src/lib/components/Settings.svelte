<script lang="ts">
  import { onMount } from "svelte";
  import { accounts, selectedAccountId, isSettingsOpen, showToast } from "$lib/stores";
  import { api, type Signature } from "$lib/api";
  import {
    type ShortcutAction,
    getShortcutsByCategory,
    setBinding,
    resetBinding,
    resetAllBindings,
    hasCustomBindings,
    formatKeyForDisplay,
    parseKeyEvent,
    defaultShortcuts,
    customBindings,
  } from "$lib/keyboardShortcuts";
  import { refreshKeyMaps } from "$lib/keyboard";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // Settings tabs
  type SettingsTab = "account" | "appearance" | "keyboard" | "notifications" | "ai" | "signatures";
  let activeTab = $state<SettingsTab>("account");

  // Appearance settings (stored in localStorage)
  let theme = $state<"dark" | "light">("dark");
  let fontSize = $state<"12" | "14" | "16">("14");
  let accentColor = $state<string>("#6366f1");

  // Preset accent colors
  const accentPresets = [
    { name: "Indigo", color: "#6366f1" },
    { name: "Blue", color: "#3b82f6" },
    { name: "Purple", color: "#8b5cf6" },
    { name: "Pink", color: "#ec4899" },
    { name: "Red", color: "#ef4444" },
    { name: "Orange", color: "#f97316" },
    { name: "Green", color: "#22c55e" },
    { name: "Teal", color: "#14b8a6" },
  ];

  // Notification settings (stored in localStorage)
  let notificationsEnabled = $state(false);
  let notifyImportantOnly = $state(false);
  let soundEnabled = $state(true);

  // AI status
  let aiConfigured = $state(false);
  let aiLoading = $state(true);

  // Account being deleted
  let deletingAccountId = $state<string | null>(null);

  // Account settings editing
  let editingAccountId = $state<string | null>(null);
  let editDisplayName = $state("");
  let editSyncFrequency = $state(60);
  let savingAccountSettings = $state(false);

  // Sync frequency options
  const syncFrequencyOptions = [
    { label: "30 seconds", value: 30 },
    { label: "1 minute", value: 60 },
    { label: "2 minutes", value: 120 },
    { label: "5 minutes", value: 300 },
    { label: "10 minutes", value: 600 },
    { label: "30 minutes", value: 1800 },
    { label: "1 hour", value: 3600 },
  ];

  // Keyboard shortcut customization state
  let shortcutGroups = $state(getShortcutsByCategory());
  let recordingAction = $state<ShortcutAction | null>(null);
  let recordedKey = $state<string>("");
  let conflictAction = $state<ShortcutAction | null>(null);
  let hasCustom = $state(hasCustomBindings());

  // Signature management state
  let signatures = $state<Signature[]>([]);
  let signaturesLoading = $state(true);
  let editingSignature = $state<Signature | null>(null);
  let isCreatingSignature = $state(false);
  let signatureName = $state("");
  let signatureContent = $state("");
  let signatureIsHtml = $state(false);
  let signatureIsDefault = $state(false);
  let signatureSaving = $state(false);
  let deletingSignatureId = $state<string | null>(null);

  // Subscribe to customBindings changes
  $effect(() => {
    const unsubscribe = customBindings.subscribe(() => {
      shortcutGroups = getShortcutsByCategory();
      hasCustom = hasCustomBindings();
    });
    return unsubscribe;
  });

  function startRecording(action: ShortcutAction) {
    recordingAction = action;
    recordedKey = "";
    conflictAction = null;
  }

  function stopRecording() {
    recordingAction = null;
    recordedKey = "";
    conflictAction = null;
  }

  function handleRecordKey(event: KeyboardEvent) {
    if (!recordingAction) return;

    event.preventDefault();
    event.stopPropagation();

    // Allow Escape to cancel
    if (event.key === "Escape") {
      stopRecording();
      return;
    }

    const key = parseKeyEvent(event);
    if (!key) return; // Ignore standalone modifier keys

    recordedKey = key;

    // Try to set the binding
    const result = setBinding(recordingAction, key);
    if (result.success) {
      refreshKeyMaps();
      showToast("Shortcut updated", "success");
      stopRecording();
    } else if (result.conflict) {
      conflictAction = result.conflict;
    }
  }

  function forceSetBinding() {
    if (!recordingAction || !recordedKey) return;

    // First clear the conflicting binding
    if (conflictAction) {
      resetBinding(conflictAction);
    }

    // Then set the new binding
    const result = setBinding(recordingAction, recordedKey);
    if (result.success) {
      refreshKeyMaps();
      showToast("Shortcut updated", "success");
    }
    stopRecording();
  }

  function handleResetShortcut(action: ShortcutAction) {
    resetBinding(action);
    refreshKeyMaps();
    showToast("Shortcut reset to default", "success");
  }

  function handleResetAll() {
    if (!confirm("Reset all keyboard shortcuts to their defaults?")) {
      return;
    }
    resetAllBindings();
    refreshKeyMaps();
    showToast("All shortcuts reset to defaults", "success");
  }

  function getActionDescription(action: ShortcutAction): string {
    const def = defaultShortcuts.find((s) => s.action === action);
    return def?.description || action;
  }

  onMount(async () => {
    // Load saved preferences from localStorage
    if (typeof localStorage !== "undefined") {
      theme = (localStorage.getItem("settings.theme") as "dark" | "light") || "dark";
      fontSize = (localStorage.getItem("settings.fontSize") as "12" | "14" | "16") || "14";
      accentColor = localStorage.getItem("settings.accentColor") || "#6366f1";
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

  // Helper to calculate hover color
  function adjustColor(hex: string, amount: number): string {
    hex = hex.replace("#", "");
    const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("settings.accentColor", accentColor);
      // Apply accent color to document
      document.documentElement.style.setProperty("--accent", accentColor);
      // Calculate hover color (lighter for dark theme, darker for light)
      const hoverColor = theme === "dark" ? adjustColor(accentColor, 20) : adjustColor(accentColor, -20);
      document.documentElement.style.setProperty("--accent-hover", hoverColor);
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
    // If recording a shortcut, handle it separately
    if (recordingAction) {
      handleRecordKey(e);
      return;
    }

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

  function startEditAccount(account: typeof $accounts[0]) {
    editingAccountId = account.id;
    editDisplayName = account.display_name || "";
    editSyncFrequency = account.sync_frequency_seconds ?? 60;
  }

  function cancelEditAccount() {
    editingAccountId = null;
    editDisplayName = "";
    editSyncFrequency = 60;
  }

  async function saveAccountSettings() {
    if (!editingAccountId) return;

    savingAccountSettings = true;
    try {
      const result = await api.updateAccount(editingAccountId, {
        displayName: editDisplayName.trim() || undefined,
        syncFrequencySeconds: editSyncFrequency,
      });

      if (result.success) {
        // Update local accounts store
        accounts.update(($accounts) =>
          $accounts.map((a) =>
            a.id === editingAccountId
              ? {
                  ...a,
                  display_name: editDisplayName.trim() || null,
                  sync_frequency_seconds: editSyncFrequency,
                }
              : a
          )
        );
        showToast("Account settings saved", "success");
        cancelEditAccount();
      } else {
        showToast(result.error || "Failed to save settings", "error");
      }
    } catch (e) {
      showToast("Failed to save settings", "error");
    } finally {
      savingAccountSettings = false;
    }
  }

  function formatSyncFrequency(seconds: number): string {
    const option = syncFrequencyOptions.find((o) => o.value === seconds);
    return option?.label || `${seconds}s`;
  }

  // Signature management functions
  async function loadSignatures() {
    if (!$selectedAccountId) return;
    signaturesLoading = true;
    try {
      signatures = await api.getSignatures($selectedAccountId);
    } catch (e) {
      console.error("Failed to load signatures:", e);
      signatures = [];
    } finally {
      signaturesLoading = false;
    }
  }

  function startCreateSignature() {
    editingSignature = null;
    isCreatingSignature = true;
    signatureName = "";
    signatureContent = "";
    signatureIsHtml = false;
    signatureIsDefault = signatures.length === 0; // Default to true if first signature
  }

  function startEditSignature(sig: Signature) {
    isCreatingSignature = false;
    editingSignature = sig;
    signatureName = sig.name;
    signatureContent = sig.content;
    signatureIsHtml = sig.is_html === 1;
    signatureIsDefault = sig.is_default === 1;
  }

  function cancelSignatureEdit() {
    editingSignature = null;
    isCreatingSignature = false;
    signatureName = "";
    signatureContent = "";
    signatureIsHtml = false;
    signatureIsDefault = false;
  }

  async function saveSignature() {
    if (!$selectedAccountId) return;
    if (!signatureName.trim()) {
      showToast("Please enter a signature name", "error");
      return;
    }

    signatureSaving = true;
    try {
      if (isCreatingSignature) {
        const result = await api.createSignature({
          accountId: $selectedAccountId,
          name: signatureName.trim(),
          content: signatureContent,
          isHtml: signatureIsHtml,
          isDefault: signatureIsDefault,
        });
        if (result.success) {
          showToast("Signature created", "success");
          await loadSignatures();
          cancelSignatureEdit();
        } else {
          showToast(result.error || "Failed to create signature", "error");
        }
      } else if (editingSignature) {
        const result = await api.updateSignature(editingSignature.id, {
          name: signatureName.trim(),
          content: signatureContent,
          isHtml: signatureIsHtml,
        });
        if (result.success) {
          // Handle default change separately
          if (signatureIsDefault && editingSignature.is_default !== 1) {
            await api.setDefaultSignature(editingSignature.id);
          } else if (!signatureIsDefault && editingSignature.is_default === 1) {
            await api.clearDefaultSignature(editingSignature.id);
          }
          showToast("Signature updated", "success");
          await loadSignatures();
          cancelSignatureEdit();
        } else {
          showToast(result.error || "Failed to update signature", "error");
        }
      }
    } catch (e) {
      showToast("Failed to save signature", "error");
    } finally {
      signatureSaving = false;
    }
  }

  async function deleteSignature(id: string) {
    if (!confirm("Are you sure you want to delete this signature?")) {
      return;
    }

    deletingSignatureId = id;
    try {
      const result = await api.deleteSignature(id);
      if (result.success) {
        showToast("Signature deleted", "success");
        await loadSignatures();
        if (editingSignature?.id === id) {
          cancelSignatureEdit();
        }
      } else {
        showToast(result.error || "Failed to delete signature", "error");
      }
    } catch (e) {
      showToast("Failed to delete signature", "error");
    } finally {
      deletingSignatureId = null;
    }
  }

  async function setAsDefault(id: string) {
    try {
      const result = await api.setDefaultSignature(id);
      if (result.success) {
        showToast("Default signature updated", "success");
        await loadSignatures();
      } else {
        showToast(result.error || "Failed to set default", "error");
      }
    } catch (e) {
      showToast("Failed to set default", "error");
    }
  }

  // Load signatures when switching to the signatures tab
  $effect(() => {
    if (activeTab === "signatures" && $selectedAccountId) {
      loadSignatures();
    }
  });
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
        <button class="tab" class:active={activeTab === "signatures"} onclick={() => (activeTab = "signatures")}>
          Signatures
        </button>
      </nav>

      <div class="tab-content">
        {#if activeTab === "account"}
          <div class="section">
            <h3>Connected Accounts</h3>
            <div class="accounts-list">
              {#each $accounts as account (account.id)}
                {#if editingAccountId === account.id}
                  <div class="account-item account-editing">
                    <div class="account-edit-form">
                      <div class="account-edit-header">
                        <span class="account-avatar" class:gmail={account.provider_type === "gmail"} class:imap={account.provider_type === "imap"}>
                          {account.provider_type === "gmail" ? "G" : "@"}
                        </span>
                        <div class="account-details">
                          <span class="account-email">{account.email}</span>
                          <span class="account-type">{account.provider_type === "gmail" ? "Gmail" : "IMAP"}</span>
                        </div>
                      </div>

                      <div class="form-row">
                        <label for="display-name">Display Name</label>
                        <input
                          id="display-name"
                          type="text"
                          bind:value={editDisplayName}
                          placeholder={account.name || account.email.split("@")[0]}
                        />
                        <span class="field-help">Custom name shown in the interface (leave empty to use account name)</span>
                      </div>

                      <div class="form-row">
                        <label for="sync-frequency">Sync Frequency</label>
                        <select id="sync-frequency" bind:value={editSyncFrequency}>
                          {#each syncFrequencyOptions as option}
                            <option value={option.value}>{option.label}</option>
                          {/each}
                        </select>
                        <span class="field-help">How often to check for new emails (Gmail uses real-time notifications when available)</span>
                      </div>

                      <div class="form-actions">
                        <button class="cancel-btn" onclick={cancelEditAccount} disabled={savingAccountSettings}>
                          Cancel
                        </button>
                        <button class="primary" onclick={saveAccountSettings} disabled={savingAccountSettings}>
                          {savingAccountSettings ? "Saving..." : "Save Changes"}
                        </button>
                      </div>

                      <div class="danger-zone">
                        <h4>Danger Zone</h4>
                        <div class="danger-action">
                          <div class="danger-info">
                            <span class="danger-title">Remove Account</span>
                            <span class="danger-desc">Emails will be deleted from this app but not from the server</span>
                          </div>
                          <button
                            class="remove-btn"
                            onclick={() => deleteAccount(account.id)}
                            disabled={deletingAccountId === account.id}
                          >
                            {deletingAccountId === account.id ? "Removing..." : "Remove"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                {:else}
                  <div class="account-item">
                    <div class="account-info">
                      <span class="account-avatar" class:gmail={account.provider_type === "gmail"} class:imap={account.provider_type === "imap"}>
                        {account.provider_type === "gmail" ? "G" : "@"}
                      </span>
                      <div class="account-details">
                        <span class="account-email">
                          {account.display_name || account.name || account.email}
                          {#if account.display_name && account.display_name !== account.email}
                            <span class="account-email-secondary">({account.email})</span>
                          {/if}
                        </span>
                        <span class="account-type">
                          {account.provider_type === "gmail" ? "Gmail" : "IMAP"}
                          <span class="sync-info">· Syncs every {formatSyncFrequency(account.sync_frequency_seconds ?? 60)}</span>
                        </span>
                      </div>
                    </div>
                    <button class="edit-btn" onclick={() => startEditAccount(account)}>
                      Edit
                    </button>
                  </div>
                {/if}
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
            <h3>Accent Color</h3>
            <div class="color-presets">
              {#each accentPresets as preset}
                <button
                  class="color-swatch"
                  class:selected={accentColor === preset.color}
                  style="background-color: {preset.color}"
                  title={preset.name}
                  onclick={() => (accentColor = preset.color)}
                ></button>
              {/each}
              <label class="custom-color-wrapper" title="Custom color">
                <input
                  type="color"
                  bind:value={accentColor}
                  class="custom-color-input"
                />
                <span class="custom-color-icon">+</span>
              </label>
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
            <div class="shortcuts-header">
              <p class="help-text">
                Click on a shortcut to rebind it. Press <kbd>?</kbd> anytime to see shortcuts.
              </p>
              {#if hasCustom}
                <button class="reset-all-btn" onclick={handleResetAll}>
                  Reset All
                </button>
              {/if}
            </div>
            <div class="shortcuts-list">
              {#each shortcutGroups as group}
                <div class="shortcut-group">
                  <h4>{group.category}</h4>
                  {#each group.shortcuts as shortcut}
                    {#if !shortcut.isAlias}
                      <div class="shortcut-row" class:is-custom={shortcut.isCustom}>
                        <span class="shortcut-desc">{shortcut.description}</span>
                        <div class="shortcut-actions">
                          <button
                            class="shortcut-key-btn"
                            class:recording={recordingAction === shortcut.action}
                            onclick={() => startRecording(shortcut.action)}
                          >
                            {#if recordingAction === shortcut.action}
                              {recordedKey ? formatKeyForDisplay(recordedKey) : "Press a key..."}
                            {:else}
                              <kbd>{formatKeyForDisplay(shortcut.key)}</kbd>
                            {/if}
                          </button>
                          {#if shortcut.isCustom}
                            <button
                              class="reset-btn"
                              title="Reset to default"
                              onclick={() => handleResetShortcut(shortcut.action)}
                            >
                              Reset
                            </button>
                          {/if}
                        </div>
                      </div>
                    {/if}
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
        {:else if activeTab === "signatures"}
          <div class="section">
            <div class="signatures-header">
              <h3>Email Signatures</h3>
              {#if !isCreatingSignature && !editingSignature}
                <button class="primary small" onclick={startCreateSignature}>
                  New Signature
                </button>
              {/if}
            </div>

            {#if signaturesLoading}
              <p class="loading">Loading signatures...</p>
            {:else if isCreatingSignature || editingSignature}
              <div class="signature-editor">
                <div class="signature-form">
                  <div class="form-row">
                    <label for="sig-name">Name</label>
                    <input
                      id="sig-name"
                      type="text"
                      bind:value={signatureName}
                      placeholder="e.g., Work, Personal"
                    />
                  </div>
                  <div class="form-row">
                    <label for="sig-content">Signature Content</label>
                    <textarea
                      id="sig-content"
                      bind:value={signatureContent}
                      placeholder="Enter your signature text here..."
                      rows={6}
                    ></textarea>
                  </div>
                  <div class="form-row checkbox-row">
                    <input
                      type="checkbox"
                      id="sig-html"
                      bind:checked={signatureIsHtml}
                    />
                    <label for="sig-html">Use HTML formatting</label>
                  </div>
                  <div class="form-row checkbox-row">
                    <input
                      type="checkbox"
                      id="sig-default"
                      bind:checked={signatureIsDefault}
                    />
                    <label for="sig-default">Set as default signature</label>
                  </div>
                  <div class="signature-preview">
                    <h4>Preview</h4>
                    <div class="preview-content">
                      {#if signatureIsHtml}
                        {@html signatureContent || '<span class="placeholder">Your signature will appear here</span>'}
                      {:else}
                        <pre>{signatureContent || 'Your signature will appear here'}</pre>
                      {/if}
                    </div>
                  </div>
                  <div class="form-actions">
                    <button class="cancel-btn" onclick={cancelSignatureEdit} disabled={signatureSaving}>
                      Cancel
                    </button>
                    <button class="primary" onclick={saveSignature} disabled={signatureSaving}>
                      {signatureSaving ? "Saving..." : isCreatingSignature ? "Create Signature" : "Save Changes"}
                    </button>
                  </div>
                </div>
              </div>
            {:else if signatures.length === 0}
              <div class="empty-signatures">
                <p>No signatures yet. Create a signature to automatically add it to your emails.</p>
              </div>
            {:else}
              <div class="signatures-list">
                {#each signatures as sig (sig.id)}
                  <div class="signature-item" class:is-default={sig.is_default === 1}>
                    <div class="signature-info">
                      <span class="signature-name">
                        {sig.name}
                        {#if sig.is_default === 1}
                          <span class="default-badge">Default</span>
                        {/if}
                      </span>
                      <span class="signature-type">
                        {sig.is_html === 1 ? "HTML" : "Plain text"}
                      </span>
                    </div>
                    <div class="signature-actions">
                      {#if sig.is_default !== 1}
                        <button
                          class="action-btn"
                          onclick={() => setAsDefault(sig.id)}
                          title="Set as default"
                        >
                          Set Default
                        </button>
                      {/if}
                      <button
                        class="action-btn"
                        onclick={() => startEditSignature(sig)}
                      >
                        Edit
                      </button>
                      <button
                        class="action-btn danger"
                        onclick={() => deleteSignature(sig.id)}
                        disabled={deletingSignatureId === sig.id}
                      >
                        {deletingSignatureId === sig.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <p class="help-text signatures-help">
              Your default signature will be automatically appended to new emails and replies.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Conflict resolution modal -->
{#if conflictAction}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="conflict-modal-backdrop" onclick={stopRecording} role="presentation" tabindex="-1">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="conflict-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <h3>Shortcut Conflict</h3>
      <p>
        <kbd>{formatKeyForDisplay(recordedKey)}</kbd> is already assigned to
        <strong>{getActionDescription(conflictAction)}</strong>.
      </p>
      <div class="conflict-actions">
        <button class="cancel-btn" onclick={stopRecording}>Cancel</button>
        <button class="replace-btn" onclick={forceSetBinding}>Replace</button>
      </div>
    </div>
  </div>
{/if}

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
    margin: 0;
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

  .edit-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .edit-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .account-editing {
    flex-direction: column;
    align-items: stretch;
  }

  .account-edit-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .account-edit-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .account-edit-form .form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .account-edit-form .form-row label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .account-edit-form .form-row input,
  .account-edit-form .form-row select {
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .account-edit-form .form-row input:focus,
  .account-edit-form .form-row select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .field-help {
    font-size: 12px;
    color: var(--text-muted);
  }

  .account-email-secondary {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 4px;
  }

  .sync-info {
    color: var(--text-muted);
  }

  .danger-zone {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .danger-zone h4 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--danger);
    margin: 0 0 12px;
  }

  .danger-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 8px;
  }

  .danger-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .danger-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .danger-desc {
    font-size: 12px;
    color: var(--text-muted);
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 20px;
  }

  /* Keyboard shortcuts styles */
  .shortcuts-section .help-text {
    margin: 0;
  }

  .shortcuts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .reset-all-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .reset-all-btn:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .shortcuts-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .shortcut-group h4 {
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
    letter-spacing: 0.5px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
  }

  .shortcut-row.is-custom .shortcut-desc {
    color: var(--accent);
  }

  .shortcut-desc {
    color: var(--text-secondary);
  }

  .shortcut-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .shortcut-key-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
    min-width: 60px;
    text-align: center;
    color: var(--text-primary);
    font-size: 13px;
  }

  .shortcut-key-btn:hover {
    border-color: var(--accent);
  }

  .shortcut-key-btn.recording {
    border-color: var(--accent);
    background: rgba(99, 102, 241, 0.1);
    color: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .reset-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
  }

  .reset-btn:hover {
    color: var(--text-primary);
    text-decoration: underline;
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

  .color-presets {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .color-swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }

  .color-swatch:hover {
    transform: scale(1.1);
  }

  .color-swatch.selected {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--bg-primary);
  }

  .custom-color-wrapper {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px dashed var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .custom-color-wrapper:hover {
    border-color: var(--text-secondary);
  }

  .custom-color-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    border: none;
    padding: 0;
  }

  .custom-color-icon {
    font-size: 18px;
    color: var(--text-muted);
    pointer-events: none;
  }

  /* Conflict modal */
  .conflict-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .conflict-modal {
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    text-align: center;
  }

  .conflict-modal h3 {
    margin: 0 0 12px;
    font-size: 16px;
  }

  .conflict-modal p {
    color: var(--text-secondary);
    font-size: 14px;
    margin: 0 0 20px;
  }

  .conflict-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .cancel-btn:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .replace-btn {
    background: var(--accent);
    border: none;
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .replace-btn:hover {
    background: var(--accent-hover);
  }

  /* Signature styles */
  .signatures-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .signatures-header h3 {
    margin: 0;
  }

  .signatures-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .signature-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .signature-item.is-default {
    border-color: var(--accent);
  }

  .signature-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .signature-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .default-badge {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 6px;
    background: var(--accent);
    color: white;
    border-radius: 4px;
  }

  .signature-type {
    font-size: 12px;
    color: var(--text-muted);
  }

  .signature-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .action-btn.danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .action-btn.danger:hover {
    background: var(--danger);
    color: white;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-signatures {
    text-align: center;
    padding: 32px 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px dashed var(--border);
  }

  .empty-signatures p {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0;
  }

  .signature-editor {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 16px;
    border: 1px solid var(--border);
  }

  .signature-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-row label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .form-row input[type="text"],
  .form-row textarea {
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
  }

  .form-row input[type="text"]:focus,
  .form-row textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .form-row textarea {
    resize: vertical;
    min-height: 100px;
  }

  .form-row.checkbox-row {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .form-row.checkbox-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }

  .form-row.checkbox-row label {
    font-weight: 400;
    color: var(--text-primary);
  }

  .signature-preview {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .signature-preview h4 {
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .preview-content {
    padding: 12px;
    font-size: 14px;
    color: var(--text-primary);
    min-height: 60px;
    max-height: 150px;
    overflow-y: auto;
  }

  .preview-content pre {
    margin: 0;
    font-family: inherit;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .preview-content .placeholder {
    color: var(--text-muted);
    font-style: italic;
  }

  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .form-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .signatures-help {
    margin-top: 16px;
  }
</style>
