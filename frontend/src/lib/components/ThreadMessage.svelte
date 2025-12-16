<script lang="ts">
  import type { Email } from "$lib/api";
  import { highlightHTMLContent, getHighlightCSS } from "$lib/search";
  import { formatRelativeDate, formatDateMedium, formatDateTooltip } from "$lib/dateUtils";
  import HighlightText from "./HighlightText.svelte";

  interface Props {
    email: Email;
    expanded: boolean;
    isFirst: boolean;
    isLast: boolean;
    searchTerms: string[];
    onToggle: () => void;
  }

  let { email, expanded, isFirst, isLast, searchTerms, onToggle }: Props = $props();

  let iframeRef: HTMLIFrameElement | undefined = $state();

  const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  // Escape HTML entities for plain text display
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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

    // Remove script tags entirely
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove event handlers
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

    // Remove javascript: URLs
    sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

    // Remove max-width constraints
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
      const escaped = escapeHtml(html);
      const highlighted = terms.length > 0 ? highlightHTMLContent(escaped, terms) : escaped;
      content = `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${highlighted}</pre>`;
    } else {
      const sanitized = sanitizeEmailHtml(html, emailId);
      content = terms.length > 0 ? highlightHTMLContent(sanitized, terms) : sanitized;
    }

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
              filter: invert(100%) hue-rotate(180deg);
            }
            img, video, picture, [style*="background-image"] {
              filter: invert(100%) hue-rotate(180deg);
            }
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

  // Render email body when expanded and iframe is available
  $effect(() => {
    if (expanded && iframeRef && email) {
      if (email.body_html) {
        renderEmailBody(iframeRef, email.body_html, email.id, false, searchTerms);
      } else if (email.body_text) {
        renderEmailBody(iframeRef, email.body_text, email.id, true, searchTerms);
      }
    }
  });

</script>

<div class="thread-message" class:expanded class:first={isFirst} class:last={isLast}>
  <button class="message-header" onclick={onToggle} type="button">
    <div class="header-left">
      <div class="avatar">
        {(email.from_name || email.from_email)[0].toUpperCase()}
      </div>
      <div class="sender-info">
        <span class="sender-name">
          {#if searchTerms.length > 0}
            <HighlightText text={email.from_name || email.from_email} {searchTerms} />
          {:else}
            {email.from_name || email.from_email}
          {/if}
        </span>
        {#if !expanded}
          <span class="snippet">
            {#if searchTerms.length > 0}
              <HighlightText text={email.snippet} {searchTerms} />
            {:else}
              {email.snippet}
            {/if}
          </span>
        {/if}
      </div>
    </div>
    <div class="header-right">
      <span class="date" title={formatDateTooltip(email.received_at)}>{expanded ? formatDateMedium(email.received_at) : formatRelativeDate(email.received_at)}</span>
      <span class="expand-icon">{expanded ? "▼" : "▶"}</span>
    </div>
  </button>

  {#if expanded}
    <div class="message-body">
      <div class="recipients">
        <span class="label">To:</span>
        <span class="value">{email.to_addresses}</span>
        {#if email.cc_addresses}
          <span class="label">Cc:</span>
          <span class="value">{email.cc_addresses}</span>
        {/if}
      </div>

      <div class="body">
        {#if email.body_html || email.body_text}
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
    </div>
  {/if}
</div>

<style>
  .thread-message {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }

  .thread-message.first {
    border-radius: 8px 8px 0 0;
  }

  .thread-message.last {
    border-radius: 0 0 8px 8px;
  }

  .thread-message.first.last {
    border-radius: 8px;
  }

  .message-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s ease;
  }

  .message-header:hover {
    background: var(--bg-hover);
  }

  .expanded .message-header {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 14px;
    flex-shrink: 0;
  }

  .sender-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .sender-name {
    font-weight: 500;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .snippet {
    color: var(--text-muted);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .date {
    color: var(--text-muted);
    font-size: 12px;
  }

  .expand-icon {
    color: var(--text-muted);
    font-size: 10px;
  }

  .message-body {
    padding: 16px;
  }

  .recipients {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
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
    min-height: 100px;
    border: none;
    background: transparent;
  }

  .no-content {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
