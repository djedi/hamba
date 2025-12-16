<script lang="ts">
  import { scheduledEmails, scheduledEmailActions } from "$lib/stores";
  import DraftRowSkeleton from "./DraftRowSkeleton.svelte";
  import EmptyState from "./EmptyState.svelte";

  interface Props {
    loading?: boolean;
  }

  let { loading = false }: Props = $props();

  function formatScheduledDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = date.toDateString() === now.toDateString();
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (isToday) {
      return `Today at ${time}`;
    }
    if (isTomorrow) {
      return `Tomorrow at ${time}`;
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${time}`;
  }

  function getSnippet(body: string): string {
    // Strip HTML tags for preview
    const text = body?.replace(/<[^>]*>/g, '') || '';
    return text.substring(0, 100).trim() || '(No content)';
  }

  async function handleCancel(id: string, e: Event) {
    e.stopPropagation();
    await scheduledEmailActions.cancelScheduledEmail(id);
  }
</script>

<div class="scheduled-list">
  {#if loading && $scheduledEmails.length === 0}
    <div class="skeleton-list">
      {#each Array(5) as _, i (i)}
        <DraftRowSkeleton />
      {/each}
    </div>
  {:else if $scheduledEmails.length === 0}
    <EmptyState
      icon="📅"
      title="No scheduled emails"
      description="Emails you schedule for later will appear here. Use the schedule button in compose."
    />
  {:else}
    <div class="list">
      {#each $scheduledEmails as scheduled (scheduled.id)}
        <div class="scheduled-row">
          <div class="scheduled-content">
            <div class="scheduled-header">
              <span class="scheduled-to">
                To: {scheduled.to_addresses}
              </span>
              <span class="scheduled-date">{formatScheduledDate(scheduled.send_at)}</span>
            </div>
            <div class="scheduled-subject">
              {scheduled.subject || '(No subject)'}
            </div>
            <div class="scheduled-snippet">
              {getSnippet(scheduled.body)}
            </div>
          </div>
          <button
            class="cancel-btn"
            onclick={(e) => handleCancel(scheduled.id, e)}
            title="Cancel scheduled email"
          >
            Cancel
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .scheduled-list {
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

  .scheduled-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .scheduled-row:hover {
    background: var(--bg-hover);
  }

  .scheduled-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .scheduled-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .scheduled-to {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .scheduled-date {
    font-size: 12px;
    color: var(--accent);
    flex-shrink: 0;
    font-weight: 500;
  }

  .scheduled-subject {
    font-size: 13px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scheduled-snippet {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cancel-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
  }

  .cancel-btn:hover {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }
</style>
