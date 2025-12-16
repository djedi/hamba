import { writable, get } from "svelte/store";

// Action identifiers for all keyboard shortcuts
export type ShortcutAction =
  // Navigation
  | "navigate_down"
  | "navigate_up"
  | "open_email"
  | "back_to_list"
  | "scroll_down"
  | "scroll_up"
  | "go_to_top"
  | "go_to_bottom"
  // Go to folder
  | "go_inbox"
  | "go_starred"
  | "go_sent"
  | "go_drafts"
  | "go_trash"
  | "go_archive"
  | "go_snoozed"
  | "go_reminders"
  | "go_scheduled"
  // Email actions
  | "archive"
  | "archive_alt"
  | "trash"
  | "trash_backspace"
  | "trash_delete"
  | "toggle_star"
  | "toggle_read"
  | "snooze"
  | "set_reminder"
  // Selection
  | "toggle_select"
  | "select_all"
  // Account switching
  | "switch_account_1"
  | "switch_account_2"
  | "switch_account_3"
  | "switch_account_4"
  | "switch_account_5"
  | "switch_account_6"
  | "switch_account_7"
  | "switch_account_8"
  | "switch_account_9"
  // Compose
  | "compose_new"
  | "reply"
  | "reply_all"
  | "forward"
  // Other
  | "command_palette"
  | "settings"
  | "search"
  | "show_shortcuts"
  | "sync";

export interface ShortcutDefinition {
  action: ShortcutAction;
  defaultKey: string;
  description: string;
  category: "Navigation" | "Go to" | "Actions" | "Compose" | "Other";
  // Some shortcuts can have aliases (e.g., "o" and "Enter" both open email)
  isAlias?: boolean;
}

