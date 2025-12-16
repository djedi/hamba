<script lang="ts">
  import { onMount } from "svelte";

  let { children } = $props();

  let hasError = $state(false);
  let errorMessage = $state("");
  let errorStack = $state("");

  function handleError(error: Error | string, source?: string) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || "" : "";

    console.error("[ErrorBoundary]", message, stack);

    errorMessage = message;
    errorStack = stack;
    hasError = true;
  }

  function handleReset() {
    hasError = false;
    errorMessage = "";
    errorStack = "";
  }

  function handleReload() {
    window.location.reload();
  }

  onMount(() => {
    // Catch unhandled JS errors
    function onError(event: ErrorEvent) {
      event.preventDefault();
      handleError(event.error || event.message, "window.onerror");
    }

    // Catch unhandled promise rejections
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      event.preventDefault();
      const reason = event.reason;
      handleError(
        reason instanceof Error ? reason : new Error(String(reason)),
        "unhandledrejection"
      );
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  });
</script>

{#if hasError}
  <div class="error-boundary">
    <div class="error-content">
      <div class="error-icon">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h1>Something went wrong</h1>
      <p class="error-description">
        An unexpected error occurred. You can try again or reload the page.
      </p>
      {#if errorMessage}
        <div class="error-details">
          <p class="error-message">{errorMessage}</p>
        </div>
      {/if}
      <div class="error-actions">
        <button class="primary" onclick={handleReset}>
          Try Again
        </button>
        <button onclick={handleReload}>
          Reload Page
        </button>
      </div>
    </div>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .error-boundary {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    z-index: 10000;
  }

  .error-content {
    max-width: 480px;
    padding: 48px;
    text-align: center;
  }

  .error-icon {
    color: var(--danger);
    margin-bottom: 24px;
  }

  h1 {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px 0;
  }

  .error-description {
    color: var(--text-secondary);
    font-size: 15px;
    line-height: 1.5;
    margin: 0 0 24px 0;
  }

  .error-details {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 24px;
    text-align: left;
  }

  .error-message {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      "Liberation Mono", monospace;
    font-size: 13px;
    color: var(--danger);
    margin: 0;
    word-break: break-word;
  }

  .error-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  button {
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    transition: background 0.15s, border-color 0.15s;
  }

  button:hover {
    background: var(--bg-tertiary);
  }

  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  button.primary:hover {
    background: var(--accent-hover);
  }
</style>
