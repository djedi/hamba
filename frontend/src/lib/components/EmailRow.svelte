<script lang="ts">
  import { Star, Eye } from "@lucide/svelte";
  import type { Email } from "$lib/api";
  import { selectedEmailId, selectedIndex, view, emailActions, prefetchEmail, emailLabelsCache, labelActions, selectionActions } from "$lib/stores";
  import { formatRelativeDate, formatDateTooltip } from "$lib/dateUtils";
  import { onMount } from "svelte";
  import HighlightText from "./HighlightText.svelte";
  import { trackingBadge } from "$lib/tracking";

  interface Props {
    email: Email;
    selected: boolean;
    index: number;
    searchTerms?: string[];
    checked?: boolean;
  }

  let { email, selected, index, searchTerms = [], checked = false }: Props = $props();

  const badge = $derived(trackingBadge(email.tracking));

  // Get labels for this email from cache
  const emailLabels = $derived($emailLabelsCache.get(email.id) || []);

  // Load labels for this email on mount
  onMount(() => {
    labelActions.loadLabelsForEmail(email.id);
  });

  function handleClick(e: MouseEvent) {
    // Cmd/Ctrl+click: toggle selection without opening
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      selectionActions.toggleSelection(email.id, index);
      return;
    }

    // Shift+click: range selection
    if (e.shiftKey) {
      e.preventDefault();
      selectionActions.selectRange(index);
      return;
    }

    // Regular click: select and open email, clear multi-selection
    selectionActions.clearSelection();
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

  function handleCheckboxClick(e: MouseEvent) {
    e.stopPropagation();
    selectionActions.toggleSelection(email.id, index);
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
  class:checked
  onclick={handleClick}
  onmouseenter={handleMouseEnter}
  role="button"
  tabindex="0"
>
  <span
    class="checkbox"
    class:checked
    onclick={handleCheckboxClick}
    role="checkbox"
    aria-checked={checked}
    tabindex="-1"
  >
    {#if checked}
      <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
        <rect x="1" y="1" width="14" height="14" rx="2" fill="var(--accent)" />
        <path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    {:else}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" width="16" height="16">
        <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke-width="1.5"/>
      </svg>
    {/if}
  </span>

  <span
    class="star"
    class:starred={email.is_starred}
    onclick={handleStar}
    role="button"
    tabindex="-1"
  >
    <Star size={14} fill={email.is_starred ? "currentColor" : "none"} />
  </span>

  <div class="sender">
    {#if searchTerms.length > 0}
      <HighlightText text={email.from_name || email.from_email.split("@")[0]} {searchTerms} />
    {:else}
      {email.from_name || email.from_email.split("@")[0]}
    {/if}
  </div>

  <div class="content">
    <span class="subject">
      {#if searchTerms.length > 0}
        <HighlightText text={email.subject || "(no subject)"} {searchTerms} />
      {:else}
        {email.subject || "(no subject)"}
      {/if}
    </span>
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
    <span class="snippet">
      {#if searchTerms.length > 0}
        <HighlightText text={email.snippet} {searchTerms} />
      {:else}
        {email.snippet}
      {/if}
    </span>
  </div>

  {#if badge}
    <span class="tracked" class:opened={badge.opened} title={badge.title}>
      <Eye size={13} />{#if badge.opened}<span class="count">{badge.count}</span>{/if}
    </span>
  {/if}

  <div class="date" title={formatDateTooltip(email.received_at)}>{formatRelativeDate(email.received_at)}</div>
</div>

<style>
  .email-row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--row-h);
    padding: 0 12px 0 14px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    text-align: left;
    cursor: pointer;
    width: 100%;
    font-size: 13px;
    position: relative;
  }

  .email-row:hover {
    background: var(--bg-hover);
  }

  .email-row.selected,
  .email-row.unread.selected {
    background: var(--bg-selected);
  }

  .email-row.selected::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
  }

  .email-row.unread {
    background: var(--bg-unread);
  }

  .email-row.unread:hover {
    background: var(--bg-hover);
  }

  .email-row.unread .sender::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--unread);
    vertical-align: 1px;
  }

  .email-row.unread .sender,
  .email-row.unread .subject {
    font-weight: 600;
    color: var(--text-primary);
  }

  .checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-muted);
  }

  .checkbox:hover {
    color: var(--accent);
  }

  .email-row.checked {
    background: var(--bg-selected);
  }

  .star {
    display: inline-flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0;
    font-size: 14px;
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
    width: 170px;
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
    max-width: 50%;
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
    border-radius: var(--r-sm);
    border: 1px solid;
    white-space: nowrap;
    font-weight: 500;
  }

  .label-more {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .tracked {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }

  .tracked.opened {
    color: var(--accent);
    opacity: 1;
    font-weight: 600;
  }

  .date {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    width: 64px;
    text-align: right;
  }

  .email-row.unread .date {
    color: var(--unread);
    font-weight: 600;
  }
</style>
