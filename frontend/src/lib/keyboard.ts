import { get } from "svelte/store";
import {
  emails,
  selectedIndex,
  selectedEmailId,
  view,
  isCommandPaletteOpen,
  isSnoozeModalOpen,
  isReminderModalOpen,
  isShortcutOverlayOpen,
  isSettingsOpen,
  composeMode,
  replyToEmail,
  emailActions,
  prefetchAdjacentEmails,
  currentFolder,
  accounts,
  selectedAccountId,
  selectedEmailIds,
  selectionActions,
  bulkEmailActions,
} from "./stores";
import {
  type ShortcutAction,
  loadCustomBindings,
  buildKeyMaps,
} from "./keyboardShortcuts";

// Sync callback - registered by the main page
let syncCallback: (() => void) | null = null;

export function registerSyncCallback(callback: () => void) {
  syncCallback = callback;
}

// For two-key sequences like "gi" (go to inbox)
let pendingKey: string | null = null;
let pendingKeyTimeout: ReturnType<typeof setTimeout> | null = null;

function clearPendingKey() {
  pendingKey = null;
  if (pendingKeyTimeout) {
    clearTimeout(pendingKeyTimeout);
    pendingKeyTimeout = null;
  }
}

// Update URL with email ID for state persistence
function updateUrlWithEmail(emailId: string | null) {
  const url = new URL(window.location.href);
  if (emailId) {
    url.searchParams.set("email", emailId);
  } else {
    url.searchParams.delete("email");
  }
  window.history.pushState({}, "", url);
}

// Scroll email content (for spacebar scrolling)
function scrollEmailContent(amount: number) {
  const contentEl = document.querySelector('.email-view .content');
  if (contentEl) {
    contentEl.scrollBy({ top: amount, behavior: 'smooth' });
  }
}

// Select next email after archive/trash (email already removed by optimistic action)
function selectNextEmail() {
  const $emails = get(emails);
  const $index = get(selectedIndex);

  if ($emails.length > 0) {
    const newIndex = Math.min($index, $emails.length - 1);
    selectedIndex.set(newIndex);
    selectedEmailId.set($emails[newIndex].id);
  } else {
    selectedEmailId.set(null);
  }

  view.set("inbox");
  updateUrlWithEmail(null);
}

