<script lang="ts">
  import { scheduledEmails, scheduledEmailActions } from "$lib/stores";

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
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading scheduled emails...</span>
    </div>
  {:else if $scheduledEmails.length === 0}
    <div class="empty">
      <span class="empty-icon">📅</span>
      <h3>No scheduled emails</h3>
      <p>Emails you schedule for later will appear here.</p>
    </div>
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
