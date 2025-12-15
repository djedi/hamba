<script lang="ts">
  import { emails, selectedEmailId, selectedIndex } from "$lib/stores";
  import EmailRow from "./EmailRow.svelte";

  interface Props {
    loading?: boolean;
  }

  let { loading = false }: Props = $props();
</script>

<div class="email-list">
  {#if loading && $emails.length === 0}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading emails...</span>
    </div>
  {:else if $emails.length === 0}
    <div class="empty">
      <span class="empty-icon">📭</span>
      <h3>No emails</h3>
      <p>Your inbox is empty. Click Sync to fetch new emails.</p>
    </div>
  {:else}
    <div class="list">
      {#each $emails as email, index (email.id)}
        <EmailRow
          {email}
          selected={email.id === $selectedEmailId}
          {index}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .email-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .loading,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-secondary);
  }

  .loading .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--bg-tertiary);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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

  .list {
    display: flex;
    flex-direction: column;
  }
</style>