// Action handlers - map ShortcutAction to actual functions
const actionHandlers: Record<ShortcutAction, () => void | Promise<void>> = {
  // Navigation
  navigate_down: () => {
    const $emails = get(emails);
    const $index = get(selectedIndex);
    const $view = get(view);
    if ($index < $emails.length - 1) {
      const newIndex = $index + 1;
      const newEmailId = $emails[newIndex].id;
      selectedIndex.set(newIndex);
      selectedEmailId.set(newEmailId);
      if ($view === "email") {
        updateUrlWithEmail(newEmailId);
        emailActions.markRead(newEmailId);
      }
      prefetchAdjacentEmails(newIndex);
    }
  },

  navigate_up: () => {
    const $index = get(selectedIndex);
    const $view = get(view);
    if ($index > 0) {
      const newIndex = $index - 1;
      const $emails = get(emails);
      const newEmailId = $emails[newIndex].id;
      selectedIndex.set(newIndex);
      selectedEmailId.set(newEmailId);
      if ($view === "email") {
        updateUrlWithEmail(newEmailId);
        emailActions.markRead(newEmailId);
      }
      prefetchAdjacentEmails(newIndex);
    }
  },

  open_email: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      view.set("email");
      emailActions.markRead($selectedEmailId);
      updateUrlWithEmail($selectedEmailId);
    }
  },

  back_to_list: () => {
    const $view = get(view);
    const $isCommandPaletteOpen = get(isCommandPaletteOpen);
    const $selectedEmailIds = get(selectedEmailIds);

    if ($isCommandPaletteOpen) {
      isCommandPaletteOpen.set(false);
    } else if ($selectedEmailIds.size > 0) {
      // Clear multi-selection first
      selectionActions.clearSelection();
    } else if ($view === "email") {
      view.set("inbox");
      updateUrlWithEmail(null);
    }
  },

  scroll_down: () => {
    const $view = get(view);
    if ($view === "email") {
      scrollEmailContent(window.innerHeight * 0.95);
    }
  },

  scroll_up: () => {
    const $view = get(view);
    if ($view === "email") {
      scrollEmailContent(window.innerHeight * -0.95);
    }
  },

  go_to_top: () => {
    selectedIndex.set(0);
    const $emails = get(emails);
    if ($emails.length > 0) {
      selectedEmailId.set($emails[0].id);
    }
  },

  go_to_bottom: () => {
    const $emails = get(emails);
    if ($emails.length > 0) {
      selectedIndex.set($emails.length - 1);
      selectedEmailId.set($emails[$emails.length - 1].id);
    }
  },

  // Go to folder
  go_inbox: () => {
    currentFolder.set("inbox");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_starred: () => {
    currentFolder.set("starred");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_sent: () => {
    currentFolder.set("sent");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_drafts: () => {
    currentFolder.set("drafts");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_trash: () => {
    currentFolder.set("trash");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_archive: () => {
    currentFolder.set("archive");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_snoozed: () => {
    currentFolder.set("snoozed");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_reminders: () => {
    currentFolder.set("reminders");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  go_scheduled: () => {
    currentFolder.set("scheduled");
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  // Email actions
  archive: () => {
    const $selectedEmailIds = get(selectedEmailIds);
    if ($selectedEmailIds.size > 0) {
      // Bulk action for multi-select
      bulkEmailActions.archive(Array.from($selectedEmailIds));
      selectNextEmail();
    } else {
      const $selectedEmailId = get(selectedEmailId);
      if ($selectedEmailId) {
        emailActions.archive($selectedEmailId);
        selectNextEmail();
      }
    }
  },

  archive_alt: () => {
    actionHandlers.archive();
  },

  trash: () => {
    const $selectedEmailIds = get(selectedEmailIds);
    if ($selectedEmailIds.size > 0) {
      // Bulk action for multi-select
      bulkEmailActions.trash(Array.from($selectedEmailIds));
      selectNextEmail();
    } else {
      const $selectedEmailId = get(selectedEmailId);
      if ($selectedEmailId) {
        emailActions.trash($selectedEmailId);
        selectNextEmail();
      }
    }
  },

  trash_backspace: () => {
    actionHandlers.trash();
  },

  trash_delete: () => {
    actionHandlers.trash();
  },

  toggle_star: () => {
    const $selectedEmailIds = get(selectedEmailIds);
    if ($selectedEmailIds.size > 0) {
      // Check if all selected are starred to determine action
      const $emails = get(emails);
      const selected = $emails.filter((e) => $selectedEmailIds.has(e.id));
      const allStarred = selected.every((e) => e.is_starred);
      if (allStarred) {
        bulkEmailActions.unstar(Array.from($selectedEmailIds));
      } else {
        bulkEmailActions.star(Array.from($selectedEmailIds));
      }
    } else {
      const $selectedEmailId = get(selectedEmailId);
      if ($selectedEmailId) {
        emailActions.toggleStar($selectedEmailId);
      }
    }
  },

  toggle_read: () => {
    const $selectedEmailIds = get(selectedEmailIds);
    if ($selectedEmailIds.size > 0) {
      // Check if all selected are read to determine action
      const $emails = get(emails);
      const selected = $emails.filter((e) => $selectedEmailIds.has(e.id));
      const allRead = selected.every((e) => e.is_read);
      if (allRead) {
        bulkEmailActions.markUnread(Array.from($selectedEmailIds));
      } else {
        bulkEmailActions.markRead(Array.from($selectedEmailIds));
      }
    } else {
      const $selectedEmailId = get(selectedEmailId);
      if ($selectedEmailId) {
        emailActions.toggleRead($selectedEmailId);
      }
    }
  },

  snooze: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      isSnoozeModalOpen.set(true);
    }
  },

  set_reminder: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      isReminderModalOpen.set(true);
    }
  },

  // Selection
  toggle_select: () => {
    const $selectedEmailId = get(selectedEmailId);
    const $selectedIndex = get(selectedIndex);
    if ($selectedEmailId) {
      selectionActions.toggleSelection($selectedEmailId, $selectedIndex);
    }
  },

  select_all: () => {
    selectionActions.selectAll();
  },

  // Compose
  compose_new: () => {
    composeMode.set("new");
    replyToEmail.set(null);
    view.set("compose");
  },

  reply: () => {
    const $selectedEmailId = get(selectedEmailId);
    if (!$selectedEmailId) return;

    const $emails = get(emails);
    const email = $emails.find((e) => e.id === $selectedEmailId);
    if (email) {
      composeMode.set("reply");
      replyToEmail.set(email);
      view.set("compose");
    }
  },

  reply_all: () => {
    const $selectedEmailId = get(selectedEmailId);
    if (!$selectedEmailId) return;

    const $emails = get(emails);
    const email = $emails.find((e) => e.id === $selectedEmailId);
    if (email) {
      composeMode.set("replyAll");
      replyToEmail.set(email);
      view.set("compose");
    }
  },

  forward: () => {
    const $selectedEmailId = get(selectedEmailId);
    if (!$selectedEmailId) return;

    const $emails = get(emails);
    const email = $emails.find((e) => e.id === $selectedEmailId);
    if (email) {
      composeMode.set("forward");
      replyToEmail.set(email);
      view.set("compose");
    }
  },

  // Account switching
  switch_account_1: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 0) {
      selectedAccountId.set($accounts[0].id);
    }
  },

  switch_account_2: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 1) {
      selectedAccountId.set($accounts[1].id);
    }
  },

  switch_account_3: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 2) {
      selectedAccountId.set($accounts[2].id);
    }
  },

  switch_account_4: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 3) {
      selectedAccountId.set($accounts[3].id);
    }
  },

  switch_account_5: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 4) {
      selectedAccountId.set($accounts[4].id);
    }
  },

  switch_account_6: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 5) {
      selectedAccountId.set($accounts[5].id);
    }
  },

  switch_account_7: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 6) {
      selectedAccountId.set($accounts[6].id);
    }
  },

  switch_account_8: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 7) {
      selectedAccountId.set($accounts[7].id);
    }
  },

  switch_account_9: () => {
    const $accounts = get(accounts);
    if ($accounts.length > 8) {
      selectedAccountId.set($accounts[8].id);
    }
  },

  // Other
  command_palette: () => {
    isCommandPaletteOpen.update((v) => !v);
  },

  settings: () => {
    isSettingsOpen.update((v) => !v);
  },

  search: () => {
    // Will be handled by the search component
  },

  show_shortcuts: () => {
    isShortcutOverlayOpen.update((v) => !v);
  },

  sync: () => {
    if (syncCallback) {
      syncCallback();
    }
  },
};

