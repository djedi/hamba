import { writable, derived, get } from "svelte/store";
import type { Account, Email, Draft, Label } from "./api";
import { api } from "./api";

// Current state
export const accounts = writable<Account[]>([]);
export const selectedAccountId = writable<string | null>(null);
export const emails = writable<Email[]>([]);
export const selectedEmailId = writable<string | null>(null);
export const isLoading = writable(false);
export const searchQuery = writable("");
export const view = writable<"inbox" | "email" | "compose">("inbox");

// Current folder (inbox, starred, sent, drafts, trash, archive, snoozed, reminders, label, etc.)
export type Folder = "inbox" | "starred" | "sent" | "drafts" | "trash" | "archive" | "snoozed" | "reminders" | "label";
export const currentFolder = writable<Folder>("inbox");

// Split inbox tab (important, other, all) - only applies when currentFolder is "inbox"
export type InboxTab = "important" | "other" | "all";
export const inboxTab = writable<InboxTab>("important");

// Labels store
export const labels = writable<Label[]>([]);
export const selectedLabelId = writable<string | null>(null);

// Email labels cache (email ID -> labels)
export const emailLabelsCache = writable<Map<string, Label[]>>(new Map());

// Drafts store
export const drafts = writable<Draft[]>([]);

// Current draft being edited (for auto-save)
export const currentDraftId = writable<string | null>(null);

// Compose state
export const composeMode = writable<"new" | "reply" | "replyAll" | "forward">("new");
export const replyToEmail = writable<Email | null>(null);

// Command palette
export const isCommandPaletteOpen = writable(false);

// Snooze modal
export const isSnoozeModalOpen = writable(false);