// All shortcuts with their defaults
export const defaultShortcuts: ShortcutDefinition[] = [
  // Navigation
  { action: "navigate_down", defaultKey: "j", description: "Navigate down", category: "Navigation" },
  { action: "navigate_up", defaultKey: "k", description: "Navigate up", category: "Navigation" },
  { action: "open_email", defaultKey: "Enter", description: "Open email", category: "Navigation" },
  { action: "back_to_list", defaultKey: "Escape", description: "Back to list", category: "Navigation" },
  { action: "scroll_down", defaultKey: " ", description: "Scroll down", category: "Navigation" },
  { action: "scroll_up", defaultKey: "Shift+ ", description: "Scroll up", category: "Navigation" },
  { action: "go_to_top", defaultKey: "gg", description: "Go to top", category: "Navigation" },
  { action: "go_to_bottom", defaultKey: "Shift+g", description: "Go to bottom", category: "Navigation" },

  // Go to folder (sequences)
  { action: "go_inbox", defaultKey: "gi", description: "Go to Inbox", category: "Go to" },
  { action: "go_starred", defaultKey: "gs", description: "Go to Starred", category: "Go to" },
  { action: "go_sent", defaultKey: "gt", description: "Go to Sent", category: "Go to" },
  { action: "go_drafts", defaultKey: "gd", description: "Go to Drafts", category: "Go to" },
  { action: "go_trash", defaultKey: "gx", description: "Go to Trash", category: "Go to" },
  { action: "go_archive", defaultKey: "ga", description: "Go to Archive", category: "Go to" },
  { action: "go_snoozed", defaultKey: "gh", description: "Go to Snoozed", category: "Go to" },
  { action: "go_reminders", defaultKey: "gr", description: "Go to Reminders", category: "Go to" },
  { action: "go_scheduled", defaultKey: "gl", description: "Go to Scheduled", category: "Go to" },

  // Actions
  { action: "archive", defaultKey: "e", description: "Archive", category: "Actions" },
  { action: "archive_alt", defaultKey: "y", description: "Archive (Gmail style)", category: "Actions", isAlias: true },
  { action: "trash", defaultKey: "#", description: "Move to trash", category: "Actions" },
  { action: "trash_backspace", defaultKey: "Backspace", description: "Move to trash", category: "Actions", isAlias: true },
  { action: "trash_delete", defaultKey: "Delete", description: "Move to trash", category: "Actions", isAlias: true },
  { action: "toggle_star", defaultKey: "s", description: "Star/Unstar", category: "Actions" },
  { action: "toggle_read", defaultKey: "Shift+i", description: "Toggle read/unread", category: "Actions" },
  { action: "snooze", defaultKey: "h", description: "Snooze", category: "Actions" },
  { action: "set_reminder", defaultKey: "Shift+h", description: "Set reminder", category: "Actions" },
  { action: "toggle_select", defaultKey: "x", description: "Select/Deselect", category: "Actions" },
  { action: "select_all", defaultKey: "Cmd+a", description: "Select all", category: "Actions" },

  // Compose
  { action: "compose_new", defaultKey: "c", description: "New email", category: "Compose" },
  { action: "reply", defaultKey: "r", description: "Reply", category: "Compose" },
  { action: "reply_all", defaultKey: "a", description: "Reply all", category: "Compose" },
  { action: "forward", defaultKey: "f", description: "Forward", category: "Compose" },

  // Account switching
  { action: "switch_account_1", defaultKey: "Cmd+1", description: "Switch to account 1", category: "Other" },
  { action: "switch_account_2", defaultKey: "Cmd+2", description: "Switch to account 2", category: "Other" },
  { action: "switch_account_3", defaultKey: "Cmd+3", description: "Switch to account 3", category: "Other" },
  { action: "switch_account_4", defaultKey: "Cmd+4", description: "Switch to account 4", category: "Other" },
  { action: "switch_account_5", defaultKey: "Cmd+5", description: "Switch to account 5", category: "Other" },
  { action: "switch_account_6", defaultKey: "Cmd+6", description: "Switch to account 6", category: "Other" },
  { action: "switch_account_7", defaultKey: "Cmd+7", description: "Switch to account 7", category: "Other" },
  { action: "switch_account_8", defaultKey: "Cmd+8", description: "Switch to account 8", category: "Other" },
  { action: "switch_account_9", defaultKey: "Cmd+9", description: "Switch to account 9", category: "Other" },

  // Other
  { action: "command_palette", defaultKey: "Cmd+k", description: "Command palette", category: "Other" },
  { action: "settings", defaultKey: "Cmd+,", description: "Settings", category: "Other" },
  { action: "search", defaultKey: "/", description: "Search", category: "Other" },
  { action: "show_shortcuts", defaultKey: "?", description: "Show shortcuts", category: "Other" },
  { action: "sync", defaultKey: "Shift+r", description: "Sync", category: "Other" },
];

const STORAGE_KEY = "settings.keyboardShortcuts";

// Store for custom bindings (action -> key)
export const customBindings = writable<Record<string, string>>({});

// Load custom bindings from localStorage
export function loadCustomBindings(): void {
  if (typeof localStorage === "undefined") return;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed === "object" && parsed !== null) {
        customBindings.set(parsed);
      }
    }
  } catch (e) {
    console.error("Failed to load custom keyboard shortcuts:", e);
  }
}

