<script lang="ts">
  import { drafts } from "$lib/stores";
  import type { Draft } from "$lib/api";
  import DraftRowSkeleton from "./DraftRowSkeleton.svelte";
  import EmptyState from "./EmptyState.svelte";

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
    <div class="skeleton-list">
      {#each Array(5) as _, i (i)}
        <DraftRowSkeleton />
      {/each}
    </div>
  {:else if $drafts.length === 0}
    <EmptyState
      icon="📝"
      title="No drafts"
      description="Drafts you compose will appear here. Press 'c' to start composing."
    />
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

  .skeleton-list {
    flex: 1;
    overflow: hidden;
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
