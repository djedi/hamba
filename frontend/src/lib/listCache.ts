import type { Email } from "./api";
import type { Folder } from "./stores";

// In-memory, per-account/folder snapshots of the email list. Used for instant
// account and folder switching: the cached list is shown immediately and then
// revalidated in the background.
export interface ListSnapshot {
  emails: Email[];
  offset: number;
  hasMore: boolean;
  selectedEmailId: string | null;
  selectedIndex: number;
  scrollTop: number;
  fetchedAt: number;
}

export const MAX_ENTRIES = 40;

// Insertion order doubles as recency order: the most recently used key is last.
const cache = new Map<string, ListSnapshot>();

export function listKey(accountId: string, folder: Folder, labelId?: string | null): string {
  if (folder === "label") {
    return `${accountId}:label:${labelId ?? ""}`;
  }
  return `${accountId}:${folder}`;
}

function touch(key: string, snap: ListSnapshot): void {
  cache.delete(key);
  cache.set(key, snap);
}

export function getSnapshot(key: string): ListSnapshot | undefined {
  const snap = cache.get(key);
  if (snap) touch(key, snap);
  return snap;
}

export function setSnapshot(key: string, snap: ListSnapshot): void {
  touch(key, snap);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function updateSnapshot(key: string, patch: Partial<ListSnapshot>): void {
  const snap = cache.get(key);
  if (!snap) return;
  touch(key, { ...snap, ...patch });
}

// Replace the cached first page of a list, keeping any saved selection and scroll position
export function writeFirstPage(key: string, emails: Email[], pageSize: number): void {
  const patch = {
    emails,
    offset: emails.length,
    hasMore: emails.length >= pageSize,
    fetchedAt: Date.now(),
  };
  const snap = cache.get(key);
  if (snap) {
    touch(key, { ...snap, ...patch });
  } else {
    setSnapshot(key, { ...patch, selectedEmailId: null, selectedIndex: 0, scrollTop: 0 });
  }
}

export function hasSnapshot(key: string): boolean {
  return cache.has(key);
}

export function invalidateAccount(accountId: string): void {
  const prefix = `${accountId}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearListCache(): void {
  cache.clear();
}
