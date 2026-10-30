<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    accounts,
    accountActions,
    isAccountSwitcherOpen,
    selectedAccountId,
    unreadCounts,
  } from "$lib/stores";
  import type { Account } from "$lib/api";
  import AccountAvatar from "./AccountAvatar.svelte";

  let inputRef: HTMLInputElement | undefined = $state();
  let listRef: HTMLDivElement | undefined = $state();
  let query = $state("");
  let currentIndex = $state(0);

  function displayName(account: Account): string {
    return account.display_name || account.name || account.email;
  }

  function unreadFor(account: Account): number {
    return $unreadCounts[account.id] ?? account.unread_count ?? 0;
  }

  // Accounts matching the query (all accounts when empty), in list order
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return $accounts;
    return $accounts.filter(
      (a) =>
        a.email.toLowerCase().includes(q) ||
        (a.display_name || a.name || "").toLowerCase().includes(q)
    );
  });

  // Start on the first account that is not the current one, so Enter moves somewhere useful
  $effect(() => {
    const list = filtered;
    const current = $selectedAccountId;
    const next = list.findIndex((a) => a.id !== current);
    currentIndex = next === -1 ? 0 : next;
  });

  // Keep the highlighted row visible
  $effect(() => {
    const idx = currentIndex;
    tick().then(() => {
      const el = listRef?.querySelector<HTMLElement>(".result-item.selected");
      el?.scrollIntoView?.({ block: "nearest" });
    });
  });

  function close() {
    isAccountSwitcherOpen.set(false);
  }

  function choose(accountId: string) {
    accountActions.switchTo(accountId);
    close();
  }

  function move(delta: number) {
    const count = filtered.length;
    if (count === 0) return;
    currentIndex = Math.min(Math.max(currentIndex + delta, 0), count - 1);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Keys handled here must not reach the global shortcut handler
    e.stopPropagation();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        return;
      case "Enter":
        e.preventDefault();
        if (filtered[currentIndex]) choose(filtered[currentIndex].id);
        return;
      case "Escape":
        e.preventDefault();
        close();
        return;
    }

    // With an empty query, j/k move and 1-9 jump straight to an account
    if (!query) {
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        move(e.key === "j" ? 1 : -1);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = Number(e.key) - 1;
        if (index < $accounts.length) {
          accountActions.switchByIndex(index);
          close();
        }
      }
    }
  }

  onMount(() => {
    inputRef?.focus();
  });
</script>

<div
  class="backdrop"
  onclick={(e) => e.target === e.currentTarget && close()}
  onkeydown={(e) => e.key === "Escape" && close()}
  role="presentation"
  tabindex="-1"
>
  <div class="switcher slide-up" role="dialog" aria-modal="true" aria-label="Switch account">
    <div class="input-wrapper">
      <span class="icon">@</span>
      <input autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
        bind:this={inputRef}
        type="text"
        placeholder="Switch account..."
        aria-label="Filter accounts"
        bind:value={query}
        onkeydown={handleKeydown}
      />
    </div>

    <div class="results" bind:this={listRef}>
      {#each filtered as account, row (account.id)}
        {@const index = $accounts.indexOf(account)}
        {@const unread = unreadFor(account)}
        {@const isCurrent = account.id === $selectedAccountId}
        <button
          type="button"
          class="result-item"
          class:selected={row === currentIndex}
          onclick={() => choose(account.id)}
          onmouseenter={() => (currentIndex = row)}
        >
          <AccountAvatar {account} size={24} />
          <div class="result-content">
            <span class="result-label">{displayName(account)}</span>
            {#if displayName(account) !== account.email}
              <span class="result-sublabel">{account.email}</span>
            {/if}
          </div>
          <div class="result-meta">
            {#if isCurrent}
              <span class="current-tag">current</span>
            {/if}
            {#if unread > 0}
              <span class="unread-badge">{unread}</span>
            {/if}
            {#if index < 9}
              <kbd>{index + 1}</kbd>
            {/if}
          </div>
        </button>
      {:else}
        <div class="no-results">No accounts match "{query}"</div>
      {/each}
    </div>

    <div class="footer">
      <span class="hint"><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
      <span class="hint"><kbd>↵</kbd> to switch</span>
      <span class="hint"><kbd>1-9</kbd> jump</span>
      <span class="hint"><kbd>esc</kbd> to close</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 100px;
    z-index: 100;
  }

  .switcher {
    width: 560px;
    max-width: calc(100vw - 32px);
    max-height: 480px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .icon {
    font-size: 18px;
    color: var(--text-muted);
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    font-size: 16px;
    color: var(--text-primary);
    outline: none;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .result-item:hover,
  .result-item.selected {
    background: var(--bg-hover);
  }

  .result-item.selected {
    background: var(--accent);
  }

  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .result-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .result-label {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-sublabel {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .current-tag {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .unread-badge {
    min-width: 18px;
    padding: 1px 6px;
    border-radius: 9px;
    background: var(--accent);
    color: white;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
  }

  .result-item.selected .unread-badge {
    background: white;
    color: var(--accent);
  }

  kbd {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-family: inherit;
    color: var(--text-muted);
  }

  .no-results {
    padding: 16px 12px;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
  }

  .footer {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 16px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .hint {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .hint kbd {
    padding: 1px 4px;
    font-size: 10px;
  }
</style>