// Cache for key maps (rebuilt when shortcuts change)
let keyMapsCache: ReturnType<typeof buildKeyMaps> | null = null;

// Rebuild the key maps (call this when shortcuts are updated)
export function refreshKeyMaps() {
  keyMapsCache = buildKeyMaps();
}

// Get current key maps (lazy initialization)
function getKeyMaps() {
  if (!keyMapsCache) {
    keyMapsCache = buildKeyMaps();
  }
  return keyMapsCache;
}

export function handleKeydown(event: KeyboardEvent) {
  // Ignore if typing in input
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    if (event.key === "Escape") {
      (event.target as HTMLElement).blur();
    }
    return;
  }

  // Build key string
  let key = event.key;

  // For shift+letter combinations (like Shift+R for refresh), add prefix
  // But NOT for symbols produced by shift (like # from Shift+3)
  const isLetter = /^[a-zA-Z]$/.test(key);
  if (event.shiftKey && isLetter) {
    key = `Shift+${key.toLowerCase()}`;
  }
  if (event.metaKey || event.ctrlKey) {
    key = `Cmd+${key.toLowerCase()}`;
  }

  const { handlers, sequences } = getKeyMaps();

  // Check for two-key sequences (e.g., "gi" for go to inbox)
  if (pendingKey) {
    const sequence = pendingKey + key;
    clearPendingKey();

    const action = sequences[sequence];
    if (action) {
      event.preventDefault();
      actionHandlers[action]();
      return;
    }
    // No sequence matched, try the pending key's handler then current key
    const pendingAction = handlers[pendingKey];
    if (pendingAction) {
      actionHandlers[pendingAction]();
    }
  }

  // Check if this key starts a sequence
  const startsSequence = Object.keys(sequences).some(seq => seq.startsWith(key));
  if (startsSequence && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    pendingKey = key;
    // Clear pending key after 500ms if no follow-up
    pendingKeyTimeout = setTimeout(() => {
      if (pendingKey) {
        const action = handlers[pendingKey];
        if (action) actionHandlers[action]();
        clearPendingKey();
      }
    }, 500);
    return;
  }

  const action = handlers[key];
  if (action) {
    event.preventDefault();
    actionHandlers[action]();
  }
}

export function initKeyboardNavigation() {
  if (typeof window !== "undefined") {
    // Load custom bindings from localStorage
    loadCustomBindings();
    // Build initial key maps
    refreshKeyMaps();

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }
}
