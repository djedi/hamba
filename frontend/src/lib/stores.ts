import { writable, derived, get } from "svelte/store";
import type { Account, Email, Draft, Label, ScheduledEmail, Snippet } from "./api";
import { api } from "./api";

// Current state
export const accounts = writable<Account[]>([]);
export const selectedAccountId = writable<string | null>(null);
export const emails = writable<Email[]>([]);
export const selectedEmailId = writable<string | null>(null);
export const isLoading = writable(false);
export const searchQuery = writable("");
export const view = writable<"inbox" | "email" | "compose">("inbox");

// Pagination state for infinite scroll
export const emailOffset = writable(0);
export const isLoadingMore = writable(false);
export const hasMoreEmails = writable(true);

// Current folder (inbox, starred, sent, drafts, trash, archive, snoozed, reminders, scheduled, label, etc.)
export type Folder = "inbox" | "starred" | "sent" | "drafts" | "trash" | "archive" | "snoozed" | "reminders" | "scheduled" | "label";
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

// Scheduled emails store
export const scheduledEmails = writable<ScheduledEmail[]>([]);

// Snippets store
export const snippets = writable<Snippet[]>([]);

// Current draft being edited (for auto-save)
export const currentDraftId = writable<string | null>(null);

// Compose state
export const composeMode = writable<"new" | "reply" | "replyAll" | "forward">("new");
export const replyToEmail = writable<Email | null>(null);
export const composePrefillBody = writable<string | null>(null);

// Command palette
export const isCommandPaletteOpen = writable(false);

// Snooze modal
export const isSnoozeModalOpen = writable(false);

// Reminder modal
export const isReminderModalOpen = writable(false);

// Email body cache for prefetching
export const emailBodyCache = writable<Map<string, { text: string; html: string }>>(new Map());

// Toast notifications
export interface Toast {
  id: string;
  message: string;
  type: "error" | "success";
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number; // ms, 0 for no auto-dismiss
}

export const toasts = writable<Toast[]>([]);

export function showToast(
  message: string,
  type: "error" | "success" = "error",
  options?: { action?: { label: string; onClick: () => void }; duration?: number }
): string {
  const id = crypto.randomUUID();
  const duration = options?.duration ?? 3000;

  toasts.update((t) => [...t, { id, message, type, action: options?.action, duration }]);

  if (duration > 0) {
    setTimeout(() => {
      toasts.update((t) => t.filter((toast) => toast.id !== id));
    }, duration);
  }

  return id;
}

export function dismissToast(id: string) {
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}

