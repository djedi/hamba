<script lang="ts">
  import { selectedEmail, view, emails, composeMode, replyToEmail, emailActions, selectedIndex, selectedEmailId, currentFolder, searchQuery } from "$lib/stores";
  import { get } from "svelte/store";
  import { extractSearchTerms, highlightHTMLContent, getHighlightCSS } from "$lib/search";
  import { formatDateFull } from "$lib/dateUtils";
  import { api } from "$lib/api";
  import HighlightText from "./HighlightText.svelte";
  import SmartReplySuggestions from "./SmartReplySuggestions.svelte";

  // AI Summary state
  let showSummary = $state(false);
  let summaryText = $state<string | null>(null);
  let summaryLoading = $state(false);
  let summaryError = $state<string | null>(null);
  let summaryCached = $state(false);

  // Reset summary state when email changes
  $effect(() => {
    if ($selectedEmail) {
      // If the email has a cached summary, show it
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

  let iframeRef: HTMLIFrameElement;

  // Extract search terms from the current search query
  const searchTerms = $derived(extractSearchTerms($searchQuery));

  // Escape HTML entities for plain text display
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  // Sanitize HTML and replace cid: URLs with API URLs
  function sanitizeEmailHtml(html: string, emailId: string): string {
    let sanitized = html;

    // Replace cid: image references with API endpoint URLs
    sanitized = sanitized.replace(
      /(<img[^>]*\ssrc=["'])cid:([^"']+)(["'])/gi,
      (match, prefix, contentId, suffix) => {
        return `${prefix}${API_URL}/emails/${encodeURIComponent(emailId)}/attachment/${encodeURIComponent(contentId)}${suffix}`;
      }
    );

    // Remove tracking pixels (1x1 images)
    sanitized = sanitized.replace(
      /<img[^>]*(?:width=["']1["'][^>]*height=["']1["']|height=["']1["'][^>]*width=["']1["'])[^>]*>/gi,
      ''
    );

    // Remove script tags entirely (sandbox blocks them but this prevents errors)
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove event handlers (onclick, onerror, onload, etc.)
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

    // Remove javascript: URLs
    sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

    // Remove max-width constraints that create narrow email boxes
    sanitized = sanitized.replace(/max-width\s*:\s*\d+px\s*;?/gi, '');

    // Make container divs and tables full width
    sanitized = sanitized.replace(
      /(<(?:div|table)[^>]*style=["'][^"']*)width\s*:\s*\d+px/gi,
      '$1width:100%'
    );

    return sanitized;
  }

  // Write email content to iframe for CSS isolation
  function renderEmailBody(iframe: HTMLIFrameElement, html: string, emailId: string, isPlainText = false, terms: string[] = []) {
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    let content: string;
    if (isPlainText) {
      // For plain text, escape HTML first, then apply highlighting
      const escaped = escapeHtml(html);
      const highlighted = terms.length > 0 ? highlightHTMLContent(escaped, terms) : escaped;
      content = `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${highlighted}</pre>`;
    } else {
      // For HTML, sanitize first, then apply highlighting
      const sanitized = sanitizeEmailHtml(html, emailId);
      content = terms.length > 0 ? highlightHTMLContent(sanitized, terms) : sanitized;
    }

    // Add highlight CSS if we have search terms
    const highlightCSS = terms.length > 0 ? getHighlightCSS() : "";

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="referrer" content="no-referrer">
          <base target="_blank">
          <style>
            * { box-sizing: border-box; }
            html {
              background: #e5e5e5;
              -webkit-font-smoothing: antialiased;
              -moz-osx-font-smoothing: grayscale;
              text-rendering: optimizeLegibility;
            }
            body {
              margin: 0;
              padding: 16px;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              background: white;
              color: #111;
              /* Mailspring-style dark mode: invert colors and rotate hue to preserve color relationships */
              filter: invert(100%) hue-rotate(180deg);
            }
            /* Double-invert images/videos to restore original colors */
            img, video, picture, [style*="background-image"] {
              filter: invert(100%) hue-rotate(180deg);
            }
            /* Remove max-width constraints that create narrow email boxes */
            body > div[style*="max-width"],
            body > center > div[style*="max-width"],
            body > table,
            body > center > table {
              max-width: 100% !important;
              width: 100% !important;
            }
            a { color: #6366f1; }
            a:visited { color: #8b5cf6; }
            blockquote {
              border-left: 3px solid #bbb;
              padding-left: 16px;
              margin-left: 0;
              color: #555;
            }
            /* Don't use border-collapse on tables - it breaks border-radius */
            table { border-spacing: 0; }
            td, th { vertical-align: top; }
            hr { border-color: #bbb; }
            pre, code { background: #f5f5f5; }
            ${highlightCSS}
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    doc.close();

    // Auto-resize iframe to content
    setTimeout(() => {
      if (iframe.contentDocument?.body) {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + "px";
      }
    }, 100);
  }

  // Reactively update iframe when email or search terms change
  // Dark mode is applied via CSS filter (invert + hue-rotate) in the iframe
  $effect(() => {
    if ($selectedEmail && iframeRef) {
      if ($selectedEmail.body_html) {
        renderEmailBody(iframeRef, $selectedEmail.body_html, $selectedEmail.id, false, searchTerms);
      } else if ($selectedEmail.body_text) {
        renderEmailBody(iframeRef, $selectedEmail.body_text, $selectedEmail.id, true, searchTerms);
      }
    }
  });

  function handleBack() {
    view.set("inbox");
    // Clear URL param
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
    if ($selectedEmail) {
      composeMode.set("reply");
      replyToEmail.set($selectedEmail);
      view.set("compose");
    }
  }

  function handleReplyAll() {
    if ($selectedEmail) {
      composeMode.set("replyAll");
      replyToEmail.set($selectedEmail);
      view.set("compose");
    }
  }

  function handleForward() {
    if ($selectedEmail) {
      composeMode.set("forward");
      replyToEmail.set($selectedEmail);
      view.set("compose");
    }
  }
</script>

{#if $selectedEmail}
  <div class="email-view slide-up">
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
      <h1 class="subject">
        {#if searchTerms.length > 0}
          <HighlightText text={$selectedEmail.subject || "(no subject)"} {searchTerms} />
        {:else}
          {$selectedEmail.subject || "(no subject)"}
        {/if}
      </h1>

      <div class="meta">
        <div class="sender-info">
          <div class="avatar">
            {($selectedEmail.from_name || $selectedEmail.from_email)[0].toUpperCase()}
          </div>
          <div class="sender-details">
            <div class="sender-name">
              {#if searchTerms.length > 0}
                <HighlightText text={$selectedEmail.from_name || $selectedEmail.from_email} {searchTerms} />
              {:else}
                {$selectedEmail.from_name || $selectedEmail.from_email}
              {/if}
            </div>
            <div class="sender-email">&lt;{$selectedEmail.from_email}&gt;</div>
          </div>
        </div>
        <div class="date">{formatDateFull($selectedEmail.received_at)}</div>
      </div>

      <div class="recipients">
        <span class="label">To:</span>
        <span class="value">{$selectedEmail.to_addresses}</span>
        {#if $selectedEmail.cc_addresses}
          <span class="label">Cc:</span>
          <span class="value">{$selectedEmail.cc_addresses}</span>
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

      <div class="body">
        {#if $selectedEmail.body_html || $selectedEmail.body_text}
          <iframe
            bind:this={iframeRef}
            class="email-frame"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            title="Email content"
          ></iframe>
        {:else}
          <p class="no-content">No content</p>
        {/if}
      </div>

      {#if $currentFolder !== "sent" && $currentFolder !== "drafts" && $currentFolder !== "scheduled"}
        <SmartReplySuggestions email={$selectedEmail} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .email-view {
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

  .subject {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 24px;
    line-height: 1.3;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .sender-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 16px;
  }

  .sender-name {
    font-weight: 600;
  }

  .sender-email {
    color: var(--text-muted);
    font-size: 13px;
  }

  .date {
    color: var(--text-muted);
    font-size: 13px;
  }

  .recipients {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .recipients .label {
    color: var(--text-muted);
  }

  .body {
    line-height: 1.6;
    color: var(--text-primary);
  }

  .email-frame {
    width: 100%;
    min-height: 200px;
    border: none;
    background: transparent;
  }

  .no-content {
    color: var(--text-muted);
    font-style: italic;
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
</style>
