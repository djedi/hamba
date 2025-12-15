<script lang="ts">
  import { toasts } from "$lib/stores";
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <div class="toast" class:error={toast.type === "error"} class:success={toast.type === "success"}>
        {toast.message}
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 9999;
  }

  .toast {
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.2s ease-out;
  }

  .toast.error {
    background: var(--danger);
    color: white;
  }

  .toast.success {
    background: #22c55e;
    color: white;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>
