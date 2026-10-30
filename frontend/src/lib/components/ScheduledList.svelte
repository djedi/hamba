<script lang="ts">
  import { CalendarClock } from "@lucide/svelte";
  import { scheduledEmails, scheduledEmailActions, drafts, showToast } from "$lib/stores";
  import { api, type Draft, type ScheduledEmail } from "$lib/api";
  import WhenPicker from "./WhenPicker.svelte";
  import DraftRowSkeleton from "./DraftRowSkeleton.svelte";
  import EmptyState from "./EmptyState.svelte";

  interface Props {
    loading?: boolean;
    onEdit?: (draft: Draft) => void;
  }

  let { loading = false, onEdit }: Props = $props();

  // Scheduled email being rescheduled (picker open)
  let reschedulingId = $state<string | null>(null);

  async function handleReschedule(sendAt: number) {
    const id = reschedulingId;
    reschedulingId = null;
    if (!id) return;
    const previous = $scheduledEmails;
    // Optimistic: update the time and keep the list ordered
    scheduledEmails.update(($s) => $s.map((s) => (s.id === id ? { ...s, send_at: sendAt } : s)).sort((a, b) => a.send_at - b.send_at));
    try {
      const result = await api.updateScheduledEmail(id, { sendAt });
      if (!result.success) throw new Error(result.error || "Failed to reschedule");
      showToast(`Rescheduled for ${formatScheduledDate(sendAt)}`, "success");
    } catch (e) {
      scheduledEmails.set(previous);
      showToast(e instanceof Error ? e.message : "Failed to reschedule", "error");
    }
  }

  // Edit = pull it back into a draft (so nothing is lost if you close without sending)
  async function handleEdit(scheduled: ScheduledEmail) {
    const id = crypto.randomUUID();
    try {
      const saved = await api.saveDraft({
        id,
        accountId: scheduled.account_id,
        to: scheduled.to_addresses,
        cc: scheduled.cc_addresses ?? undefined,
        bcc: scheduled.bcc_addresses ?? undefined,
        subject: scheduled.subject,
        body: scheduled.body,
        replyToId: scheduled.reply_to_id ?? undefined,
      });
      if (saved.error) throw new Error(saved.error);
      const cancelled = await api.cancelScheduledEmail(scheduled.id);
      if (!cancelled.success) {
        await api.deleteDraft(id).catch(() => {});
        throw new Error(cancelled.error || "It may have just been sent");
      }
      scheduledEmails.update(($s) => $s.filter((s) => s.id !== scheduled.id));
      const draft: Draft = {
        id,
        account_id: scheduled.account_id,
        remote_id: null,
        to_addresses: scheduled.to_addresses,
        cc_addresses: scheduled.cc_addresses ?? "",
        bcc_addresses: scheduled.bcc_addresses ?? "",
        subject: scheduled.subject,
        body: scheduled.body,
        reply_to_id: scheduled.reply_to_id,
        reply_mode: null,
        updated_at: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000),
      };
      drafts.update(($d) => [draft, ...$d]);
      onEdit?.(draft);
    } catch (e) {
      showToast(`Couldn't edit scheduled email: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

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
      icon={CalendarClock}
      title="No scheduled emails"
      description="Emails you schedule for later will appear here. Use the schedule button in compose."
    />
  {:else}
    <div class="list">
      {#each $scheduledEmails as scheduled (scheduled.id)}
        <div class="scheduled-row" role="button" tabindex="0" onclick={() => handleEdit(scheduled)} onkeydown={(e) => e.key === "Enter" && handleEdit(scheduled)}>
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
            onclick={(e) => { e.stopPropagation(); reschedulingId = scheduled.id; }}
            title="Change send time"
          >
            Reschedule
          </button>
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

{#if reschedulingId}
  <WhenPicker
    title="Reschedule"
    icon={CalendarClock}
    confirmLabel="Reschedule"
    onPick={handleReschedule}
    onClose={() => (reschedulingId = null)}
  />
{/if}

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
    cursor: pointer;
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
