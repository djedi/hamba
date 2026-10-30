<script lang="ts">
  import { Plus } from "@lucide/svelte";
  import { accounts, selectedAccountId, unreadCounts } from "$lib/stores";
  import AccountAvatar from "./AccountAvatar.svelte";

  interface Props {
    onAddAccount: () => void;
  }

  let { onAddAccount }: Props = $props();
</script>

<!-- Fixed-width account rail: stays put regardless of sidebar content -->
<nav class="account-rail" aria-label="Accounts">
  {#each $accounts as account, i (account.id)}
    {@const unread = $unreadCounts[account.id] ?? account.unread_count ?? 0}
    <button
      class="rail-account"
      class:active={account.id === $selectedAccountId}
      class:has-unread={unread > 0}
      onclick={() => selectedAccountId.set(account.id)}
      title={`${account.display_name || account.email} — ${account.email}${i < 9 ? ` (Ctrl+${i + 1})` : ""}`}
      aria-label={`Switch to ${account.email}${unread > 0 ? `, ${unread} unread` : ""}`}
      aria-current={account.id === $selectedAccountId ? "true" : undefined}
    >
      <span class="indicator"></span>
      <AccountAvatar {account} size={32} />
      {#if unread > 0}
        <span class="badge">{unread > 99 ? "99+" : unread}</span>
      {/if}
    </button>
  {/each}
  <button class="rail-add" onclick={onAddAccount} title="Add account" aria-label="Add account">
    <Plus size={16} />
  </button>
</nav>

<style>
  .account-rail {
    flex-shrink: 0;
    width: 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
    overflow-y: auto;
  }

  .rail-account {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.1s ease-out;
  }

  .rail-account:hover,
  .rail-account.active,
  .rail-account.has-unread {
    opacity: 1;
  }

  .indicator {
    position: absolute;
    left: 0;
    width: 3px;
    height: 0;
    border-radius: 0 2px 2px 0;
    background: var(--account-color);
    transition: height 0.1s ease-out;
  }

  .rail-account:hover .indicator {
    height: 10px;
    background: var(--text-muted);
  }

  .rail-account.active .indicator {
    height: 24px;
    background: var(--account-color);
    box-shadow: 0 0 6px var(--account-glow);
  }

  .rail-account.active :global(.avatar),
  .rail-account.active :global(img) {
    filter: drop-shadow(0 0 5px var(--account-glow));
  }

  .badge {
    position: absolute;
    top: 0;
    right: 6px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: white;
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 0 0 2px var(--bg-secondary);
  }

  .rail-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px dashed var(--border);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .rail-add :global(svg) {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .rail-add:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .rail-account,
    .indicator {
      transition: none;
    }
  }
</style>
