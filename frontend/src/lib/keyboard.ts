import { get } from "svelte/store";
import {
  emails,
  selectedIndex,
  selectedEmailId,
  view,
  isCommandPaletteOpen,
  composeMode,
  replyToEmail,
  emailActions,
  prefetchAdjacentEmails,
  currentFolder,
} from "./stores";

type KeyHandler = () => void | Promise<void>;

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

// Go to inbox view
function goToInbox() {
  currentFolder.set("inbox");
  view.set("inbox");
  updateUrlWithEmail(null);
}

// Go to starred view
function goToStarred() {
  currentFolder.set("starred");
  view.set("inbox");
  updateUrlWithEmail(null);
}

// Go to sent view
function goToSent() {
  currentFolder.set("sent");
  view.set("inbox");
  updateUrlWithEmail(null);
}

// Go to drafts view
function goToDrafts() {
  currentFolder.set("drafts");
  view.set("inbox");
  updateUrlWithEmail(null);
}

// Two-key sequence handlers (e.g., "gi" = go to inbox, "gs" = go to starred, "gt" = go to sent, "gd" = go to drafts)
const sequenceHandlers: Record<string, KeyHandler> = {
  "gi": goToInbox,
  "gs": goToStarred,
  "gt": goToSent,
  "gd": goToDrafts,
};

const handlers: Record<string, KeyHandler> = {
  // Navigation
  j: () => {
    const $emails = get(emails);
    const $index = get(selectedIndex);
    const $view = get(view);
    if ($index < $emails.length - 1) {
      const newIndex = $index + 1;
      const newEmailId = $emails[newIndex].id;
      selectedIndex.set(newIndex);
      selectedEmailId.set(newEmailId);
      // Update URL if viewing email
      if ($view === "email") {
        updateUrlWithEmail(newEmailId);
        emailActions.markRead(newEmailId);
      }
      // Prefetch adjacent emails for instant opening
      prefetchAdjacentEmails(newIndex);
    }
  },

  k: () => {
    const $index = get(selectedIndex);
    const $view = get(view);
    if ($index > 0) {
      const newIndex = $index - 1;
      const $emails = get(emails);
      const newEmailId = $emails[newIndex].id;
      selectedIndex.set(newIndex);
      selectedEmailId.set(newEmailId);
      // Update URL if viewing email
      if ($view === "email") {
        updateUrlWithEmail(newEmailId);
        emailActions.markRead(newEmailId);
      }
      // Prefetch adjacent emails
      prefetchAdjacentEmails(newIndex);
    }
  },

  // Open email
  Enter: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      view.set("email");
      emailActions.markRead($selectedEmailId);
      updateUrlWithEmail($selectedEmailId);
    }
  },

  o: () => handlers.Enter(),

  // Back to inbox
  Escape: () => {
    const $view = get(view);
    const $isCommandPaletteOpen = get(isCommandPaletteOpen);

    if ($isCommandPaletteOpen) {
      isCommandPaletteOpen.set(false);
    } else if ($view === "email") {
      view.set("inbox");
      updateUrlWithEmail(null);
    }
  },

  u: () => {
    view.set("inbox");
    updateUrlWithEmail(null);
  },

  // Scroll email content (95% of viewport)
  " ": () => {
    const $view = get(view);
    if ($view === "email") {
      scrollEmailContent(window.innerHeight * 0.95);
    }
  },

  "Shift+ ": () => {
    const $view = get(view);
    if ($view === "email") {
      scrollEmailContent(window.innerHeight * -0.95);
    }
  },

  // Email actions - all optimistic (instant UI update)
  // Both `e` and `y` archive (Superhuman style + Gmail muscle memory)
  e: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.archive($selectedEmailId);
      selectNextEmail();
    }
  },

  y: () => {
    // Gmail-style archive shortcut
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.archive($selectedEmailId);
      selectNextEmail();
    }
  },

  "#": () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.trash($selectedEmailId);
      selectNextEmail();
    }
  },

  Backspace: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.trash($selectedEmailId);
      selectNextEmail();
    }
  },

  Delete: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.trash($selectedEmailId);
      selectNextEmail();
    }
  },

  s: () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.toggleStar($selectedEmailId);
    }
  },

  // Mark read/unread
  "Shift+i": () => {
    const $selectedEmailId = get(selectedEmailId);
    if ($selectedEmailId) {
      emailActions.toggleRead($selectedEmailId);
    }
  },

  // Command palette
  "Cmd+k": () => {
    isCommandPaletteOpen.update((v) => !v);
  },

  // Sync/Refresh - triggers a sync callback if registered
  "Shift+r": () => {
    if (syncCallback) {
      syncCallback();
    }
  },

  // Search focus (handled in component)
  "/": () => {
    // Will be handled by the search component
  },

  // Compose new email
  c: () => {
    composeMode.set("new");
    replyToEmail.set(null);
    view.set("compose");
  },

  // Reply
  r: () => {
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

  // Reply all
  a: () => {
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

  // Forward
  f: () => {
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

  // Go to bottom (Shift+G)
  "Shift+g": () => {
    const $emails = get(emails);
    if ($emails.length > 0) {
      selectedIndex.set($emails.length - 1);
      selectedEmailId.set($emails[$emails.length - 1].id);
    }
  },

  // g starts a sequence (gi = inbox, gg = top)
  g: () => {
    // This is handled specially in handleKeydown for sequences
    // If we get here, it means no sequence was completed, so go to top
    selectedIndex.set(0);
    const $emails = get(emails);
    if ($emails.length > 0) {
      selectedEmailId.set($emails[0].id);
    }
  },
};

// Scroll email content (for spacebar scrolling)
function scrollEmailContent(amount: number) {
  // Try to scroll the email content container
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

  // Check for two-key sequences (e.g., "gi" for go to inbox)
  if (pendingKey) {
    const sequence = pendingKey + key;
    clearPendingKey();

    const seqHandler = sequenceHandlers[sequence];
    if (seqHandler) {
      event.preventDefault();
      seqHandler();
      return;
    }
    // No sequence matched, try the pending key's handler then current key
    const pendingHandler = handlers[pendingKey];
    if (pendingHandler) {
      pendingHandler();
    }
  }

  // Check if this key starts a sequence
  const startsSequence = Object.keys(sequenceHandlers).some(seq => seq.startsWith(key));
  if (startsSequence && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    pendingKey = key;
    // Clear pending key after 500ms if no follow-up
    pendingKeyTimeout = setTimeout(() => {
      if (pendingKey) {
        const handler = handlers[pendingKey];
        if (handler) handler();
        clearPendingKey();
      }
    }, 500);
    return;
  }

  const handler = handlers[key];
  if (handler) {
    event.preventDefault();
    handler();
  }
}

export function initKeyboardNavigation() {
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }
}
