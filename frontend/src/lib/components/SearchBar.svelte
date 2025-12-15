<script lang="ts">
  import { searchQuery, emails, isLoading } from "$lib/stores";
  import { api } from "$lib/api";

  let inputRef: HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout>;

  function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchQuery.set(value);

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (value.length >= 2) {
        isLoading.set(true);
        try {
          const results = await api.searchEmails(value);
          emails.set(results);
        } catch (err) {
          console.error("Search failed:", err);
        } finally {
          isLoading.set(false);
        }
      }
    }, 300);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      searchQuery.set("");
      inputRef?.blur();
    }
  }

  // Listen for / key to focus search
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (
      e.key === "/" &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      inputRef?.focus();
    }
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class="search-bar">
  <span class="search-icon">🔍</span>
  <input
    bind:this={inputRef}
    type="text"
    placeholder="Search emails... (press / to focus)"
    value={$searchQuery}
    oninput={handleInput}
    onkeydown={handleKeydown}
  />
  {#if $searchQuery}
    <button class="clear-btn" onclick={() => searchQuery.set("")}>
      ✕
    </button>
  {/if}
  <kbd class="shortcut-hint">/</kbd>
</div>

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .search-icon {
    font-size: 14px;
    color: var(--text-muted);
  }

  input {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    padding: 8px 12px;
    font-size: 14px;
  }

  input:focus {
    border-color: var(--accent);
    background: var(--bg-primary);
  }

  .clear-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
  }

  .clear-btn:hover {
    color: var(--text-primary);
  }

  .shortcut-hint {
    opacity: 0.5;
  }

  input:focus + .clear-btn + .shortcut-hint,
  input:focus ~ .shortcut-hint {
    display: none;
  }
</style>
