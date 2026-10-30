<script lang="ts">
  import { Archive, Bell, Inbox, Moon, PartyPopper, RefreshCw, Search, Send, Star, Tag, Trash2 } from "@lucide/svelte";
  import { isMobile } from "$lib/mobile";
  import { emails, selectedEmailId, selectedIndex, searchQuery, isLoadingMore, hasMoreEmails, selectedLabel, selectedEmailIds } from "$lib/stores";
  import type { Folder } from "$lib/stores";
  import { extractSearchTerms } from "$lib/search";
  import EmailRow from "./EmailRow.svelte";
  import EmailRowSkeleton from "./EmailRowSkeleton.svelte";
  import EmptyState from "./EmptyState.svelte";
  import VirtualList from "./VirtualList.svelte";
  import type { Email } from "$lib/api";

  interface Props {
    loading?: boolean;
    onLoadMore?: () => void;
    /** Pull-to-refresh on touch screens */
    onRefresh?: () => Promise<void> | void;
    folder?: Folder;
  }

  let { loading = false, onLoadMore, onRefresh, folder = "inbox" }: Props = $props();

  // Determine the appropriate empty state based on context
  const emptyState = $derived.by(() => {
    // Search results have highest priority
    if ($searchQuery.length >= 2) {
      return {
        icon: Search,
        title: "No results found",
        description: `No emails match "${$searchQuery}". Try different keywords or search operators.`,
        variant: "default" as const,
      };
    }

    // Folder-specific empty states
    switch (folder) {
      case "inbox":
        return {
          icon: PartyPopper,
          title: "Inbox Zero!",
          description: "You've processed all your emails. Enjoy the moment!",
          variant: "success" as const,
        };

      case "starred":
        return {
          icon: Star,
          title: "No starred emails",
          description: "Star important emails to find them here later. Press 's' to star an email.",
          variant: "default" as const,
        };

      case "sent":
        return {
          icon: Send,
          title: "No sent emails",
          description: "Emails you send will appear here.",
          variant: "default" as const,
        };

      case "trash":
        return {
          icon: Trash2,
          title: "Trash is empty",
          description: "Deleted emails will appear here for 30 days before being permanently removed.",
          variant: "default" as const,
        };

      case "archive":
        return {
          icon: Archive,
          title: "No archived emails",
          description: "Archived emails are stored here. Press 'e' to archive an email.",
          variant: "default" as const,
        };

      case "snoozed":
        return {
          icon: Moon,
          title: "No snoozed emails",
          description: "Snoozed emails will reappear when their snooze time ends. Press 'h' to snooze.",
          variant: "default" as const,
        };

      case "reminders":
        return {
          icon: Bell,
          title: "No reminders",
          description: "Set reminders to follow up on sent emails. Press 'Shift+H' to set a reminder.",
          variant: "default" as const,
        };

      case "label":
        const labelName = $selectedLabel?.name || "this label";
        return {
          icon: Tag,
          title: `No emails in ${labelName}`,
          description: "Emails you add to this label will appear here.",
          variant: "default" as const,
        };

      default:
        return {
          icon: Inbox,
          title: "No emails",
          description: "Your inbox is empty. Click Sync to fetch new emails.",
          variant: "default" as const,
        };
    }
  });

  // Extract search terms from the current search query
  const searchTerms = $derived(extractSearchTerms($searchQuery));

  // Row height must match --row-h in app.css (40px; 72px two-line rows on phones)
  const ROW_HEIGHT = $derived($isMobile ? 72 : 40);

  // ---- Pull to refresh (only when the list is scrolled to the top) ----
  const PULL_TRIGGER = 70;
  let pullStartY: number | null = null;
  let pull = $state(0);
  let refreshing = $state(false);

  function onPullStart(e: TouchEvent) {
    if (!onRefresh || refreshing || e.touches.length !== 1) return;
    pullStartY = getScrollTop() <= 0 ? e.touches[0].clientY : null;
  }

  function onPullMove(e: TouchEvent) {
    if (pullStartY === null) return;
    const dy = e.touches[0].clientY - pullStartY;
    // Dampened so it feels elastic
    pull = dy > 0 && getScrollTop() <= 0 ? Math.min(dy * 0.5, 100) : 0;
  }

  async function onPullEnd() {
    if (pullStartY === null) return;
    pullStartY = null;
    if (pull >= PULL_TRIGGER && onRefresh) {
      refreshing = true;
      pull = PULL_TRIGGER;
      try {
        await onRefresh();
      } finally {
        refreshing = false;
        pull = 0;
      }
    } else {
      pull = 0;
    }
  }

  // Reference to virtual list for scrolling
  let virtualList: ReturnType<typeof VirtualList<Email>> | null = $state(null);

  // Track previous selected index to detect changes from keyboard navigation
  let prevSelectedIndex = $state(-1);
  let lastFirstId: string | null | undefined = undefined;

  // When selectedIndex changes (from keyboard navigation), scroll to that index.
  // A different list (account/folder switch) resets the tracking so the selection is revealed.
  // Keyed on the first email rather than array identity: every optimistic update (star, read,
  // background merge) creates a new array and must not yank the user's scroll position.
  $effect(() => {
    const idx = $selectedIndex;
    const firstId = $emails[0]?.id ?? null;
    if (firstId !== lastFirstId) {
      lastFirstId = firstId;
      prevSelectedIndex = -1;
    }
    if (virtualList && idx !== prevSelectedIndex && idx >= 0) {
      virtualList.scrollToIndex(idx);
      prevSelectedIndex = idx;
    }
  });

  // Scroll position of the list, used to restore a cached list
  export function getScrollTop(): number {
    return virtualList?.getScrollTop() ?? 0;
  }

  export function setScrollTop(top: number) {
    virtualList?.setScrollTop(top);
  }

  function getEmailKey(email: Email): string {
    return email.id;
  }
</script>

<div
  class="email-list"
  ontouchstart={onPullStart}
  ontouchmove={onPullMove}
  ontouchend={onPullEnd}
  ontouchcancel={onPullEnd}
>
  {#if pull > 0 || refreshing}
    <div class="pull-indicator" style:height="{pull}px" aria-live="polite">
      <span class="pull-icon" class:spinning={refreshing} style:transform={refreshing ? undefined : `rotate(${pull * 3}deg)`}>
        <RefreshCw size={18} />
      </span>
    </div>
  {/if}
  {#if loading && $emails.length === 0}
    <div class="skeleton-list">
      {#each Array(10) as _, i (i)}
        <EmailRowSkeleton />
      {/each}
    </div>
  {:else if $emails.length === 0}
    <EmptyState
      icon={emptyState.icon}
      title={emptyState.title}
      description={emptyState.description}
      variant={emptyState.variant}
    />
  {:else}
    <VirtualList
      bind:this={virtualList}
      items={$emails}
      itemHeight={ROW_HEIGHT}
      getKey={getEmailKey}
      overscan={5}
      {onLoadMore}
      isLoadingMore={$isLoadingMore}
      hasMore={$hasMoreEmails}
    >
      {#snippet children({ item: email, index })}
        <EmailRow
          {email}
          selected={email.id === $selectedEmailId}
          checked={$selectedEmailIds.has(email.id)}
          {index}
          {searchTerms}
        />
      {/snippet}
    </VirtualList>
  {/if}
</div>

<style>
  .email-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .pull-indicator {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--text-muted);
  }

  .pull-icon {
    display: inline-flex;
  }

  .pull-icon.spinning {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .skeleton-list {
    flex: 1;
    overflow: hidden;
  }
</style>
