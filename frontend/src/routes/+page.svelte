<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api, AuthError } from "$lib/api";
  import { registerSyncCallback } from "$lib/keyboard";
  import { connect, disconnect, onMessage, subscribe } from "$lib/realtime";
  import {
    accounts,
    selectedAccountId,
    emails,
    selectedEmailId,
    selectedIndex,
    isLoading,
    view,
    isCommandPaletteOpen,
    isSnoozeModalOpen,
    isReminderModalOpen,
    isShortcutOverlayOpen,
    composeMode,
    replyToEmail,
    toasts,
    showToast,
    currentFolder,
    inboxTab,
    drafts,
    labels,
    selectedLabelId,
    labelActions,
    scheduledEmails,
    scheduledEmailActions,
    snippetActions,
    emailOffset,
    isLoadingMore,
    hasMoreEmails,
  } from "$lib/stores";
  import type { Draft } from "$lib/api";
  import EmailList from "$lib/components/EmailList.svelte";
  import ThreadView from "$lib/components/ThreadView.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import SearchBar from "$lib/components/SearchBar.svelte";
  import Compose from "$lib/components/Compose.svelte";
  import AddAccountModal from "$lib/components/AddAccountModal.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import DraftList from "$lib/components/DraftList.svelte";
  import LabelManager from "$lib/components/LabelManager.svelte";
  import SnippetManager from "$lib/components/SnippetManager.svelte";
  import InboxTabs from "$lib/components/InboxTabs.svelte";
  import SnoozeModal from "$lib/components/SnoozeModal.svelte";
  import ReminderModal from "$lib/components/ReminderModal.svelte";
  import ScheduledList from "$lib/components/ScheduledList.svelte";
  import KeyboardShortcutOverlay from "$lib/components/KeyboardShortcutOverlay.svelte";

  let needsReauth = $state(false);
  let errorMessage = $state("");
  let showAddAccountModal = $state(false);
  let showLabelManager = $state(false);
  let showSnippetManager = $state(false);
  let autoSyncInterval: ReturnType<typeof setInterval> | null = null;
  let lastLoadedAccountId: string | null = null;
  let unsubscribeRealtime: (() => void) | null = null;
  let selectedDraft = $state<Draft | null>(null);

  // Auto-sync every 60 seconds (fallback for Gmail accounts without push)
  const AUTO_SYNC_INTERVAL = 60 * 1000;

  // Pagination constants
  const PAGE_SIZE = 50;

  let lastLoadedFolder: string | null = null;
  let lastLoadedTab: string | null = null;

  // Load emails when selected account changes (but not on initial mount)
  $effect(() => {
    const accountId = $selectedAccountId;
    if (accountId && lastLoadedAccountId !== null && accountId !== lastLoadedAccountId) {
      lastLoadedAccountId = accountId;
      view.set("inbox");
      // Clear email param from URL when switching accounts
      const url = new URL(window.location.href);
      url.searchParams.delete("email");
      window.history.pushState({}, "", url);
      loadEmails(accountId);
      // Also load labels and snippets for the new account
      labelActions.loadLabels(accountId);
      snippetActions.loadSnippets(accountId);
    }
  });

  // Load emails when folder changes
  $effect(() => {
    const folder = $currentFolder;
    const accountId = $selectedAccountId;
    if (accountId && lastLoadedFolder !== null && folder !== lastLoadedFolder) {
      lastLoadedFolder = folder;
      view.set("inbox");
      loadEmails(accountId, null, folder);
    }
  });

  // Load emails when inbox tab changes (Important/Other/All)
  $effect(() => {
    const tab = $inboxTab;
    const folder = $currentFolder;
    const accountId = $selectedAccountId;
    if (accountId && folder === "inbox" && lastLoadedTab !== null && tab !== lastLoadedTab) {
      lastLoadedTab = tab;
      loadEmails(accountId, null, folder);
    }
  });

  // Clear selectedDraft when view changes away from compose (unless coming from drafts)
  $effect(() => {
    const currentView = $view;
    if (currentView !== "compose") {
      selectedDraft = null;
    }
  });

  onMount(async () => {
    // Register sync callback for keyboard shortcut (Shift+R)
    registerSyncCallback(syncEmails);

    // Connect to WebSocket for real-time updates
    connect();
    unsubscribeRealtime = onMessage(handleRealtimeMessage);

    // Parse URL params
    const params = new URLSearchParams(window.location.search);
    const emailIdFromUrl = params.get("email");

    // Check for auth callback
    if (params.get("auth") === "success") {
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", url);
      needsReauth = false;
    }

    // Load accounts
    try {
      const accts = await api.getAccounts();
      accounts.set(accts);

      if (accts.length > 0) {
        const firstAccountId = accts[0].id;
        selectedAccountId.set(firstAccountId);
        lastLoadedAccountId = firstAccountId;
        lastLoadedFolder = $currentFolder;
        lastLoadedTab = $inboxTab;

        // Subscribe to real-time updates for all accounts
        accts.forEach(acct => subscribe(acct.id));

        // Load labels, snippets and emails with URL param to restore view state
        await labelActions.loadLabels(firstAccountId);
        await snippetActions.loadSnippets(firstAccountId);
        await loadEmails(firstAccountId, emailIdFromUrl);

        // Start auto-sync as fallback (for Gmail without push)
        autoSyncInterval = setInterval(syncEmails, AUTO_SYNC_INTERVAL);
      }
    } catch (err) {
      handleError(err);
    }
  });

  onDestroy(() => {
    if (autoSyncInterval) {
      clearInterval(autoSyncInterval);
      autoSyncInterval = null;
    }
    if (unsubscribeRealtime) {
      unsubscribeRealtime();
    }
    disconnect();
  });

  // Handle real-time WebSocket messages
  function handleRealtimeMessage(data: any) {
    if (data.type === "new_mail" || data.type === "sync_complete") {
      const currentAccountId = $selectedAccountId;
      if (currentAccountId && data.accountId === currentAccountId) {
        // Silently refresh emails without showing loading state
        const folder = $currentFolder;
        const tab = $inboxTab;
        let fetchPromise;
        if (folder === "starred") {
          fetchPromise = api.getStarredEmails(currentAccountId);
        } else if (folder === "sent") {
          fetchPromise = api.getSentEmails(currentAccountId);
        } else if (folder === "trash") {
          fetchPromise = api.getTrashedEmails(currentAccountId);
        } else if (folder === "archive") {
          fetchPromise = api.getArchivedEmails(currentAccountId);
        } else if (folder === "snoozed") {
          fetchPromise = api.getSnoozedEmails(currentAccountId);
        } else if (folder === "reminders") {
          fetchPromise = api.getReminderEmails(currentAccountId);
        } else if (folder === "inbox") {
          // Use split inbox tabs
          if (tab === "important") {
            fetchPromise = api.getImportantEmails(currentAccountId);
          } else if (tab === "other") {
            fetchPromise = api.getOtherEmails(currentAccountId);
          } else {
            fetchPromise = api.getEmails(currentAccountId);
          }
        } else {
          fetchPromise = api.getEmails(currentAccountId);
        }

        fetchPromise.then(msgs => {
          const currentSelectedId = $selectedEmailId;
          emails.set(msgs);

          // Preserve selection if still valid
          if (currentSelectedId) {
            const stillExists = msgs.find(e => e.id === currentSelectedId);
            if (!stillExists && msgs.length > 0) {
              selectedEmailId.set(msgs[0].id);
              selectedIndex.set(0);
            }
          }

          // Show toast for new mail
          if (data.type === "new_mail") {
            showToast("New mail received", "success");
          }
        }).catch(console.error);
      }
    }
  }

  function handleError(err: unknown) {
    console.error(err);
    if (err instanceof AuthError && err.needsReauth) {
      needsReauth = true;
      errorMessage = err.message;
    } else if (err instanceof Error) {
      errorMessage = err.message;
    }
  }

  async function loadEmails(accountId: string, emailIdFromUrl?: string | null, folder?: "inbox" | "starred" | "sent" | "drafts" | "trash" | "archive" | "snoozed" | "reminders" | "scheduled" | "label") {
    isLoading.set(true);
    // Reset pagination state when loading fresh
    emailOffset.set(0);
    hasMoreEmails.set(true);

    try {
      const targetFolder = folder ?? $currentFolder;

      // Handle drafts folder specially
      if (targetFolder === "drafts") {
        await loadDrafts(accountId);
        return;
      }

      // Handle scheduled folder specially
      if (targetFolder === "scheduled") {
        await loadScheduledEmails(accountId);
        return;
      }

      let msgs: Awaited<ReturnType<typeof api.getEmails>> = [];
      if (targetFolder === "starred") {
        msgs = await api.getStarredEmails(accountId, PAGE_SIZE, 0);
      } else if (targetFolder === "sent") {
        // Sync sent emails first, then load them
        await api.syncSentEmails(accountId);
        msgs = await api.getSentEmails(accountId, PAGE_SIZE, 0);
      } else if (targetFolder === "trash") {
        msgs = await api.getTrashedEmails(accountId, PAGE_SIZE, 0);
      } else if (targetFolder === "archive") {
        msgs = await api.getArchivedEmails(accountId, PAGE_SIZE, 0);
      } else if (targetFolder === "snoozed") {
        msgs = await api.getSnoozedEmails(accountId, PAGE_SIZE, 0);
      } else if (targetFolder === "reminders") {
        msgs = await api.getReminderEmails(accountId, PAGE_SIZE, 0);
      } else if (targetFolder === "label") {
        // Load emails for the selected label
        const labelId = $selectedLabelId;
        if (labelId) {
          msgs = await api.getEmailsForLabel(labelId, PAGE_SIZE, 0);
        } else {
          msgs = [];
        }
      } else {
        // Inbox view - use split inbox tabs
        const tab = $inboxTab;
        if (tab === "important") {
          msgs = await api.getImportantEmails(accountId, PAGE_SIZE, 0);
        } else if (tab === "other") {
          msgs = await api.getOtherEmails(accountId, PAGE_SIZE, 0);
        } else {
          // "all" tab shows all inbox emails
          msgs = await api.getEmails(accountId, PAGE_SIZE, 0);
        }
      }
      emails.set(msgs);

      // Update pagination state
      emailOffset.set(msgs.length);
      hasMoreEmails.set(msgs.length >= PAGE_SIZE);

      if (msgs.length > 0) {
        // If email ID from URL, restore that selection
        if (emailIdFromUrl) {
          const emailIndex = msgs.findIndex(e => e.id === emailIdFromUrl);
          if (emailIndex !== -1) {
            selectedEmailId.set(emailIdFromUrl);
            selectedIndex.set(emailIndex);
            view.set("email");
            return;
          }
        }
        // Default to first email selected but stay in inbox
        selectedEmailId.set(msgs[0].id);
        selectedIndex.set(0);
      } else {
        selectedEmailId.set(null);
        selectedIndex.set(0);
      }
    } catch (err) {
      handleError(err);
    } finally {
      isLoading.set(false);
    }
  }

  async function loadDrafts(accountId: string) {
    try {
      const draftsList = await api.getDrafts(accountId);
      drafts.set(draftsList);
      // Clear email selection since we're viewing drafts
      emails.set([]);
      selectedEmailId.set(null);
      selectedIndex.set(0);
    } catch (err) {
      handleError(err);
    } finally {
      isLoading.set(false);
    }
  }

  async function loadScheduledEmails(accountId: string) {
    try {
      await scheduledEmailActions.loadScheduledEmails(accountId);
      // Clear email selection since we're viewing scheduled
      emails.set([]);
      selectedEmailId.set(null);
      selectedIndex.set(0);
    } catch (err) {
      handleError(err);
    } finally {
      isLoading.set(false);
    }
  }

  function openDraft(draft: Draft) {
    selectedDraft = draft;
    composeMode.set((draft.reply_mode as "new" | "reply" | "replyAll" | "forward") || "new");
    view.set("compose");
  }

  async function syncEmails() {
    const accountId = $selectedAccountId;
    if (!accountId) return;

    isLoading.set(true);
    errorMessage = "";
    try {
      await api.syncEmails(accountId);
      await loadEmails(accountId);
      showToast("Sync complete", "success");
    } catch (err) {
      handleError(err);
    } finally {
      isLoading.set(false);
    }
  }

  async function loadMoreEmails() {
    const accountId = $selectedAccountId;
    if (!accountId || $isLoadingMore || !$hasMoreEmails) return;

    isLoadingMore.set(true);
    const currentOffset = $emailOffset;

    try {
      const targetFolder = $currentFolder;
      let moreMsgs: Awaited<ReturnType<typeof api.getEmails>> = [];

      if (targetFolder === "starred") {
        moreMsgs = await api.getStarredEmails(accountId, PAGE_SIZE, currentOffset);
      } else if (targetFolder === "sent") {
        moreMsgs = await api.getSentEmails(accountId, PAGE_SIZE, currentOffset);
      } else if (targetFolder === "trash") {
        moreMsgs = await api.getTrashedEmails(accountId, PAGE_SIZE, currentOffset);
      } else if (targetFolder === "archive") {
        moreMsgs = await api.getArchivedEmails(accountId, PAGE_SIZE, currentOffset);
      } else if (targetFolder === "snoozed") {
        moreMsgs = await api.getSnoozedEmails(accountId, PAGE_SIZE, currentOffset);
      } else if (targetFolder === "reminders") {
        moreMsgs = await api.getReminderEmails(accountId, PAGE_SIZE, currentOffset);
      } else if (targetFolder === "label") {
        const labelId = $selectedLabelId;
        if (labelId) {
          moreMsgs = await api.getEmailsForLabel(labelId, PAGE_SIZE, currentOffset);
        }
      } else {
        // Inbox view - use split inbox tabs
        const tab = $inboxTab;
        if (tab === "important") {
          moreMsgs = await api.getImportantEmails(accountId, PAGE_SIZE, currentOffset);
        } else if (tab === "other") {
          moreMsgs = await api.getOtherEmails(accountId, PAGE_SIZE, currentOffset);
        } else {
          moreMsgs = await api.getEmails(accountId, PAGE_SIZE, currentOffset);
        }
      }

      // Append to existing emails
      emails.update(($emails) => [...$emails, ...moreMsgs]);

      // Update pagination state
      emailOffset.set(currentOffset + moreMsgs.length);
      hasMoreEmails.set(moreMsgs.length >= PAGE_SIZE);
    } catch (err) {
      handleError(err);
    } finally {
      isLoadingMore.set(false);
    }
  }

  function handleLogin() {
    window.location.href = api.getLoginUrl();
  }

  function dismissError() {
    errorMessage = "";
    needsReauth = false;
  }
