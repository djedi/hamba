<script lang="ts">
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
    folder?: Folder;
  }

  let { loading = false, onLoadMore, folder = "inbox" }: Props = $props();

  // Determine the appropriate empty state based on context
  const emptyState = $derived.by(() => {
    // Search results have highest priority
    if ($searchQuery.length >= 2) {
      return {
        icon: "🔍",
        title: "No results found",
        description: `No emails match "${$searchQuery}". Try different keywords or search operators.`,
        variant: "default" as const,
      };
    }

    // Folder-specific empty states
    switch (folder) {
      case "inbox":
        return {
          icon: "🎉",
          title: "Inbox Zero!",
          description: "You've processed all your emails. Enjoy the moment!",
          variant: "success" as const,
        };

      case "starred":
        return {
          icon: "⭐",
          title: "No starred emails",
          description: "Star important emails to find them here later. Press 's' to star an email.",
          variant: "default" as const,
        };

      case "sent":
        return {
          icon: "📤",
          title: "No sent emails",
          description: "Emails you send will appear here.",
          variant: "default" as const,
        };

      case "trash":
        return {
          icon: "🗑️",
          title: "Trash is empty",
          description: "Deleted emails will appear here for 30 days before being permanently removed.",
          variant: "default" as const,
        };

      case "archive":
        return {
          icon: "📦",
          title: "No archived emails",
          description: "Archived emails are stored here. Press 'e' to archive an email.",
          variant: "default" as const,
        };

      case "snoozed":
        return {
          icon: "💤",
          title: "No snoozed emails",
          description: "Snoozed emails will reappear when their snooze time ends. Press 'h' to snooze.",
          variant: "default" as const,
        };

      case "reminders":
        return {
          icon: "🔔",
          title: "No reminders",
          description: "Set reminders to follow up on sent emails. Press 'Shift+H' to set a reminder.",
          variant: "default" as const,
        };

      case "label":
        const labelName = $selectedLabel?.name || "this label";
        return {
          icon: "🏷️",
          title: `No emails in ${labelName}`,
          description: "Emails you add to this label will appear here.",
          variant: "default" as const,
        };

      default:
        return {
          icon: "📭",
          title: "No emails",
          description: "Your inbox is empty. Click Sync to fetch new emails.",
          variant: "default" as const,
        };
    }
  });

  // Extract search terms from the current search query
  const searchTerms = $derived(extractSearchTerms($searchQuery));

  // Row height: 12px padding top + 12px padding bottom + ~21px content + 1px border = ~46px
  // Measured more precisely: the rows are approximately 46px tall
  const ROW_HEIGHT = 46;

  // Reference to virtual list for scrolling
  let virtualList: ReturnType<typeof VirtualList<Email>> | null = $state(null);

  // Track previous selected index to detect changes from keyboard navigation
  let prevSelectedIndex = $state(-1);

  // When selectedIndex changes (from keyboard navigation), scroll to that index
  $effect(() => {
    const idx = $selectedIndex;
    if (virtualList && idx !== prevSelectedIndex && idx >= 0) {
      virtualList.scrollToIndex(idx);
      prevSelectedIndex = idx;
    }
  });

  function getEmailKey(email: Email): string {
    return email.id;
  }
</script>

<div class="email-list">
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

  .skeleton-list {
    flex: 1;
    overflow: hidden;
  }
</style>
