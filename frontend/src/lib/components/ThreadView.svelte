<script lang="ts">
  import { selectedEmail, view, emails, composeMode, replyToEmail, emailActions, selectedIndex, selectedEmailId, currentFolder, searchQuery } from "$lib/stores";
  import { get } from "svelte/store";
  import { extractSearchTerms, highlightHTMLContent, getHighlightCSS } from "$lib/search";
  import { api } from "$lib/api";
  import type { Email } from "$lib/api";
  import HighlightText from "./HighlightText.svelte";
  import SmartReplySuggestions from "./SmartReplySuggestions.svelte";
  import ThreadMessage from "./ThreadMessage.svelte";

  // Thread state
  let threadEmails = $state<Email[]>([]);
  let threadLoading = $state(false);
  let threadError = $state<string | null>(null);

  // Track which messages are expanded (by email ID)
  let expandedMessages = $state<Set<string>>(new Set());

  // AI Summary state
  let showSummary = $state(false);
  let summaryText = $state<string | null>(null);
  let summaryLoading = $state(false);
  let summaryError = $state<string | null>(null);
  let summaryCached = $state(false);

  // Extract search terms from the current search query
  const searchTerms = $derived(extractSearchTerms($searchQuery));

  // Fetch thread when email changes
  $effect(() => {
    if ($selectedEmail) {
      loadThread($selectedEmail.thread_id);

      // Reset summary state
      if ($selectedEmail.summary) {
        summaryText = $selectedEmail.summary;
        summaryCached = true;
        showSummary = true;
      } else {
        summaryText = null;
        summaryCached = false;
        showSummary = false;
      }
      summaryLoading = false;
      summaryError = null;
    }
  });

  async function loadThread(threadId: string) {
    if (!threadId) return;

    threadLoading = true;
    threadError = null;

    try {
      const emails = await api.getThread(threadId);
      threadEmails = emails;

      // By default, expand only the selected email or the last email in thread
      expandedMessages = new Set();
      if ($selectedEmail) {
        expandedMessages.add($selectedEmail.id);
      } else if (emails.length > 0) {
        expandedMessages.add(emails[emails.length - 1].id);
      }
    } catch (err: any) {
      threadError = err.message || "Failed to load thread";
      threadEmails = [];
    } finally {
      threadLoading = false;
    }
  }

  function toggleMessage(emailId: string) {
    if (expandedMessages.has(emailId)) {
      expandedMessages.delete(emailId);
    } else {
      expandedMessages.add(emailId);
    }
    expandedMessages = new Set(expandedMessages); // Trigger reactivity
  }

  function expandAll() {
    expandedMessages = new Set(threadEmails.map(e => e.id));
  }

  function collapseAll() {
    // Keep at least the selected email expanded
    if ($selectedEmail) {
      expandedMessages = new Set([$selectedEmail.id]);
    } else {
      expandedMessages = new Set();
    }
  }

  async function handleSummarize(regenerate = false) {
    if (!$selectedEmail) return;

    summaryLoading = true;
    summaryError = null;

    try {
      const response = await api.aiSummarize($selectedEmail.id, regenerate);

      if (response.success && response.summary) {
        summaryText = response.summary;
        summaryCached = response.cached || false;
        showSummary = true;
      } else {
        summaryError = response.error || "Failed to generate summary";
      }
    } catch (err: any) {
      summaryError = err.message || "Failed to generate summary";
    } finally {
      summaryLoading = false;
    }
  }

  function toggleSummary() {
    if (!showSummary && !summaryText) {
      handleSummarize();
    } else {
      showSummary = !showSummary;
    }
  }

  function handleBack() {
    view.set("inbox");
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.pushState({}, "", url);
  }

  function handleArchive() {
    if ($selectedEmail) {
      emailActions.archive($selectedEmail.id);
      selectNextAndGoBack();
    }
  }

  function handleTrash() {
    if ($selectedEmail) {
      emailActions.trash($selectedEmail.id);
      selectNextAndGoBack();
    }
  }

  function handleRestore() {
    if ($selectedEmail) {
      emailActions.untrash($selectedEmail.id);
      selectNextAndGoBack();
    }
  }

  function handleUnarchive() {
    if ($selectedEmail) {
      emailActions.unarchive($selectedEmail.id);
      selectNextAndGoBack();
    }
  }

  function handlePermanentDelete() {
    if ($selectedEmail) {
      emailActions.permanentDelete($selectedEmail.id);
      selectNextAndGoBack();
    }
  }

  function handleStar() {
    if ($selectedEmail) {
      emailActions.toggleStar($selectedEmail.id);
    }
  }

  function selectNextAndGoBack() {
    const currentEmails = get(emails);
    const currentIndex = get(selectedIndex);

    if (currentEmails.length > 0) {
      const newIndex = Math.min(currentIndex, currentEmails.length - 1);
      selectedIndex.set(newIndex);
      selectedEmailId.set(currentEmails[newIndex].id);
    } else {
      selectedEmailId.set(null);
    }
    view.set("inbox");
  }

  function handleReply() {
    // Reply to the last email in the thread
    const lastEmail = threadEmails.length > 0 ? threadEmails[threadEmails.length - 1] : $selectedEmail;
    if (lastEmail) {
      composeMode.set("reply");
      replyToEmail.set(lastEmail);
      view.set("compose");
    }
  }

  function handleReplyAll() {
    const lastEmail = threadEmails.length > 0 ? threadEmails[threadEmails.length - 1] : $selectedEmail;
    if (lastEmail) {
      composeMode.set("replyAll");
      replyToEmail.set(lastEmail);
      view.set("compose");
    }
  }

  function handleForward() {
    const lastEmail = threadEmails.length > 0 ? threadEmails[threadEmails.length - 1] : $selectedEmail;
    if (lastEmail) {
      composeMode.set("forward");
      replyToEmail.set(lastEmail);
      view.set("compose");
    }
  }

  // Check if this is a multi-message thread
  const isThread = $derived(threadEmails.length > 1);
  const threadSubject = $derived(threadEmails.length > 0 ? threadEmails[0].subject : $selectedEmail?.subject || "(no subject)");