</script>

<div class="app">
  <Sidebar onSync={syncEmails} onAddAccount={() => (showAddAccountModal = true)} onManageLabels={() => (showLabelManager = true)} onManageSnippets={() => (showSnippetManager = true)} />

  <main class="main">
    {#if needsReauth}
      <div class="auth-banner">
        <span>Session expired. Please re-authenticate to continue.</span>
        <button class="primary" onclick={handleLogin}>Re-authenticate</button>
        <button class="dismiss" onclick={dismissError}>✕</button>
      </div>
    {:else if errorMessage}
      <div class="error-banner">
        <span>{errorMessage}</span>
        <button class="dismiss" onclick={dismissError}>✕</button>
      </div>
    {/if}

    <SearchBar />

    {#if $accounts.length === 0}
      <div class="empty-state">
        <h2>Welcome to Hamba</h2>
        <p>Connect your email account to get started</p>
        <button class="primary" onclick={() => (showAddAccountModal = true)}>
          Add Email Account
        </button>
      </div>
    {:else if $view === "inbox"}
      {#if $currentFolder === "drafts"}
        <DraftList loading={$isLoading} onOpenDraft={openDraft} />
      {:else if $currentFolder === "scheduled"}
        <ScheduledList loading={$isLoading} />
      {:else}
        {#if $currentFolder === "inbox"}
          <InboxTabs />
        {/if}
        <EmailList loading={$isLoading} onLoadMore={loadMoreEmails} folder={$currentFolder} inboxTab={$inboxTab} />
      {/if}
    {:else if $view === "email"}
      <ThreadView />
    {:else if $view === "compose"}
      <Compose replyTo={$replyToEmail} mode={$composeMode} draft={selectedDraft} />
    {/if}
  </main>

  {#if $isCommandPaletteOpen}
    <CommandPalette />
  {/if}

  {#if showAddAccountModal}
    <AddAccountModal onClose={() => (showAddAccountModal = false)} />
  {/if}

  {#if showLabelManager}
    <LabelManager onClose={() => (showLabelManager = false)} />
  {/if}

  {#if showSnippetManager}
    <SnippetManager onClose={() => (showSnippetManager = false)} />
  {/if}

  {#if $isSnoozeModalOpen && $selectedEmailId}
    <SnoozeModal emailId={$selectedEmailId} onClose={() => isSnoozeModalOpen.set(false)} />
  {/if}

  {#if $isReminderModalOpen && $selectedEmailId}
    <ReminderModal emailId={$selectedEmailId} onClose={() => isReminderModalOpen.set(false)} />
  {/if}

  {#if $isShortcutOverlayOpen}
    <KeyboardShortcutOverlay onClose={() => isShortcutOverlayOpen.set(false)} />
  {/if}

  <Toasts />
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-secondary);
  }

  .empty-state h2 {
    color: var(--text-primary);
    font-weight: 600;
  }

  .empty-state p {
    margin-bottom: 8px;
  }

  .auth-banner,
  .error-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    font-size: 13px;
  }

  .auth-banner {
    background: var(--accent);
    color: white;
  }

  .error-banner {
    background: var(--danger);
    color: white;
  }

  .auth-banner span,
  .error-banner span {
    flex: 1;
  }

  .auth-banner .primary {
    background: white;
    color: var(--accent);
    border-color: white;
  }

  .dismiss {
    background: transparent;
    border: none;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    padding: 4px;
  }

  .dismiss:hover {
    opacity: 1;
  }
</style>
