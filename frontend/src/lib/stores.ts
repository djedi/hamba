import { writable, derived, get } from "svelte/store";
import type { Account, Email } from "./api";
import { api } from "./api";

// Current state
export const accounts = writable<Account[]>([]);
export const selectedAccountId = writable<string | null>(null);
export const emails = writable<Email[]>([]);
export const selectedEmailId = writable<string | null>(null);
export const isLoading = writable(false);
export const searchQuery = writable("");
export const view = writable<"inbox" | "email" | "compose">("inbox");

// Current folder (inbox, starred, sent, etc.)
export type Folder = "inbox" | "starred" | "sent";
export const currentFolder = writable<Folder>("inbox");

// Compose state
export const composeMode = writable<"new" | "reply" | "replyAll" | "forward">("new");
export const replyToEmail = writable<Email | null>(null);

// Command palette
export const isCommandPaletteOpen = writable(false);

// Email body cache for prefetching
export const emailBodyCache = writable<Map<string, { text: string; html: string }>>(new Map());

// Toast notifications for errors
export const toasts = writable<Array<{ id: string; message: string; type: "error" | "success" }>>([]);

function showToast(message: string, type: "error" | "success" = "error") {
  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update((t) => t.filter((toast) => toast.id !== id));
  }, 3000);
}

// Optimistic email actions
export const emailActions = {
  star: (emailId: string) => {
    // Optimistic update
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_starred: 1 } : e))
    );
    // Background API call
    api.star(emailId).catch(() => {
      // Rollback on failure
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_starred: 0 } : e))
      );
      showToast("Failed to star email");
    });
  },

  unstar: (emailId: string) => {
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_starred: 0 } : e))
    );
    api.unstar(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_starred: 1 } : e))
      );
      showToast("Failed to unstar email");
    });
  },

  toggleStar: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    if (email?.is_starred) {
      emailActions.unstar(emailId);
    } else {
      emailActions.star(emailId);
    }
  },

  markRead: (emailId: string) => {
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_read: 1 } : e))
    );
    api.markRead(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_read: 0 } : e))
      );
    });
  },

  markUnread: (emailId: string) => {
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_read: 0 } : e))
    );
    api.markUnread(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_read: 1 } : e))
      );
      showToast("Failed to mark as unread");
    });
  },

  toggleRead: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    if (email?.is_read) {
      emailActions.markUnread(emailId);
    } else {
      emailActions.markRead(emailId);
    }
  },

  archive: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from list
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    api.archive(emailId).catch(() => {
      // Rollback: add back to list
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      showToast("Failed to archive email");
    });
  },

  trash: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    api.trash(emailId).catch(() => {
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      showToast("Failed to trash email");
    });
  },
};

// Prefetch email body
const prefetchingIds = new Set<string>();

export function prefetchEmail(emailId: string) {
  const cache = get(emailBodyCache);

  // Already cached or prefetching
  if (cache.has(emailId) || prefetchingIds.has(emailId)) {
    return;
  }

  // Check if we already have the body in the emails list
  const $emails = get(emails);
  const email = $emails.find((e) => e.id === emailId);
  if (email && (email.body_html || email.body_text)) {
    emailBodyCache.update((c) => {
      c.set(emailId, { text: email.body_text, html: email.body_html });
      return c;
    });
    return;
  }

  prefetchingIds.add(emailId);

  api.getEmail(emailId)
    .then((fullEmail) => {
      if (fullEmail) {
        emailBodyCache.update((c) => {
          c.set(emailId, {
            text: fullEmail.body_text || "",
            html: fullEmail.body_html || ""
          });
          return c;
        });
        // Also update the email in the list with body content
        emails.update(($emails) =>
          $emails.map((e) =>
            e.id === emailId
              ? { ...e, body_text: fullEmail.body_text, body_html: fullEmail.body_html }
              : e
          )
        );
      }
    })
    .catch(() => {
      // Silent fail for prefetch
    })
    .finally(() => {
      prefetchingIds.delete(emailId);
    });
}

// Prefetch adjacent emails (for j/k navigation)
export function prefetchAdjacentEmails(currentIndex: number) {
  const $emails = get(emails);

  // Prefetch next 2 and previous 1
  const indicesToPrefetch = [
    currentIndex - 1,
    currentIndex + 1,
    currentIndex + 2,
  ].filter((i) => i >= 0 && i < $emails.length);

  indicesToPrefetch.forEach((i) => {
    prefetchEmail($emails[i].id);
  });
}

// Derived stores
export const selectedAccount = derived(
  [accounts, selectedAccountId],
  ([$accounts, $selectedAccountId]) =>
    $accounts.find((a) => a.id === $selectedAccountId) || null
);

export const selectedEmail = derived(
  [emails, selectedEmailId],
  ([$emails, $selectedEmailId]) =>
    $emails.find((e) => e.id === $selectedEmailId) || null
);

export const unreadCount = derived(emails, ($emails) =>
  $emails.filter((e) => !e.is_read).length
);

// Keyboard navigation index
export const selectedIndex = writable(0);