// Reminder modal
export const isReminderModalOpen = writable(false);

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

  unarchive: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from archive view
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    api.unarchive(emailId).catch(() => {
      // Rollback: add back to list
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      showToast("Failed to unarchive email");
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

  untrash: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from trash view
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    api.untrash(emailId).catch(() => {
      // Rollback: add back to list
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      showToast("Failed to restore email");
    });
  },

  permanentDelete: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from list
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    api.permanentDelete(emailId).catch(() => {
      // Rollback: add back to list
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      showToast("Failed to delete email");
    });
  },

  markImportant: (emailId: string) => {
    const $inboxTab = get(inboxTab);

    // Optimistic update
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_important: 1 } : e))
    );

    // If viewing "other" tab, remove from list
    if ($inboxTab === "other") {
      emails.update(($emails) => $emails.filter((e) => e.id !== emailId));
    }

    api.markImportant(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_important: 0 } : e))
      );
      showToast("Failed to mark as important");
    });
  },

  markNotImportant: (emailId: string) => {
    const $inboxTab = get(inboxTab);

    // Optimistic update
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_important: 0 } : e))
    );

    // If viewing "important" tab, remove from list
    if ($inboxTab === "important") {
      emails.update(($emails) => $emails.filter((e) => e.id !== emailId));
    }

    api.markNotImportant(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_important: 1 } : e))
      );
      showToast("Failed to mark as not important");
    });
  },

  toggleImportant: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    if (email?.is_important) {
      emailActions.markNotImportant(emailId);
    } else {
      emailActions.markImportant(emailId);
    }
  },

  snooze: (emailId: string, snoozedUntil: number) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    const $currentFolder = get(currentFolder);

    // Optimistic update: remove from current view (except snoozed view)
    if ($currentFolder !== "snoozed") {
      emails.update(($emails) => $emails.filter((e) => e.id !== emailId));
    } else {
      // Update snoozed_until in snoozed view
      emails.update(($emails) =>
        $emails.map((e) =>
          e.id === emailId ? { ...e, snoozed_until: snoozedUntil } : e
        )
      );
    }

    api.snooze(emailId, snoozedUntil).catch(() => {
      // Rollback: add back to list
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, { ...email, snoozed_until: null }];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      showToast("Failed to snooze email");
    });
  },

  unsnooze: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from snoozed view
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    api.unsnooze(emailId).catch(() => {
      // Rollback: add back to list
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => (a.snoozed_until || 0) - (b.snoozed_until || 0));
        });
      }
      showToast("Failed to unsnooze email");
    });
  },

  setReminder: (emailId: string, remindAt: number) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    const $currentFolder = get(currentFolder);

    // Optimistic update
    emails.update(($emails) =>
      $emails.map((e) =>
        e.id === emailId ? { ...e, remind_at: remindAt } : e
      )
    );

    api.setReminder(emailId, remindAt).catch(() => {
      // Rollback
      if (email) {
        emails.update(($emails) =>
          $emails.map((e) =>
            e.id === emailId ? { ...e, remind_at: email.remind_at } : e
          )
        );
      }
      showToast("Failed to set reminder");
    });
  },

  clearReminder: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    const $currentFolder = get(currentFolder);

    // If viewing reminders folder, remove from list
    if ($currentFolder === "reminders") {
      emails.update(($emails) => $emails.filter((e) => e.id !== emailId));
    } else {
      // Optimistic update
      emails.update(($emails) =>
        $emails.map((e) =>
          e.id === emailId ? { ...e, remind_at: null } : e
        )
      );
    }

    api.clearReminder(emailId).catch(() => {
      // Rollback
      if (email) {
        if ($currentFolder === "reminders") {
          emails.update(($emails) => {
            const newList = [...$emails, email];
            return newList.sort((a, b) => (a.remind_at || 0) - (b.remind_at || 0));
          });
        } else {
          emails.update(($emails) =>
            $emails.map((e) =>
              e.id === emailId ? { ...e, remind_at: email.remind_at } : e
            )
          );
        }
      }
      showToast("Failed to clear reminder");
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

// Label actions
export const labelActions = {
  loadLabels: async (accountId: string) => {
    try {
      const fetchedLabels = await api.getLabels(accountId);
      labels.set(fetchedLabels);
    } catch (e) {
      console.error("Failed to load labels:", e);
    }
  },

  createLabel: async (accountId: string, name: string, color?: string) => {
    try {
      const result = await api.createLabel({ accountId, name, color });
      if (result.success && result.id) {
        labels.update(($labels) => [
          ...$labels,
          {
            id: result.id!,
            account_id: accountId,
            name,
            color: color || "#6366f1",
            type: "user",
            remote_id: null,
            created_at: Math.floor(Date.now() / 1000),
          },
        ]);
      }
      return result;
    } catch (e) {
      console.error("Failed to create label:", e);
      return { success: false, error: String(e) };
    }
  },

  updateLabel: async (id: string, params: { name?: string; color?: string }) => {
    try {
      const result = await api.updateLabel(id, params);
      if (result.success) {
        labels.update(($labels) =>
          $labels.map((l) =>
            l.id === id
              ? { ...l, name: params.name || l.name, color: params.color || l.color }
              : l
          )
        );
      }
      return result;
    } catch (e) {
      console.error("Failed to update label:", e);
      return { success: false, error: String(e) };
    }
  },

  deleteLabel: async (id: string) => {
    try {
      const result = await api.deleteLabel(id);
      if (result.success) {
        labels.update(($labels) => $labels.filter((l) => l.id !== id));
      }
      return result;
    } catch (e) {
      console.error("Failed to delete label:", e);
      return { success: false, error: String(e) };
    }
  },

  addLabelToEmail: async (labelId: string, emailId: string) => {
    const $labels = get(labels);
    const label = $labels.find((l) => l.id === labelId);
    if (!label) return { success: false, error: "Label not found" };

    // Optimistic update
    emailLabelsCache.update((cache) => {
      const existing = cache.get(emailId) || [];
      if (!existing.find((l) => l.id === labelId)) {
        cache.set(emailId, [...existing, label]);
      }
      return cache;
    });

    try {
      const result = await api.addLabelToEmail(labelId, emailId);
      if (!result.success) {
        // Rollback on failure
        emailLabelsCache.update((cache) => {
          const existing = cache.get(emailId) || [];
          cache.set(emailId, existing.filter((l) => l.id !== labelId));
          return cache;
        });
      }
      return result;
    } catch (e) {
      // Rollback on error
      emailLabelsCache.update((cache) => {
        const existing = cache.get(emailId) || [];
        cache.set(emailId, existing.filter((l) => l.id !== labelId));
        return cache;
      });
      return { success: false, error: String(e) };
    }
  },

  removeLabelFromEmail: async (labelId: string, emailId: string) => {
    const $emailLabelsCache = get(emailLabelsCache);
    const existingLabels = $emailLabelsCache.get(emailId) || [];
    const label = existingLabels.find((l) => l.id === labelId);

    // Optimistic update
    emailLabelsCache.update((cache) => {
      const existing = cache.get(emailId) || [];
      cache.set(emailId, existing.filter((l) => l.id !== labelId));
      return cache;
    });

    try {
      const result = await api.removeLabelFromEmail(labelId, emailId);
      if (!result.success && label) {
        // Rollback on failure
        emailLabelsCache.update((cache) => {
          const existing = cache.get(emailId) || [];
          cache.set(emailId, [...existing, label]);
          return cache;
        });
      }
      return result;
    } catch (e) {
      // Rollback on error
      if (label) {
        emailLabelsCache.update((cache) => {
          const existing = cache.get(emailId) || [];
          cache.set(emailId, [...existing, label]);
          return cache;
        });
      }
      return { success: false, error: String(e) };
    }
  },

  loadLabelsForEmail: async (emailId: string) => {
    const $cache = get(emailLabelsCache);
    if ($cache.has(emailId)) return;

    try {
      const emailLabels = await api.getLabelsForEmail(emailId);
      emailLabelsCache.update((cache) => {
        cache.set(emailId, emailLabels);
        return cache;
      });
    } catch (e) {
      console.error("Failed to load labels for email:", e);
    }
  },
};

// Selected label (derived)
export const selectedLabel = derived(
  [labels, selectedLabelId],
  ([$labels, $selectedLabelId]) =>
    $labels.find((l) => l.id === $selectedLabelId) || null
);
