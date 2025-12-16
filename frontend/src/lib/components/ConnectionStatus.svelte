<script lang="ts">
  import { connectionState, reconnectAttempt, reconnectNow } from "$lib/realtime";
  import { isOnline } from "$lib/offline";
</script>

{#if !$isOnline}
  <div class="connection-status offline">
    <span class="status-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
        <line x1="12" y1="20" x2="12.01" y2="20"></line>
      </svg>
    </span>
    <span class="status-text">Offline</span>
  </div>
{:else if $connectionState === "disconnected" || $connectionState === "reconnecting"}
  <button class="connection-status reconnecting" onclick={reconnectNow}>
    <span class="status-icon">
      {#if $connectionState === "reconnecting"}
        <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6"></path>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      {/if}
    </span>
    <span class="status-text">
      {#if $connectionState === "reconnecting"}
        Reconnecting...
      {:else}
        Disconnected
      {/if}
    </span>
    {#if $reconnectAttempt > 0}
      <span class="attempt-badge">Retry {$reconnectAttempt}</span>
    {/if}
  </button>
{:else if $connectionState === "connecting"}
  <div class="connection-status connecting">
    <span class="status-icon">
      <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
      </svg>
    </span>
    <span class="status-text">Connecting...</span>
  </div>
{/if}

<style>
  .connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .connection-status.offline {
    background: var(--bg-tertiary);
    color: var(--text-muted);
  }

  .connection-status.reconnecting {
    background: var(--bg-tertiary);
    color: var(--warning, #f59e0b);
    border: 1px solid var(--warning, #f59e0b);
    cursor: pointer;
  }

  .connection-status.reconnecting:hover {
    background: var(--bg-hover);
  }

  .connection-status.connecting {
    background: var(--bg-tertiary);
    color: var(--text-muted);
  }

  .status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .status-text {
    flex: 1;
  }

  .attempt-badge {
    background: rgba(245, 158, 11, 0.2);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
