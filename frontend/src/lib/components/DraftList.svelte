<script lang="ts">
  import { drafts } from "$lib/stores";
  import type { Draft } from "$lib/api";

  interface Props {
    loading?: boolean;
    onOpenDraft: (draft: Draft) => void;
  }

  let { loading = false, onOpenDraft }: Props = $props();

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getSnippet(draft: Draft): string {
    // Strip HTML tags for preview
    const text = draft.body?.replace(/<[^>]*>/g, '') || '';
    return text.substring(0, 100).trim() || '(No content)';
  }
</script>

<div class="draft-list">
  {#if loading && $drafts.length === 0}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading drafts...</span>
    </div>
  {:else if $drafts.length === 0}
    <div class="empty">
      <span class="empty-icon">📝</span>
      <h3>No drafts</h3>
      <p>Drafts you compose will appear here.</p>
    </div>
  {:else}
    <div class="list">
      {#each $drafts as draft (draft.id)}
        <button class="draft-row" onclick={() => onOpenDraft(draft)}>
          <div class="draft-header">
            <span class="draft-to">
              {#if draft.to_addresses}
                To: {draft.to_addresses}
              {:else}
                (No recipient)
              {/if}
            </span>
            <span class="draft-date">{formatDate(draft.updated_at)}</span>
          </div>
          <div class="draft-subject">
            {draft.subject || '(No subject)'}
          </div>
          <div class="draft-snippet">
            {getSnippet(draft)}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .draft-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .loading,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-secondary);
  }

  .loading .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--bg-tertiary);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .empty-icon {
    font-size: 48px;
  }

  .empty h3 {
    color: var(--text-primary);
    margin: 0;
  }

  .empty p {
    color: var(--text-muted);
    margin: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .draft-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .draft-row:hover {
    background: var(--bg-hover);
  }

  .draft-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .draft-to {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .draft-date {
    font-size: 12px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .draft-subject {
    font-size: 13px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .draft-snippet {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