// Optimistic email actions
export const emailActions = {
  star: (emailId: string) => {
    // Optimistic update
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_starred: 1 } : e))
    );
    // Background API call
    api.star(emailId).then(() => {
      showToast("Email starred", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.unstar(emailId),
        },
      });
    }).catch(() => {
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
    api.unstar(emailId).then(() => {
      showToast("Star removed", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.star(emailId),
        },
      });
    }).catch(() => {
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

    api.archive(emailId).then(() => {
      showToast("Email archived", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.unarchive(emailId),
        },
      });
    }).catch(() => {
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

    api.unarchive(emailId).then(() => {
      showToast("Moved to inbox", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.archive(emailId),
        },
      });
    }).catch(() => {
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

    api.trash(emailId).then(() => {
      showToast("Moved to trash", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.untrash(emailId),
        },
      });
    }).catch(() => {
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

    api.untrash(emailId).then(() => {
      showToast("Email restored", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.trash(emailId),
        },
      });
    }).catch(() => {
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

    api.permanentDelete(emailId).then(() => {
      showToast("Email deleted permanently", "success");
    }).catch(() => {
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

    api.markImportant(emailId).then(() => {
      showToast("Marked as important", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.markNotImportant(emailId),
        },
      });
    }).catch(() => {
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

    api.markNotImportant(emailId).then(() => {
      showToast("Marked as not important", "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.markImportant(emailId),
        },
      });
    }).catch(() => {
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

    api.snooze(emailId, snoozedUntil).then(() => {
      const snoozeDate = new Date(snoozedUntil);
      const timeStr = snoozeDate.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      showToast(`Snoozed until ${timeStr}`, "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.unsnooze(emailId),
        },
      });
    }).catch(() => {
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

    api.unsnooze(emailId).then(() => {
      showToast("Snooze cancelled", "success");
    }).catch(() => {
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

    api.setReminder(emailId, remindAt).then(() => {
      const reminderDate = new Date(remindAt);
      const timeStr = reminderDate.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      showToast(`Reminder set for ${timeStr}`, "success", {
        action: {
          label: "Undo",
          onClick: () => emailActions.clearReminder(emailId),
        },
      });
    }).catch(() => {
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
    const previousRemindAt = email?.remind_at;

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

    api.clearReminder(emailId).then(() => {
      showToast("Reminder cleared", "success", previousRemindAt ? {
        action: {
          label: "Undo",
          onClick: () => emailActions.setReminder(emailId, previousRemindAt),
        },
      } : undefined);
    }).catch(() => {
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

  // Prefetch next 5 and previous 2 for instant navigation
  const indicesToPrefetch = [
    currentIndex - 2,
    currentIndex - 1,
    currentIndex + 1,
    currentIndex + 2,
    currentIndex + 3,
    currentIndex + 4,
    currentIndex + 5,
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

// Scheduled email actions
export const scheduledEmailActions = {
  loadScheduledEmails: async (accountId: string) => {
    try {
      const fetched = await api.getScheduledEmails(accountId);
      scheduledEmails.set(fetched);
    } catch (e) {
      console.error("Failed to load scheduled emails:", e);
    }
  },

  cancelScheduledEmail: async (scheduledId: string) => {
    const $scheduledEmails = get(scheduledEmails);
    const scheduled = $scheduledEmails.find((s) => s.id === scheduledId);

    // Optimistic remove
    scheduledEmails.update(($s) => $s.filter((s) => s.id !== scheduledId));

    try {
      const result = await api.cancelScheduledEmail(scheduledId);
      if (!result.success) {
        // Rollback
        if (scheduled) {
          scheduledEmails.update(($s) => [...$s, scheduled].sort((a, b) => a.send_at - b.send_at));
        }
        showToast(result.error || "Failed to cancel scheduled email");
      } else {
        showToast("Scheduled email cancelled", "success");
      }
      return result;
    } catch (e) {
      // Rollback
      if (scheduled) {
        scheduledEmails.update(($s) => [...$s, scheduled].sort((a, b) => a.send_at - b.send_at));
      }
      showToast("Failed to cancel scheduled email");
      return { success: false, error: String(e) };
    }
  },
};

// Snippet actions
export const snippetActions = {
  loadSnippets: async (accountId: string) => {
    try {
      const fetched = await api.getSnippets(accountId);
      snippets.set(fetched);
    } catch (e) {
      console.error("Failed to load snippets:", e);
    }
  },

  createSnippet: async (accountId: string, name: string, shortcut: string, content: string) => {
    try {
      const result = await api.createSnippet({ accountId, name, shortcut, content });
      if (result.success && result.id) {
        snippets.update(($snippets) => [
          ...$snippets,
          {
            id: result.id!,
            account_id: accountId,
            name,
            shortcut,
            content,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
          },
        ].sort((a, b) => a.name.localeCompare(b.name)));
        showToast("Snippet created", "success");
      } else {
        showToast(result.error || "Failed to create snippet");
      }
      return result;
    } catch (e) {
      console.error("Failed to create snippet:", e);
      showToast("Failed to create snippet");
      return { success: false, error: String(e) };
    }
  },

  updateSnippet: async (id: string, params: { name?: string; shortcut?: string; content?: string }) => {
    const $snippets = get(snippets);
    const original = $snippets.find((s) => s.id === id);

    // Optimistic update
    snippets.update(($snippets) =>
      $snippets.map((s) =>
        s.id === id
          ? { ...s, ...params, updated_at: Math.floor(Date.now() / 1000) }
          : s
      ).sort((a, b) => a.name.localeCompare(b.name))
    );

    try {
      const result = await api.updateSnippet(id, params);
      if (!result.success) {
        // Rollback
        if (original) {
          snippets.update(($snippets) =>
            $snippets.map((s) => (s.id === id ? original : s))
          );
        }
        showToast(result.error || "Failed to update snippet");
      } else {
        showToast("Snippet updated", "success");
      }
      return result;
    } catch (e) {
      // Rollback
      if (original) {
        snippets.update(($snippets) =>
          $snippets.map((s) => (s.id === id ? original : s))
        );
      }
      showToast("Failed to update snippet");
      return { success: false, error: String(e) };
    }
  },

  deleteSnippet: async (id: string) => {
    const $snippets = get(snippets);
    const snippet = $snippets.find((s) => s.id === id);

    // Optimistic remove
    snippets.update(($snippets) => $snippets.filter((s) => s.id !== id));

    try {
      const result = await api.deleteSnippet(id);
      if (!result.success) {
        // Rollback
        if (snippet) {
          snippets.update(($snippets) => [...$snippets, snippet].sort((a, b) => a.name.localeCompare(b.name)));
        }
        showToast(result.error || "Failed to delete snippet");
      } else {
        showToast("Snippet deleted", "success");
      }
      return result;
    } catch (e) {
      // Rollback
      if (snippet) {
        snippets.update(($snippets) => [...$snippets, snippet].sort((a, b) => a.name.localeCompare(b.name)));
      }
      showToast("Failed to delete snippet");
      return { success: false, error: String(e) };
    }
  },

  // Get snippet by shortcut (for inline expansion)
  getByShortcut: (shortcut: string): Snippet | undefined => {
    const $snippets = get(snippets);
    return $snippets.find((s) => s.shortcut === shortcut);
  },
};
