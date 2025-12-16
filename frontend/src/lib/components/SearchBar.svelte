<script lang="ts">
  import { searchQuery, emails, isLoading, currentFolder, selectedAccountId, view, selectedEmailId } from "$lib/stores";
  import { api } from "$lib/api";

  let inputRef: HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout>;
  let isFocused = $state(false);
  let showOperatorHelp = $state(false);

  // Track if we're currently showing search results
  let isSearchActive = $derived($searchQuery.length >= 2);

  const operators = [
    { key: "from:", desc: "Sender email/name", example: "from:john@example.com" },
    { key: "to:", desc: "Recipient email", example: "to:team@company.com" },
    { key: "subject:", desc: "Subject line", example: 'subject:"project update"' },
    { key: "has:attachment", desc: "Has attachments", example: "has:attachment" },
    { key: "is:unread", desc: "Unread emails", example: "is:unread" },
    { key: "is:starred", desc: "Starred emails", example: "is:starred" },
    { key: "before:", desc: "Before date", example: "before:2024-12-01" },
    { key: "after:", desc: "After date", example: "after:2024-01-01" },
  ];

  async function performSearch(value: string) {
    if (value.length >= 2) {
      isLoading.set(true);
      try {
        const accountId = $selectedAccountId;
        const results = await api.searchEmails(value, 50, accountId || undefined);
        emails.set(results);
        // Go back to inbox view to show results (but keep in "search" state via searchQuery)
        view.set("inbox");
        selectedEmailId.set(null);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        isLoading.set(false);
      }
    }
  }

  function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchQuery.set(value);

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => performSearch(value), 300);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      clearSearch();
      inputRef?.blur();
    } else if (e.key === "Enter") {
      // Immediate search on Enter
      clearTimeout(debounceTimer);
      performSearch($searchQuery);
    }
  }

  function clearSearch() {
    searchQuery.set("");
    showOperatorHelp = false;
  }

  function handleFocus() {
    isFocused = true;
  }

  function handleBlur() {
    isFocused = false;
    // Delay hiding operator help so clicks on it work
    setTimeout(() => {
      showOperatorHelp = false;
    }, 200);
  }

  function insertOperator(operator: string) {
    const currentValue = $searchQuery;
    const newValue = currentValue ? `${currentValue} ${operator}` : operator;
    searchQuery.set(newValue);
    inputRef?.focus();
    // Position cursor after the operator
    setTimeout(() => {
      if (inputRef) {
        inputRef.selectionStart = inputRef.selectionEnd = newValue.length;
      }
    }, 0);
  }

  function toggleOperatorHelp() {
    showOperatorHelp = !showOperatorHelp;
    if (showOperatorHelp) {
      inputRef?.focus();
    }
  }

  // Listen for / key to focus search
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (
      e.key === "/" &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !(e.target as HTMLElement)?.isContentEditable
    ) {
      e.preventDefault();
      inputRef?.focus();
    }
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class="search-container" class:active={isSearchActive}>
  <div class="search-bar" class:focused={isFocused}>
    <svg class="search-icon" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
      <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
    </svg>
    <input
      bind:this={inputRef}
      type="text"
      placeholder="Search emails..."
      value={$searchQuery}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={handleFocus}
      onblur={handleBlur}
    />
    {#if $searchQuery}
      <button class="clear-btn" onclick={clearSearch} title="Clear search (Esc)">
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    {/if}
    <button
      class="operator-btn"
      class:active={showOperatorHelp}
      onclick={toggleOperatorHelp}
      title="Search operators"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" />
      </svg>
    </button>
    {#if !isFocused && !$searchQuery}
      <kbd class="shortcut-hint">/</kbd>
    {/if}
  </div>

  {#if showOperatorHelp && isFocused}
    <div class="operator-help">
      <div class="operator-help-header">Search Operators</div>
      <div class="operator-list">
        {#each operators as op}
          <button class="operator-item" onclick={() => insertOperator(op.key)}>
            <code class="operator-key">{op.key}</code>
            <span class="operator-desc">{op.desc}</span>
          </button>
        {/each}
      </div>
      <div class="operator-help-footer">
        Click to insert, combine multiple operators
      </div>
    </div>
  {/if}

  {#if isSearchActive}
    <div class="search-status">
      <span class="search-label">Search results for:</span>
      <span class="search-query">{$searchQuery}</span>
      <button class="back-btn" onclick={clearSearch}>
        <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
        Clear
      </button>
    </div>
  {/if}
</div>

<style>
  .search-container {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .search-container.active {
    background: var(--bg-primary);
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    position: relative;
  }

  .search-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .search-bar.focused .search-icon {
    color: var(--accent);
  }

  input {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 14px;
    color: var(--text-primary);
    transition: all 0.15s ease;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg-primary);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  }

  .clear-btn,
  .operator-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .clear-btn:hover,
  .operator-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .operator-btn.active {
    color: var(--accent);
    background: rgba(99, 102, 241, 0.1);
  }

  .shortcut-hint {
    font-size: 11px;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
  }

  .operator-help {
    position: absolute;
    top: 100%;
    left: 16px;
    right: 16px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    margin-top: 4px;
    overflow: hidden;
  }

  .operator-help-header {
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .operator-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px;
    padding: 8px;
  }

  .operator-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }

  .operator-item:hover {
    background: var(--bg-tertiary);
  }

  .operator-key {
    font-family: monospace;
    font-size: 12px;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    color: var(--accent);
    white-space: nowrap;
  }

  .operator-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .operator-help-footer {
    padding: 8px 14px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .search-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: rgba(99, 102, 241, 0.05);
    border-top: 1px solid var(--border);
  }

  .search-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .search-query {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    font-family: monospace;
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 4px;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 4px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .back-btn:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
</style>
