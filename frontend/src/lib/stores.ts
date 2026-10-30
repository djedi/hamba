import { writable, derived, get } from "svelte/store";
import type { Account, Email, Draft, Label, ScheduledEmail, Snippet } from "./api";
import { api } from "./api";

// Current state
export const accounts = writable<Account[]>([]);
export const selectedAccountId = writable<string | null>(null);
export const emails = writable<Email[]>([]);
export const selectedEmailId = writable<string | null>(null);

// Seamlessly merge new emails into existing list without jarring reload
// Returns { added: number, updated: number, removed: number } for optional toast
export function mergeEmails(newEmails: Email[]): { added: number; updated: number; removed: number } {
  const $emails = get(emails);
  const existingMap = new Map($emails.map((e) => [e.id, e]));
  const newMap = new Map(newEmails.map((e) => [e.id, e]));

  let added = 0;
  let updated = 0;
  let removed = 0;

  // Build merged list
  const mergedList: Email[] = [];

  // Add all new emails, updating existing ones in place
  for (const newEmail of newEmails) {
    const existing = existingMap.get(newEmail.id);
    if (existing) {
      // Check if email was updated (compare key fields)
      const hasChanged =
        existing.is_read !== newEmail.is_read ||
        existing.is_starred !== newEmail.is_starred ||
        existing.is_archived !== newEmail.is_archived ||
        existing.is_trashed !== newEmail.is_trashed ||
        existing.labels !== newEmail.labels ||
        existing.snoozed_until !== newEmail.snoozed_until ||
        existing.remind_at !== newEmail.remind_at;

      if (hasChanged) {
        mergedList.push(newEmail);
        updated++;
      } else {
        // Keep existing object reference to avoid unnecessary re-renders
        mergedList.push(existing);
      }
    } else {
      // New email
      mergedList.push(newEmail);
      added++;
    }
  }

  // Count removed emails (in existing but not in new)
  for (const existing of $emails) {
    if (!newMap.has(existing.id)) {
      removed++;
    }
  }

  // Only update store if there are changes
  if (added > 0 || updated > 0 || removed > 0) {
    emails.set(mergedList);
  }

  return { added, updated, removed };
}
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

// Account switcher (opened with @)
export const isAccountSwitcherOpen = writable(false);

// Snooze modal
export const isSnoozeModalOpen = writable(false);

// Reminder modal
export const isReminderModalOpen = writable(false);

// Keyboard shortcut overlay
export const isShortcutOverlayOpen = writable(false);

// Settings modal
export const isSettingsOpen = writable(false);

// Label picker modal
export const isLabelPickerOpen = writable(false);

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

// Which list (account + folder) is on screen, so an undo doesn't insert into a different one
function listContext(): string {
  return `${get(selectedAccountId)}:${get(currentFolder)}:${get(selectedLabelId)}`;
}

// Undo of a removal: put the email back in the visible list (if the user is still on the
// list it was removed from) and revert on the server
function undoRemoval(email: Email | undefined, context: string, revert: () => Promise<unknown>, failMsg: string) {
  if (email && listContext() !== context) {
    if (isInboxUnread(email)) adjustUnread(email.account_id, 1);
    revert().catch(() => {
      if (isInboxUnread(email)) adjustUnread(email.account_id, -1);
      showToast(failMsg);
    });
    return;
  }
  if (email) {
    emails.update(($emails) =>
      $emails.some((e) => e.id === email.id)
        ? $emails
        : [...$emails, email].sort((a, b) => b.received_at - a.received_at)
    );
    if (isInboxUnread(email)) adjustUnread(email.account_id, 1);
  }
  revert().catch(() => {
    if (email) emails.update(($emails) => $emails.filter((e) => e.id !== email.id));
    if (email && isInboxUnread(email)) adjustUnread(email.account_id, -1);
    showToast(failMsg);
  });
}

// Unread counts per account (inbox only, same definition as the backend). Kept current by
// optimistic deltas in emailActions and by accountActions.refreshUnreadCounts.
export const unreadCounts = writable<Record<string, number>>({});

export function adjustUnread(accountId: string, delta: number) {
  unreadCounts.update((counts) => {
    if (!(accountId in counts)) return counts;
    return { ...counts, [accountId]: Math.max(0, counts[accountId] + delta) };
  });
}

// Whether an email currently counts toward its account's inbox unread badge
function isInboxUnread(email: Email): boolean {
  return (
    (email.folder ?? "inbox") === "inbox" &&
    !email.is_read &&
    !email.is_archived &&
    !email.is_trashed &&
    email.snoozed_until == null
  );
}

