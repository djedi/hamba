<script lang="ts">
  import type { Email } from "$lib/api";
  import { selectedEmailId, selectedIndex, view, emailActions, prefetchEmail, emailLabelsCache, labelActions } from "$lib/stores";
  import { onMount } from "svelte";

  interface Props {
    email: Email;
    selected: boolean;
    index: number;
  }

  let { email, selected, index }: Props = $props();

  // Get labels for this email from cache
  const emailLabels = $derived($emailLabelsCache.get(email.id) || []);

  // Load labels for this email on mount
  onMount(() => {
    labelActions.loadLabelsForEmail(email.id);
  });

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  function handleClick() {
    selectedEmailId.set(email.id);
    selectedIndex.set(index);
    view.set("email");
    if (!email.is_read) {
      emailActions.markRead(email.id);
    }
    // Update URL for state persistence
    const url = new URL(window.location.href);
    url.searchParams.set("email", email.id);
    window.history.pushState({}, "", url);
  }

  function handleStar(e: MouseEvent) {
    e.stopPropagation();
    emailActions.toggleStar(email.id);
  }

  function handleMouseEnter() {
    // Prefetch email body on hover for instant open
    prefetchEmail(email.id);
  }
</script>

<div
  class="email-row"
  class:selected
  class:unread={!email.is_read}
  onclick={handleClick}
  onmouseenter={handleMouseEnter}
  role="button"
  tabindex="0"
>
  <span
    class="star"
    class:starred={email.is_starred}
    onclick={handleStar}
    role="button"
    tabindex="-1"
  >
    {email.is_starred ? "★" : "☆"}
  </span>

  <div class="sender">
    {email.from_name || email.from_email.split("@")[0]}
  </div>

  <div class="content">
    <span class="subject">{email.subject || "(no subject)"}</span>
    {#if emailLabels.length > 0}
      <span class="labels">
        {#each emailLabels.slice(0, 2) as label (label.id)}
          <span class="label-chip" style="background-color: {label.color}20; color: {label.color}; border-color: {label.color}40">
            {label.name}
          </span>
        {/each}
        {#if emailLabels.length > 2}
          <span class="label-more">+{emailLabels.length - 2}</span>
        {/if}
      </span>
    {/if}
    <span class="separator">—</span>
    <span class="snippet">{email.snippet}</span>
  </div>

  <div class="date">{formatDate(email.received_at)}</div>
</div>

<style>
  .email-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
    width: 100%;
  }

  .email-row:hover {
    background: var(--bg-hover);
  }

  .email-row.selected {
    background: var(--bg-selected);
  }

  .email-row.unread {
    background: var(--bg-secondary);
  }

  .email-row.unread.selected {
    background: var(--bg-selected);
  }

  .email-row.unread .sender,
  .email-row.unread .subject {
    font-weight: 600;
    color: var(--text-primary);
  }

  .star {
    background: none;
    border: none;
    padding: 0;
    font-size: 16px;
    color: var(--text-muted);
    cursor: pointer;
    line-height: 1;
  }

  .star:hover {
    color: var(--starred);
  }

  .star.starred {
    color: var(--starred);
  }

  .sender {
    width: 180px;
    flex-shrink: 0;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    min-width: 0;
  }

  .subject {
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 40%;
  }

  .separator {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .snippet {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .labels {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .label-chip {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid;
    white-space: nowrap;
    font-weight: 500;
  }

  .label-more {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .date {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 12px;
    width: 70px;
    text-align: right;
  }

  .email-row.unread .date {
    color: var(--unread);
    font-weight: 600;
  }
</style>
