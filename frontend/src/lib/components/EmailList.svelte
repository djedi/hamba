<script lang="ts">
  import { emails, selectedEmailId, selectedIndex, searchQuery, isLoadingMore, hasMoreEmails } from "$lib/stores";
  import { extractSearchTerms } from "$lib/search";
  import EmailRow from "./EmailRow.svelte";
  import EmailRowSkeleton from "./EmailRowSkeleton.svelte";
  import VirtualList from "./VirtualList.svelte";
  import type { Email } from "$lib/api";

  interface Props {
    loading?: boolean;
    onLoadMore?: () => void;
  }

  let { loading = false, onLoadMore }: Props = $props();

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
    <div class="empty">
      <span class="empty-icon">📭</span>
      <h3>No emails</h3>
      <p>Your inbox is empty. Click Sync to fetch new emails.</p>
    </div>
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

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-secondary);
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
</style>
