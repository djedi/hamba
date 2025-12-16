<script lang="ts">
  import { selectedEmailIds, emails, selectionActions, bulkEmailActions } from "$lib/stores";

  // Computed values
  const selectionCount = $derived($selectedEmailIds.size);
  const hasSelection = $derived(selectionCount > 0);

  // Check if all visible emails are selected
  const allSelected = $derived($emails.length > 0 && selectionCount === $emails.length);

  // Check selection state for toggle buttons
  const selectedEmails = $derived($emails.filter((e) => $selectedEmailIds.has(e.id)));
  const allStarred = $derived(selectedEmails.length > 0 && selectedEmails.every((e) => e.is_starred));
  const allRead = $derived(selectedEmails.length > 0 && selectedEmails.every((e) => e.is_read));

  function handleSelectAll() {
    if (allSelected) {
      selectionActions.clearSelection();
    } else {
      selectionActions.selectAll();
    }
  }

  function handleArchive() {
    const ids = Array.from($selectedEmailIds);
    bulkEmailActions.archive(ids);
  }

  function handleTrash() {
    const ids = Array.from($selectedEmailIds);
    bulkEmailActions.trash(ids);
  }

  function handleToggleStar() {
    const ids = Array.from($selectedEmailIds);
    if (allStarred) {
      bulkEmailActions.unstar(ids);
    } else {
      bulkEmailActions.star(ids);
    }
  }

  function handleToggleRead() {
    const ids = Array.from($selectedEmailIds);
    if (allRead) {
      bulkEmailActions.markUnread(ids);
    } else {
      bulkEmailActions.markRead(ids);
    }
  }

  function handleClear() {
    selectionActions.clearSelection();
  }
</script>

{#if hasSelection}
  <div class="bulk-toolbar">
    <div class="left">
      <button
        class="checkbox-btn"
        onclick={handleSelectAll}
        title={allSelected ? "Deselect all" : "Select all"}
      >
        {#if allSelected}
          <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
            <rect x="1" y="1" width="14" height="14" rx="2" fill="var(--accent)" />
            <path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
            <rect x="1" y="1" width="14" height="14" rx="2" fill="var(--accent)" />
            <path d="M4 8H12" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>
        {/if}
      </button>

      <span class="count">{selectionCount} selected</span>
    </div>

    <div class="actions">
      <button class="action-btn" onclick={handleArchive} title="Archive (e)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2">
          <rect x="2" y="4" width="20" height="5" rx="1"/>
          <path d="M4 9v9a2 2 0 002 2h12a2 2 0 002-2V9"/>
          <path d="M10 13h4"/>
        </svg>
        <span class="action-label">Archive</span>
      </button>

      <button class="action-btn" onclick={handleTrash} title="Move to trash (#)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
          <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
        <span class="action-label">Trash</span>
      </button>

      <button class="action-btn" onclick={handleToggleStar} title={allStarred ? "Unstar" : "Star (s)"}>
        {#if allStarred}
          <svg viewBox="0 0 24 24" fill="var(--starred)" stroke="var(--starred)" width="18" height="18" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        {/if}
        <span class="action-label">{allStarred ? "Unstar" : "Star"}</span>
      </button>

      <button class="action-btn" onclick={handleToggleRead} title={allRead ? "Mark as unread" : "Mark as read"}>
        {#if allRead}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M22 6l-10 7L2 6"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        {/if}
        <span class="action-label">{allRead ? "Unread" : "Read"}</span>
      </button>
    </div>

    <div class="right">
      <button class="close-btn" onclick={handleClear} title="Clear selection (Esc)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2">
          <path d="M18 6L6 18"/>
          <path d="M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .bulk-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    gap: 16px;
  }

  .left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .checkbox-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--accent);
    border-radius: 4px;
  }

  .checkbox-btn:hover {
    background: var(--bg-hover);
  }

  .count {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 13px;
    transition: all 0.1s ease;
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .action-label {
    display: none;
  }

  @media (min-width: 768px) {
    .action-label {
      display: inline;
    }
  }

  .right {
    display: flex;
    align-items: center;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.1s ease;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
