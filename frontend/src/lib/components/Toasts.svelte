<script lang="ts">
  import { toasts, dismissToast } from "$lib/stores";
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <div class="toast" class:error={toast.type === "error"} class:success={toast.type === "success"}>
        <span class="toast-message">{toast.message}</span>
        {#if toast.action}
          <button
            class="toast-action"
            onclick={() => {
              toast.action?.onClick();
              dismissToast(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        {/if}
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
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.2s ease-out;
  }

  .toast-message {
    flex: 1;
  }

  .toast.error {
    background: var(--danger);
    color: white;
  }

  .toast.success {
    background: #22c55e;
    color: white;
  }

  .toast-action {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 4px;
    padding: 4px 12px;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .toast-action:hover {
    background: rgba(255, 255, 255, 0.35);
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