// Save custom bindings to localStorage
function saveCustomBindings(): void {
  if (typeof localStorage === "undefined") return;

  const bindings = get(customBindings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch (e) {
    console.error("Failed to save custom keyboard shortcuts:", e);
  }
}

// Get the current key for an action (custom or default)
export function getKeyForAction(action: ShortcutAction): string {
  const bindings = get(customBindings);
  if (bindings[action]) {
    return bindings[action];
  }

  const def = defaultShortcuts.find((s) => s.action === action);
  return def?.defaultKey || "";
}

// Get the action for a key (looks up in custom bindings first, then defaults)
export function getActionForKey(key: string): ShortcutAction | null {
  const bindings = get(customBindings);

  // Build a reverse lookup map: key -> action
  // Start with defaults
  const keyToAction: Record<string, ShortcutAction> = {};

  for (const def of defaultShortcuts) {
    // Only set if not overridden by a custom binding
    if (!Object.values(bindings).includes(def.defaultKey) || bindings[def.action] === def.defaultKey) {
      keyToAction[def.defaultKey] = def.action;
    }
  }

  // Apply custom bindings (they take precedence)
  for (const [action, customKey] of Object.entries(bindings)) {
    keyToAction[customKey] = action as ShortcutAction;
  }

  return keyToAction[key] || null;
}

// Set a custom binding for an action
export function setBinding(action: ShortcutAction, key: string): { success: boolean; conflict?: ShortcutAction } {
  // Check for conflicts
  const existingAction = getActionForKey(key);
  if (existingAction && existingAction !== action) {
    return { success: false, conflict: existingAction };
  }

  customBindings.update((bindings) => {
    // If setting back to default, remove the custom binding
    const def = defaultShortcuts.find((s) => s.action === action);
    if (def && def.defaultKey === key) {
      delete bindings[action];
    } else {
      bindings[action] = key;
    }
    return { ...bindings };
  });

  saveCustomBindings();
  return { success: true };
}

// Reset a single shortcut to its default
export function resetBinding(action: ShortcutAction): void {
  customBindings.update((bindings) => {
    delete bindings[action];
    return { ...bindings };
  });
  saveCustomBindings();
}

// Reset all shortcuts to defaults
export function resetAllBindings(): void {
  customBindings.set({});
  saveCustomBindings();
}

// Check if any shortcuts have been customized
export function hasCustomBindings(): boolean {
  const bindings = get(customBindings);
  return Object.keys(bindings).length > 0;
}

// Get all shortcuts grouped by category (with current keys)
export function getShortcutsByCategory(): { category: string; shortcuts: Array<{ action: ShortcutAction; key: string; description: string; isCustom: boolean; isAlias?: boolean }> }[] {
  const bindings = get(customBindings);
  const categories = ["Navigation", "Go to", "Actions", "Compose", "Other"] as const;

  return categories.map((category) => ({
    category,
    shortcuts: defaultShortcuts
      .filter((s) => s.category === category)
      .map((s) => ({
        action: s.action,
        key: bindings[s.action] || s.defaultKey,
        description: s.description,
        isCustom: !!bindings[s.action],
        isAlias: s.isAlias,
      })),
  }));
}

// Format a key for display (e.g., "Shift+r" -> "Shift + R")
export function formatKeyForDisplay(key: string): string {
  if (!key) return "";

  // Handle special keys
  if (key === " ") return "Space";
  if (key === "Shift+ ") return "Shift + Space";

  // Handle two-key sequences
  if (key.length === 2 && !key.includes("+")) {
    return key.split("").join(" ");
  }

  // Handle modifier combinations
  if (key.includes("+")) {
    const parts = key.split("+");
    return parts.map((p, i) => {
      if (p === " ") return "Space";
      if (i === parts.length - 1) return p.toUpperCase();
      return p;
    }).join(" + ");
  }

  return key.toUpperCase();
}

// Parse a key event into our key format
export function parseKeyEvent(event: KeyboardEvent): string {
  let key = event.key;

  // Ignore standalone modifier keys
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(key)) {
    return "";
  }

  // Build the key string
  const isLetter = /^[a-zA-Z]$/.test(key);

  if (event.metaKey || event.ctrlKey) {
    key = `Cmd+${key.toLowerCase()}`;
  } else if (event.shiftKey && isLetter) {
    key = `Shift+${key.toLowerCase()}`;
  } else if (event.shiftKey && key === " ") {
    key = "Shift+ ";
  }

  return key;
}

// Build the handler maps for keyboard.ts to use
export function buildKeyMaps(): {
  handlers: Record<string, ShortcutAction>;
  sequences: Record<string, ShortcutAction>;
} {
  const bindings = get(customBindings);
  const handlers: Record<string, ShortcutAction> = {};
  const sequences: Record<string, ShortcutAction> = {};

  for (const def of defaultShortcuts) {
    const key = bindings[def.action] || def.defaultKey;

    // Determine if this is a sequence (two-character key without modifiers)
    const isSequence = key.length === 2 && !key.includes("+") && key !== "gg";

    if (isSequence || key === "gg") {
      // It's a sequence like "gi", "gs", or "gg"
      sequences[key] = def.action;
    } else {
      handlers[key] = def.action;
    }
  }

  return { handlers, sequences };
}