</script>

{#if $selectedEmail}
  <div class="thread-view slide-up">
    <header class="header">
      <button class="back-btn" onclick={handleBack}>
        ← Back
      </button>
      <div class="actions">
        {#if $currentFolder === "trash"}
          <button onclick={handleRestore} title="Restore to Inbox">📥 Restore</button>
          <button onclick={handlePermanentDelete} title="Permanently Delete" class="danger">🗑️ Delete Forever</button>
        {:else if $currentFolder === "archive"}
          <button onclick={handleUnarchive} title="Move to Inbox">📥 Move to Inbox</button>
          <button onclick={handleStar} title="Star (s)">
            {$selectedEmail.is_starred ? "★ Starred" : "☆ Star"}
          </button>
          <button onclick={handleTrash} title="Trash (#)">🗑️ Trash</button>
          <button onclick={handleReply} title="Reply (r)">↩️ Reply</button>
          <button onclick={handleReplyAll} title="Reply All (a)">↩️ Reply All</button>
          <button onclick={handleForward} title="Forward (f)">↪️ Forward</button>
        {:else}
          <button onclick={handleArchive} title="Archive (e)">📥 Archive</button>
          <button onclick={handleStar} title="Star (s)">
            {$selectedEmail.is_starred ? "★ Starred" : "☆ Star"}
          </button>
          <button onclick={handleTrash} title="Trash (#)">🗑️ Trash</button>
          <button onclick={handleReply} title="Reply (r)">↩️ Reply</button>
          <button onclick={handleReplyAll} title="Reply All (a)">↩️ Reply All</button>
          <button onclick={handleForward} title="Forward (f)">↪️ Forward</button>
        {/if}
        <button onclick={toggleSummary} title="AI Summarize" class="summarize-btn" class:active={showSummary}>
          {summaryLoading ? "..." : "AI Summary"}
        </button>
      </div>
    </header>

    <div class="content">
      <div class="thread-header">
        <h1 class="subject">
          {#if searchTerms.length > 0}
            <HighlightText text={threadSubject || "(no subject)"} {searchTerms} />
          {:else}
            {threadSubject || "(no subject)"}
          {/if}
        </h1>

        {#if isThread}
          <div class="thread-controls">
            <span class="thread-count">{threadEmails.length} messages</span>
            <button class="expand-btn" onclick={expandAll}>Expand All</button>
            <button class="expand-btn" onclick={collapseAll}>Collapse All</button>
          </div>
        {/if}
      </div>

      {#if showSummary || summaryLoading || summaryError}
        <div class="summary-section">
          <div class="summary-header">
            <span class="summary-title">AI Summary</span>
            {#if summaryText && !summaryLoading}
              <button class="regenerate-btn" onclick={() => handleSummarize(true)} title="Regenerate summary">
                Regenerate
              </button>
            {/if}
          </div>
          {#if summaryLoading}
            <div class="summary-loading">Generating summary...</div>
          {:else if summaryError}
            <div class="summary-error">{summaryError}</div>
          {:else if summaryText}
            <div class="summary-content">{summaryText}</div>
          {/if}
        </div>
      {/if}

      {#if threadLoading}
        <div class="loading">Loading conversation...</div>
      {:else if threadError}
        <div class="error">{threadError}</div>
      {:else}
        <div class="messages">
          {#each threadEmails as email, index (email.id)}
            <ThreadMessage
              {email}
              expanded={expandedMessages.has(email.id)}
              isFirst={index === 0}
              isLast={index === threadEmails.length - 1}
              {searchTerms}
              onToggle={() => toggleMessage(email.id)}
            />
          {/each}
        </div>

        {#if $currentFolder !== "sent" && $currentFolder !== "drafts" && $currentFolder !== "scheduled" && threadEmails.length > 0}
          <div class="reply-section">
            <SmartReplySuggestions email={threadEmails[threadEmails.length - 1]} />
            <div class="reply-buttons">
              <button class="reply-btn primary" onclick={handleReply}>
                ↩️ Reply
              </button>
              <button class="reply-btn" onclick={handleReplyAll}>
                ↩️ Reply All
              </button>
              <button class="reply-btn" onclick={handleForward}>
                ↪️ Forward
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .thread-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .back-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 8px 12px;
  }

  .back-btn:hover {
    background: var(--bg-hover);
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .actions button {
    padding: 6px 12px;
    font-size: 13px;
  }

  .actions button.danger {
    background: var(--danger, #ef4444);
    border-color: var(--danger, #ef4444);
    color: white;
  }

  .actions button.danger:hover {
    background: #dc2626;
    border-color: #dc2626;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
    max-width: 900px;
  }

  .thread-header {
    margin-bottom: 24px;
  }

  .subject {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 12px;
    line-height: 1.3;
  }

  .thread-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .thread-count {
    color: var(--text-muted);
    font-size: 13px;
  }

  .expand-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .expand-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .loading {
    color: var(--text-muted);
    font-style: italic;
    padding: 24px 0;
  }

  .error {
    color: var(--danger, #ef4444);
    padding: 24px 0;
  }

  .messages {
    display: flex;
    flex-direction: column;
  }

  /* Remove top border from adjacent messages to avoid double borders */
  .messages :global(.thread-message + .thread-message) {
    margin-top: -1px;
  }

  .summarize-btn {
    background: var(--bg-secondary);
    border-color: var(--accent);
    color: var(--accent);
  }

  .summarize-btn:hover {
    background: var(--accent);
    color: white;
  }

  .summarize-btn.active {
    background: var(--accent);
    color: white;
  }

  .summary-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 24px;
  }

  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .summary-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--accent);
  }

  .regenerate-btn {
    font-size: 12px;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
  }

  .regenerate-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .summary-content {
    line-height: 1.6;
    color: var(--text-primary);
  }

  .summary-loading {
    color: var(--text-muted);
    font-style: italic;
  }

  .summary-error {
    color: var(--danger, #ef4444);
    font-size: 13px;
  }

  .reply-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
  }

  .reply-buttons {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .reply-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 10px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .reply-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .reply-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .reply-btn.primary:hover {
    background: var(--accent-hover, #4f46e5);
  }
</style>