// Adjust the unread badge for applying `patch` to `email` (sign -1 reverts the change)
function applyInboxUnread(email: Email | undefined, patch: Partial<Email>, sign: 1 | -1 = 1) {
  if (!email) return;
  const delta = (isInboxUnread({ ...email, ...patch }) ? 1 : 0) - (isInboxUnread(email) ? 1 : 0);
  if (delta !== 0) adjustUnread(email.account_id, delta * sign);
}

function applyInboxUnreadToAll(list: Email[], patch: Partial<Email>, sign: 1 | -1 = 1) {
  for (const email of list) applyInboxUnread(email, patch, sign);
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
    const email = get(emails).find((e) => e.id === emailId);
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_read: 1 } : e))
    );
    applyInboxUnread(email, { is_read: 1 });
    api.markRead(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_read: 0 } : e))
      );
      applyInboxUnread(email, { is_read: 1 }, -1);
    });
  },

  markUnread: (emailId: string) => {
    const email = get(emails).find((e) => e.id === emailId);
    emails.update(($emails) =>
      $emails.map((e) => (e.id === emailId ? { ...e, is_read: 0 } : e))
    );
    applyInboxUnread(email, { is_read: 0 });
    api.markUnread(emailId).catch(() => {
      emails.update(($emails) =>
        $emails.map((e) => (e.id === emailId ? { ...e, is_read: 1 } : e))
      );
      applyInboxUnread(email, { is_read: 0 }, -1);
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
    const context = listContext();

    // Optimistic remove from list
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    applyInboxUnread(email, { is_archived: 1 });
    api.archive(emailId).then(() => {
      showToast("Email archived", "success", {
        action: {
          label: "Undo",
          onClick: () => undoRemoval(email, context, () => api.unarchive(emailId), "Failed to undo archive"),
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
      applyInboxUnread(email, { is_archived: 1 }, -1);
      showToast("Failed to archive email");
    });
  },

  unarchive: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from archive view
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    applyInboxUnread(email, { is_archived: 0 });
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
      applyInboxUnread(email, { is_archived: 0 }, -1);
      showToast("Failed to unarchive email");
    });
  },

  trash: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);
    const context = listContext();

    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    applyInboxUnread(email, { is_trashed: 1 });
    api.trash(emailId).then(() => {
      showToast("Moved to trash", "success", {
        action: {
          label: "Undo",
          onClick: () => undoRemoval(email, context, () => api.untrash(emailId), "Failed to undo trash"),
        },
      });
    }).catch(() => {
      if (email) {
        emails.update(($emails) => {
          const newList = [...$emails, email];
          return newList.sort((a, b) => b.received_at - a.received_at);
        });
      }
      applyInboxUnread(email, { is_trashed: 1 }, -1);
      showToast("Failed to trash email");
    });
  },

  untrash: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from trash view
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    applyInboxUnread(email, { is_trashed: 0 });
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
      applyInboxUnread(email, { is_trashed: 0 }, -1);
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

    applyInboxUnread(email, { snoozed_until: snoozedUntil });
    api.snooze(emailId, snoozedUntil).then(() => {
      const snoozeDate = new Date(snoozedUntil * 1000);
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
      applyInboxUnread(email, { snoozed_until: snoozedUntil }, -1);
      showToast("Failed to snooze email");
    });
  },

  unsnooze: (emailId: string) => {
    const $emails = get(emails);
    const email = $emails.find((e) => e.id === emailId);

    // Optimistic remove from snoozed view
    emails.update(($emails) => $emails.filter((e) => e.id !== emailId));

    applyInboxUnread(email, { snoozed_until: null });
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
      applyInboxUnread(email, { snoozed_until: null }, -1);
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
      const reminderDate = new Date(remindAt * 1000);
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

// Account switching
function switchToAccount(accountId: string) {
  if (get(selectedAccountId) === accountId) return;
  if (!get(accounts).some((a) => a.id === accountId)) return;
  selectedAccountId.set(accountId);
}

function cycleAccount(step: 1 | -1) {
  const $accounts = get(accounts);
  if ($accounts.length === 0) return;
  const current = $accounts.findIndex((a) => a.id === get(selectedAccountId));
  let next: number;
  if (current === -1) {
    next = step === 1 ? 0 : $accounts.length - 1;
  } else {
    next = (current + step + $accounts.length) % $accounts.length;
  }
  switchToAccount($accounts[next].id);
}

export const accountActions = {
  switchTo: switchToAccount,
  // 0-based index into the accounts list
  switchByIndex: (index: number) => {
    const account = get(accounts)[index];
    if (account) switchToAccount(account.id);
  },
  switchNext: () => cycleAccount(1),
  switchPrev: () => cycleAccount(-1),
  // Errors are swallowed: the badge keeps its last known counts
  refreshUnreadCounts: async (): Promise<void> => {
    try {
      unreadCounts.set(await api.getUnreadCounts());
    } catch {
      // ignore
    }
  },
};

// Keyboard navigation index
export const selectedIndex = writable(0);

// Multi-selection state
export const selectedEmailIds = writable<Set<string>>(new Set());
export const lastSelectedIndex = writable<number | null>(null);

// Selection actions
export const selectionActions = {
  toggleSelection: (emailId: string, index: number) => {
    selectedEmailIds.update(($ids) => {
      const newSet = new Set($ids);
      if (newSet.has(emailId)) {
        newSet.delete(emailId);
      } else {
        newSet.add(emailId);
      }
      return newSet;
    });
    lastSelectedIndex.set(index);
  },

  selectRange: (toIndex: number) => {
    const $lastIndex = get(lastSelectedIndex);
    const $emails = get(emails);

    if ($lastIndex === null) {
      // No previous selection, just select current
      if ($emails[toIndex]) {
        selectedEmailIds.update(($ids) => {
          const newSet = new Set($ids);
          newSet.add($emails[toIndex].id);
          return newSet;
        });
      }
    } else {
      // Select range from lastIndex to toIndex
      const start = Math.min($lastIndex, toIndex);
      const end = Math.max($lastIndex, toIndex);

      selectedEmailIds.update(($ids) => {
        const newSet = new Set($ids);
        for (let i = start; i <= end; i++) {
          if ($emails[i]) {
            newSet.add($emails[i].id);
          }
        }
        return newSet;
      });
    }
    lastSelectedIndex.set(toIndex);
  },

  selectAll: () => {
    const $emails = get(emails);
    selectedEmailIds.set(new Set($emails.map((e) => e.id)));
  },

  clearSelection: () => {
    selectedEmailIds.set(new Set());
    lastSelectedIndex.set(null);
  },
};

// Bulk email actions (for multi-select)
export const bulkEmailActions = {
  archive: async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    const $emails = get(emails);
    const affectedEmails = $emails.filter((e) => emailIds.includes(e.id));

    // Optimistic remove from list
    emails.update(($emails) => $emails.filter((e) => !emailIds.includes(e.id)));
    selectionActions.clearSelection();
    applyInboxUnreadToAll(affectedEmails, { is_archived: 1 });

    try {
      const result = await api.batchArchive(emailIds);
      if (!result.success && result.failed?.length) {
        const failedIds = new Set(result.failed);
        const failedEmails = affectedEmails.filter((e) => failedIds.has(e.id));
        emails.update(($emails) =>
          [...$emails, ...failedEmails].sort((a, b) => b.received_at - a.received_at)
        );
        applyInboxUnreadToAll(failedEmails, { is_archived: 1 }, -1);
        showToast("Failed to archive " + failedEmails.length + " email" + (failedEmails.length > 1 ? "s" : ""));
        return;
      }
      showToast(`${emailIds.length} email${emailIds.length > 1 ? "s" : ""} archived`, "success", {
        action: {
          label: "Undo",
          onClick: async () => {
            // Restore emails to list
            emails.update(($emails) => {
              const newList = [...$emails, ...affectedEmails];
              return newList.sort((a, b) => b.received_at - a.received_at);
            });
            // Unarchive each one
            applyInboxUnreadToAll(affectedEmails, { is_archived: 1 }, -1);
            for (const email of affectedEmails) {
              await api.unarchive(email.id).catch(() => {});
            }
          },
        },
      });
    } catch {
      // Rollback
      emails.update(($emails) => {
        const newList = [...$emails, ...affectedEmails];
        return newList.sort((a, b) => b.received_at - a.received_at);
      });
      applyInboxUnreadToAll(affectedEmails, { is_archived: 1 }, -1);
      showToast("Failed to archive emails");
    }
  },

  trash: async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    const $emails = get(emails);
    const affectedEmails = $emails.filter((e) => emailIds.includes(e.id));

    // Optimistic remove from list
    emails.update(($emails) => $emails.filter((e) => !emailIds.includes(e.id)));
    selectionActions.clearSelection();
    applyInboxUnreadToAll(affectedEmails, { is_trashed: 1 });

    try {
      const result = await api.batchTrash(emailIds);
      if (!result.success && result.failed?.length) {
        const failedIds = new Set(result.failed);
        const failedEmails = affectedEmails.filter((e) => failedIds.has(e.id));
        emails.update(($emails) =>
          [...$emails, ...failedEmails].sort((a, b) => b.received_at - a.received_at)
        );
        applyInboxUnreadToAll(failedEmails, { is_trashed: 1 }, -1);
        showToast("Failed to trash " + failedEmails.length + " email" + (failedEmails.length > 1 ? "s" : ""));
        return;
      }
      showToast(`${emailIds.length} email${emailIds.length > 1 ? "s" : ""} moved to trash`, "success", {
        action: {
          label: "Undo",
          onClick: async () => {
            emails.update(($emails) => {
              const newList = [...$emails, ...affectedEmails];
              return newList.sort((a, b) => b.received_at - a.received_at);
            });
            applyInboxUnreadToAll(affectedEmails, { is_trashed: 1 }, -1);
            for (const email of affectedEmails) {
              await api.untrash(email.id).catch(() => {});
            }
          },
        },
      });
    } catch {
      emails.update(($emails) => {
        const newList = [...$emails, ...affectedEmails];
        return newList.sort((a, b) => b.received_at - a.received_at);
      });
      applyInboxUnreadToAll(affectedEmails, { is_trashed: 1 }, -1);
      showToast("Failed to move emails to trash");
    }
  },

  star: async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    // Optimistic update
    emails.update(($emails) =>
      $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_starred: 1 } : e))
    );

    try {
      await api.batchStar(emailIds);
      showToast(`${emailIds.length} email${emailIds.length > 1 ? "s" : ""} starred`, "success");
    } catch {
      // Rollback
      emails.update(($emails) =>
        $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_starred: 0 } : e))
      );
      showToast("Failed to star emails");
    }
  },

  unstar: async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    emails.update(($emails) =>
      $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_starred: 0 } : e))
    );

    try {
      await api.batchUnstar(emailIds);
      showToast(`Star removed from ${emailIds.length} email${emailIds.length > 1 ? "s" : ""}`, "success");
    } catch {
      emails.update(($emails) =>
        $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_starred: 1 } : e))
      );
      showToast("Failed to unstar emails");
    }
  },

  markRead: async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    const affected = get(emails).filter((e) => emailIds.includes(e.id));
    emails.update(($emails) =>
      $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_read: 1 } : e))
    );
    applyInboxUnreadToAll(affected, { is_read: 1 });

    try {
      await api.batchMarkRead(emailIds);
      showToast(`${emailIds.length} email${emailIds.length > 1 ? "s" : ""} marked as read`, "success");
    } catch {
      emails.update(($emails) =>
        $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_read: 0 } : e))
      );
      applyInboxUnreadToAll(affected, { is_read: 1 }, -1);
      showToast("Failed to mark emails as read");
    }
  },

  markUnread: async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    const affected = get(emails).filter((e) => emailIds.includes(e.id));
    emails.update(($emails) =>
      $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_read: 0 } : e))
    );
    applyInboxUnreadToAll(affected, { is_read: 0 });

    try {
      await api.batchMarkUnread(emailIds);
      showToast(`${emailIds.length} email${emailIds.length > 1 ? "s" : ""} marked as unread`, "success");
    } catch {
      emails.update(($emails) =>
        $emails.map((e) => (emailIds.includes(e.id) ? { ...e, is_read: 1 } : e))
      );
      applyInboxUnreadToAll(affected, { is_read: 0 }, -1);
      showToast("Failed to mark emails as unread");
    }
  },
};

// Last known labels per account, so switching accounts shows labels immediately
const labelsByAccount = new Map<string, Label[]>();

// Keep the per-account cache in step with the labels store (which holds the selected account's labels)
function rememberLabels() {
  const accountId = get(selectedAccountId);
  if (accountId) labelsByAccount.set(accountId, get(labels));
}

// Label actions
export const labelActions = {
  loadLabels: async (accountId: string) => {
    // Show this account's cached labels right away (never another account's labels)
    labels.set(labelsByAccount.get(accountId) ?? []);
    try {
      const fetchedLabels = await api.getLabels(accountId);
      labelsByAccount.set(accountId, fetchedLabels);
      // Ignore the response if the user switched accounts meanwhile
      if (get(selectedAccountId) === accountId) {
        labels.set(fetchedLabels);
      }
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
        rememberLabels();
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
        rememberLabels();
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
        rememberLabels();
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
