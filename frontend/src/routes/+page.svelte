<script lang="ts">
  import { X } from "@lucide/svelte";
  import { onMount, onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import { api, AuthError } from "$lib/api";
  import { registerSyncCallback } from "$lib/keyboard";
  import { connect, disconnect, onMessage, subscribe } from "$lib/realtime";
  import { showNewMailNotification } from "$lib/notifications";
  import {
    listKey,
    getSnapshot,
    setSnapshot,
    updateSnapshot,
    hasSnapshot,
    writeFirstPage,
  } from "$lib/listCache";
  import {
    accounts,
    selectedAccountId,
    emails,
    selectedEmailId,
    selectedIndex,
    isLoading,
    view,
    isCommandPaletteOpen,
    isAccountSwitcherOpen,
    isSnoozeModalOpen,
    isReminderModalOpen,
    isLabelPickerOpen,
    isShortcutOverlayOpen,
    isSettingsOpen,
    composeMode,
    replyToEmail,
    toasts,
    showToast,
    currentFolder,
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
    selectionActions,
    mergeEmails,
    accountActions,
  } from "$lib/stores";
  import type { Draft, Email } from "$lib/api";
  import type { Folder } from "$lib/stores";
  import EmailList from "$lib/components/EmailList.svelte";
  import ThreadView from "$lib/components/ThreadView.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import AccountSwitcher from "$lib/components/AccountSwitcher.svelte";
  import SearchBar from "$lib/components/SearchBar.svelte";
  import Compose from "$lib/components/Compose.svelte";
  import AddAccountModal from "$lib/components/AddAccountModal.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import DraftList from "$lib/components/DraftList.svelte";
  import LabelManager from "$lib/components/LabelManager.svelte";
  import SnippetManager from "$lib/components/SnippetManager.svelte";
  import SnoozeModal from "$lib/components/SnoozeModal.svelte";
  import ReminderModal from "$lib/components/ReminderModal.svelte";
  import LabelPicker from "$lib/components/LabelPicker.svelte";
  import ScheduledList from "$lib/components/ScheduledList.svelte";
  import KeyboardShortcutOverlay from "$lib/components/KeyboardShortcutOverlay.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import BulkActionToolbar from "$lib/components/BulkActionToolbar.svelte";

  let needsReauth = $state(false);
  let errorMessage = $state("");
  let showAddAccountModal = $state(false);
  let showLabelManager = $state(false);
  let showSnippetManager = $state(false);
  let autoSyncInterval: ReturnType<typeof setInterval> | null = null;
  let lastLoadedAccountId: string | null = null;
  let unsubscribeRealtime: (() => void) | null = null;
  let selectedDraft = $state<Draft | null>(null);
  let currentSyncFrequency = 60; // Default sync frequency in seconds

  // Pagination constants
  const PAGE_SIZE = 50;

  let lastLoadedFolder: string | null = null;
  let emailList = $state<{ getScrollTop: () => number; setScrollTop: (top: number) => void } | undefined>(undefined);

  // Load emails when selected account changes (but not on initial mount)
  $effect(() => {
    const accountId = $selectedAccountId;
    if (accountId && lastLoadedAccountId !== null && accountId !== lastLoadedAccountId) {
      saveDisplayedSnapshot();
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

      // Update sync interval for the new account
      const account = $accounts.find(a => a.id === accountId);
      if (account) {
        const newFrequency = account.sync_frequency_seconds ?? 60;
        if (newFrequency !== currentSyncFrequency) {
          currentSyncFrequency = newFrequency;
          if (autoSyncInterval) {
            clearInterval(autoSyncInterval);
          }
          autoSyncInterval = setInterval(syncEmails, currentSyncFrequency * 1000);
        }
      }
    }
  });

  // Update sync interval when accounts are updated (e.g., settings changed)
  $effect(() => {
    const accts = $accounts;
    const accountId = $selectedAccountId;
    if (accountId && accts.length > 0) {
      const account = accts.find(a => a.id === accountId);
      if (account) {
        const newFrequency = account.sync_frequency_seconds ?? 60;
        if (newFrequency !== currentSyncFrequency && autoSyncInterval) {
          currentSyncFrequency = newFrequency;
          clearInterval(autoSyncInterval);
          autoSyncInterval = setInterval(syncEmails, currentSyncFrequency * 1000);
        }
      }
    }
  });

  // Load emails when folder changes
  $effect(() => {
    const folder = $currentFolder;
    const accountId = $selectedAccountId;
    if (accountId && lastLoadedFolder !== null && folder !== lastLoadedFolder) {
      saveDisplayedSnapshot();
      lastLoadedFolder = folder;
      view.set("inbox");
      selectionActions.clearSelection(); // Clear multi-select on folder change
      loadEmails(accountId, null, folder);
    }
  });

  // Clear selection when account changes
  $effect(() => {
    const accountId = $selectedAccountId;
    if (accountId && lastLoadedAccountId !== null && accountId !== lastLoadedAccountId) {
      selectionActions.clearSelection();
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

        // Subscribe to real-time updates for all accounts
        accts.forEach(acct => subscribe(acct.id));

        // Load labels, snippets, drafts, sent and emails with URL param to restore view state
        await labelActions.loadLabels(firstAccountId);
        await snippetActions.loadSnippets(firstAccountId);
        // Load drafts and sent in background for instant folder switching
        api.getDrafts(firstAccountId).then(d => drafts.set(d)).catch(() => {});
        api.getSentEmails(firstAccountId).then(s => writeListCache(listKey(firstAccountId, "sent"), s)).catch(() => {});
        await loadEmails(firstAccountId, emailIdFromUrl);
        idle(prefetchOtherAccounts);
        accountActions.refreshUnreadCounts();

        // Start auto-sync as fallback (for Gmail without push)
        // Use the account's configured sync frequency
        currentSyncFrequency = accts[0].sync_frequency_seconds ?? 60;
        autoSyncInterval = setInterval(syncEmails, currentSyncFrequency * 1000);
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
    if (unreadRefreshTimer) {
      clearTimeout(unreadRefreshTimer);
      unreadRefreshTimer = null;
    }
    disconnect();
  });

  // Sync sent folder from the provider and refresh the cache (and the list if still viewing it)
  function refreshSentEmails(accountId: string) {
    api.syncSentEmails(accountId)
      .catch(() => {})
      .then(() => api.getSentEmails(accountId, PAGE_SIZE, 0))
      .then(msgs => {
        writeListCache(listKey(accountId, "sent"), msgs);
        if ($currentFolder === "sent" && $selectedAccountId === accountId) {
          mergeEmails(msgs);
        }
      })
      .catch(() => {});
  }

  // Badge counts are refreshed after bursts of realtime events
  let unreadRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleUnreadRefresh() {
    if (unreadRefreshTimer) clearTimeout(unreadRefreshTimer);
    unreadRefreshTimer = setTimeout(() => {
      unreadRefreshTimer = null;
      accountActions.refreshUnreadCounts();
    }, 500);
  }

  // Run low-priority work when the browser is idle
  function idle(callback: () => void) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => callback());
    } else {
      setTimeout(callback, 300);
    }
  }

  // Warm the inbox cache of every other account so switching to it shows a list instantly
  function prefetchOtherAccounts() {
    const others = $accounts.filter((a) => a.id !== $selectedAccountId);
    others.forEach((acct, i) => {
      setTimeout(() => {
        const key = listKey(acct.id, "inbox");
        if (hasSnapshot(key)) return;
        api.getEmails(acct.id, PAGE_SIZE, 0)
          .then((msgs) => {
            if (!hasSnapshot(key)) writeListCache(key, msgs);
          })
          .catch(() => {});
      }, i * 100);
    });
  }

  // Handle real-time WebSocket messages
  function handleRealtimeMessage(data: any) {
    if (data.type === "send_failed") {
      showToast(`Couldn't send "${data.subject}": ${data.error}. Saved to Drafts.`, "error", { duration: 10000 });
      if (data.accountId === $selectedAccountId) {
        api.getDrafts(data.accountId).then(d => drafts.set(d)).catch(() => {});
      }
      return;
    }
    if (data.type === "new_mail" || data.type === "sync_complete") {
      scheduleUnreadRefresh();
      const currentAccountId = $selectedAccountId;
      if (currentAccountId && data.accountId === currentAccountId) {
        // Silently refresh emails without showing loading state
        const folder = $currentFolder;
        // Drafts, scheduled and label views aren't backed by the inbox-style list endpoints
        if (folder === "drafts" || folder === "scheduled" || folder === "label") return;
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
        } else {
          fetchPromise = api.getEmails(currentAccountId);
        }

        fetchPromise.then(msgs => {
          // Ignore stale responses if the user switched account/folder meanwhile
          if ($selectedAccountId !== currentAccountId || $currentFolder !== folder) return;
          const currentSelectedId = $selectedEmailId;

          // Use seamless merge instead of full replacement to avoid jarring UI reload
          const { added, updated, removed } = mergeEmails(msgs);

          // Preserve selection if still valid
          if (currentSelectedId) {
            const stillExists = msgs.find(e => e.id === currentSelectedId);
            if (!stillExists && msgs.length > 0) {
              selectedEmailId.set(msgs[0].id);
              selectedIndex.set(0);
            }
          }

          // Keep the cached list in step with what is on screen
          saveDisplayedSnapshot();

          // Show toast and desktop notification for new mail
          if (data.type === "new_mail" && added > 0) {
            showToast(`${added} new email${added > 1 ? 's' : ''} received`, "success");

            // Show desktop notification if enabled
            if (data.email) {
              showNewMailNotification({
                from: data.email.from,
                subject: data.email.subject,
                isImportant: data.email.isImportant,
              });
            }
          }
        }).catch(console.error);
      } else if (data.accountId) {
        // Another account: refresh its cached inbox and still notify about new mail
        api.getEmails(data.accountId, PAGE_SIZE, 0)
          .then(msgs => writeListCache(listKey(data.accountId, "inbox"), msgs))
          .catch(() => {});
        if (data.type === "new_mail" && data.email) {
          showNewMailNotification({
            from: data.email.from,
            subject: data.email.subject,
            isImportant: data.email.isImportant,
          });
        }
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

  let loadToken = 0;

  // Key of the list currently held in the `emails` store (null when it is not a cacheable list)
  let displayedKey: string | null = null;

  function currentKey(): string {
    return listKey($selectedAccountId ?? "", $currentFolder, get(selectedLabelId));
  }

  // Store the live list state (selection, pagination) for the list currently shown
  function saveDisplayedSnapshot() {
    if (!displayedKey) return;
    // Keep the last known scroll offset when the list is not mounted (e.g. while viewing an email)
    const scrollTop = emailList?.getScrollTop();
    const patch = {
      emails: get(emails),
      offset: get(emailOffset),
      hasMore: get(hasMoreEmails),
      selectedEmailId: get(selectedEmailId),
      selectedIndex: get(selectedIndex),
      ...(scrollTop !== undefined ? { scrollTop } : {}),
    };
    if (hasSnapshot(displayedKey)) {
      updateSnapshot(displayedKey, patch);
    } else {
      setSnapshot(displayedKey, { scrollTop: 0, fetchedAt: Date.now(), ...patch });
    }
  }

  function writeListCache(key: string, msgs: Email[]) {
    writeFirstPage(key, msgs, PAGE_SIZE);
  }

  // Fetch one page of the list for a folder
  function fetchPage(accountId: string, folder: Folder, offset: number): Promise<Email[]> {
    switch (folder) {
      case "starred":
        return api.getStarredEmails(accountId, PAGE_SIZE, offset);
      case "sent":
        return api.getSentEmails(accountId, PAGE_SIZE, offset);
      case "trash":
        return api.getTrashedEmails(accountId, PAGE_SIZE, offset);
      case "archive":
        return api.getArchivedEmails(accountId, PAGE_SIZE, offset);
      case "snoozed":
        return api.getSnoozedEmails(accountId, PAGE_SIZE, offset);
      case "reminders":
        return api.getReminderEmails(accountId, PAGE_SIZE, offset);
      case "label": {
        const labelId = get(selectedLabelId);
        return labelId ? api.getEmailsForLabel(labelId, PAGE_SIZE, offset) : Promise.resolve([]);
      }
      default:
        return api.getEmails(accountId, PAGE_SIZE, offset);
    }
  }

  // Background refresh of a list that was shown from cache. Results for a list the user
  // has already left only update its snapshot; errors keep showing the cached list.
  async function revalidate(accountId: string, folder: Folder, key: string, token: number) {
    if (folder === "sent") {
      refreshSentEmails(accountId);
      return;
    }
    try {
      const msgs = await fetchPage(accountId, folder, 0);
      if (token !== loadToken || currentKey() !== key) {
        writeListCache(key, msgs);
        return;
      }

      // mergeEmails only sets the store when something changed, so re-read it afterwards
      mergeEmails(msgs);
      const list = get(emails);
      // mergeEmails replaces the list with this first page (later pages are dropped), so the
      // pagination offset must restart from it or the next loadMore would skip emails
      emailOffset.set(list.length);
      hasMoreEmails.set(msgs.length >= PAGE_SIZE);
      const selectedPos = list.findIndex((e) => e.id === get(selectedEmailId));
      if (selectedPos !== -1) {
        selectedIndex.set(selectedPos);
      } else if (list.length > 0) {
        selectedEmailId.set(list[0].id);
        selectedIndex.set(0);
      } else {
        selectedEmailId.set(null);
        selectedIndex.set(0);
      }
      updateSnapshot(key, {
        emails: list,
        offset: get(emailOffset),
        hasMore: get(hasMoreEmails),
        selectedEmailId: get(selectedEmailId),
        selectedIndex: get(selectedIndex),
        fetchedAt: Date.now(),
      });
    } catch {
      // Silent: the cached list stays on screen
    }
  }

  async function loadEmails(accountId: string, emailIdFromUrl?: string | null, folder?: Folder, keepSelection = false) {
    const token = ++loadToken;
    const targetFolder = folder ?? $currentFolder;
    const key = listKey(accountId, targetFolder, get(selectedLabelId));

    // Cache-first: show the last known list immediately, then revalidate in the background
    if (!emailIdFromUrl && !keepSelection && targetFolder !== "drafts" && targetFolder !== "scheduled") {
      const cached = getSnapshot(key);
      if (cached) {
        displayedKey = key;
        emails.set(cached.emails);
        emailOffset.set(cached.offset);
        hasMoreEmails.set(cached.hasMore);
        const keptIndex = cached.selectedEmailId ? cached.emails.findIndex(e => e.id === cached.selectedEmailId) : -1;
        const index = keptIndex === -1 ? 0 : keptIndex;
        selectedEmailId.set(cached.emails[index]?.id ?? null);
        selectedIndex.set(index);
        isLoading.set(false);
        tick().then(() => emailList?.setScrollTop(cached.scrollTop));
        revalidate(accountId, targetFolder, key, token);
        return;
      }
    }

    isLoading.set(true);
    // Reset pagination state when loading fresh
    emailOffset.set(0);
    hasMoreEmails.set(true);

    try {
      // Handle drafts folder specially
      if (targetFolder === "drafts") {
        await loadDrafts(accountId, token);
        return;
      }

      // Handle scheduled folder specially
      if (targetFolder === "scheduled") {
        await loadScheduledEmails(accountId, token);
        return;
      }

      const msgs = await fetchPage(accountId, targetFolder, 0);
      // A newer load (account/folder switch) superseded this one
      if (token !== loadToken) return;
      emails.set(msgs);
      displayedKey = key;
      writeListCache(key, msgs);
      if (targetFolder === "sent") refreshSentEmails(accountId);

      // Update pagination state
      emailOffset.set(msgs.length);
      hasMoreEmails.set(msgs.length >= PAGE_SIZE);

      // Background sync: keep the user's current selection if it's still in the list
      if (keepSelection && $selectedEmailId) {
        const keptIndex = msgs.findIndex(e => e.id === $selectedEmailId);
        if (keptIndex !== -1) {
          selectedIndex.set(keptIndex);
          return;
        }
      }

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
      if (token === loadToken) handleError(err);
    } finally {
      if (token === loadToken) isLoading.set(false);
    }
  }

  // `token` is the loadEmails call this belongs to; a newer load means the user moved on
  async function loadDrafts(accountId: string, token: number) {
    try {
      const draftsList = await api.getDrafts(accountId);
      if (token !== loadToken) return;
      drafts.set(draftsList);
      // Clear email selection since we're viewing drafts
      displayedKey = null;
      emails.set([]);
      selectedEmailId.set(null);
      selectedIndex.set(0);
    } catch (err) {
      if (token === loadToken) handleError(err);
    } finally {
      if (token === loadToken) isLoading.set(false);
    }
  }

  async function loadScheduledEmails(accountId: string, token: number) {
    try {
      await scheduledEmailActions.loadScheduledEmails(accountId);
      if (token !== loadToken) return;
      // Clear email selection since we're viewing scheduled
      displayedKey = null;
      emails.set([]);
      selectedEmailId.set(null);
      selectedIndex.set(0);
    } catch (err) {
      if (token === loadToken) handleError(err);
    } finally {
      if (token === loadToken) isLoading.set(false);
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
      if ($selectedAccountId !== accountId) return;
      await loadEmails(accountId, null, undefined, true);
      accountActions.refreshUnreadCounts();
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
      const moreMsgs = await fetchPage(accountId, targetFolder, currentOffset);

      // Discard if the account/folder changed while loading
      if ($selectedAccountId !== accountId || $currentFolder !== targetFolder) return;

      // Append to existing emails (skip any already present)
      emails.update(($emails) => {
        const seen = new Set($emails.map((e) => e.id));
        return [...$emails, ...moreMsgs.filter((e) => !seen.has(e.id))];
      });

      // Update pagination state
      emailOffset.set(currentOffset + moreMsgs.length);
      hasMoreEmails.set(moreMsgs.length >= PAGE_SIZE);
      if (displayedKey) {
        updateSnapshot(displayedKey, { emails: get(emails), offset: get(emailOffset), hasMore: get(hasMoreEmails) });
      }
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
        <button class="dismiss" onclick={dismissError} aria-label="Dismiss"><X size={16} /></button>
      </div>
    {:else if errorMessage}
      <div class="error-banner">
        <span>{errorMessage}</span>
        <button class="dismiss" onclick={dismissError} aria-label="Dismiss"><X size={16} /></button>
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
        <BulkActionToolbar />
        <EmailList bind:this={emailList} loading={$isLoading} onLoadMore={loadMoreEmails} folder={$currentFolder} />
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

  {#if $isAccountSwitcherOpen}
    <AccountSwitcher />
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

  {#if $isLabelPickerOpen && $selectedEmailId}
    <LabelPicker emailId={$selectedEmailId} onClose={() => isLabelPickerOpen.set(false)} />
  {/if}

  {#if $isShortcutOverlayOpen}
    <KeyboardShortcutOverlay onClose={() => isShortcutOverlayOpen.set(false)} />
  {/if}

  {#if $isSettingsOpen}
    <Settings onClose={() => isSettingsOpen.set(false)} />
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
    display: inline-flex;
    align-items: center;
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
