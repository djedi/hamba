<script lang="ts">
  import { api } from "$lib/api";
  import { view, composeMode, replyToEmail, composePrefillBody } from "$lib/stores";
  import type { Email } from "$lib/api";

  interface Props {
    email: Email;
  }

  let { email }: Props = $props();

  let replies = $state<string[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let loaded = $state(false);

  // Reset state when email changes
  $effect(() => {
    if (email) {
      replies = [];
      loading = false;
      error = null;
      loaded = false;
    }
  });

  async function loadReplies() {
    if (loading || loaded) return;

    loading = true;
    error = null;

    try {
      const response = await api.aiSmartReplies(email.id);
      if (response.success && response.replies) {
        replies = response.replies;
        loaded = true;
      } else {
        error = response.error || "Failed to generate replies";
      }
    } catch (err: any) {
      error = err.message || "Failed to generate replies";
    } finally {
      loading = false;
    }
  }

  function selectReply(replyText: string) {
    // Set prefill body and start composing a reply
    composePrefillBody.set(replyText);
    composeMode.set("reply");
    replyToEmail.set(email);
    view.set("compose");
  }
</script>

<div class="smart-replies">
  {#if !loaded && !loading && !error}
    <button class="load-btn" onclick={loadReplies}>
      Quick Replies
    </button>
  {:else if loading}
    <div class="loading">Generating replies...</div>
  {:else if error}
    <div class="error-container">
      <span class="error-text">{error}</span>
      <button class="retry-btn" onclick={() => { loaded = false; loadReplies(); }}>Retry</button>
    </div>
  {:else if replies.length > 0}
    <div class="replies-container">
      <span class="label">Quick Reply:</span>
      <div class="reply-buttons">
        {#each replies as reply}
          <button class="reply-btn" onclick={() => selectReply(reply)}>
            {reply}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .smart-replies {
    padding: 12px 0;
    border-top: 1px solid var(--border);
    margin-top: 16px;
  }

  .load-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--accent);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .load-btn:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .loading {
    color: var(--text-muted);
    font-size: 13px;
    font-style: italic;
    padding: 8px 0;
  }

  .error-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .error-text {
    color: var(--danger, #ef4444);
    font-size: 13px;
  }

  .retry-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .retry-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .replies-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .label {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .reply-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .reply-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 8px 14px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 13px;
    max-width: 300px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.15s ease;
  }

  .reply-btn:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
</style>
