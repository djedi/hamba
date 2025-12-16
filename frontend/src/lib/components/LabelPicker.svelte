<script lang="ts">
  import { onMount, tick } from "svelte";
  import { labels, emailLabelsCache, labelActions, showToast } from "$lib/stores";
  import type { Label } from "$lib/api";

  interface Props {
    emailId: string;
    onClose: () => void;
  }

  let { emailId, onClose }: Props = $props();
  let query = $state("");
  let currentIndex = $state(0);
  let inputRef: HTMLInputElement | undefined = $state();
  let listRef: HTMLDivElement | undefined = $state();

  // Get all user labels from the store
  const allLabels = $derived($labels.filter((l) => l.type === "user"));

  // Get labels currently assigned to this email
  const emailLabels = $derived($emailLabelsCache.get(emailId) || []);

  // Fuzzy-filtered labels based on query
  const filteredLabels = $derived.by(() => {
    if (!query.trim()) return allLabels;

    const lowerQuery = query.toLowerCase();
    return allLabels
      .filter((label) => label.name.toLowerCase().includes(lowerQuery))
      .sort((a, b) => {
        // Prioritize starts-with matches
        const aStarts = a.name.toLowerCase().startsWith(lowerQuery);
        const bStarts = b.name.toLowerCase().startsWith(lowerQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.name.localeCompare(b.name);
      });
  });

  // Check if a label is assigned to the email
  function isLabelAssigned(labelId: string): boolean {
    return emailLabels.some((l) => l.id === labelId);
  }

  // Toggle label assignment
  async function toggleLabel(label: Label) {
    if (isLabelAssigned(label.id)) {
      await labelActions.removeLabelFromEmail(label.id, emailId);
      showToast(`Removed "${label.name}"`, "success");
    } else {
      await labelActions.addLabelToEmail(label.id, emailId);
      showToast(`Added "${label.name}"`, "success");
    }
  }

  // Keyboard navigation
  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
      case "j":
        if (e.key === "j" && query) return; // Allow typing 'j' in search
        e.preventDefault();
        currentIndex = Math.min(currentIndex + 1, filteredLabels.length - 1);
        scrollSelectedIntoView();
        break;
      case "ArrowUp":
      case "k":
        if (e.key === "k" && query) return; // Allow typing 'k' in search
        e.preventDefault();
        currentIndex = Math.max(currentIndex - 1, 0);
        scrollSelectedIntoView();
        break;
      case "Enter":
        e.preventDefault();
        if (filteredLabels[currentIndex]) {
          toggleLabel(filteredLabels[currentIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  function scrollSelectedIntoView() {
    tick().then(() => {
      const selectedEl = listRef?.querySelector(".label-option.selected");
      selectedEl?.scrollIntoView({ block: "nearest" });
    });
  }

  // Reset index when filtered results change
  $effect(() => {
    const _ = filteredLabels.length;
    currentIndex = Math.min(currentIndex, Math.max(0, filteredLabels.length - 1));
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  onMount(() => {
    // Focus the search input
    inputRef?.focus();

    // Load labels for this email if not cached
    labelActions.loadLabelsForEmail(emailId);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="backdrop"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <div class="label-picker slide-up">
    <div class="header">
      <span class="title">Labels</span>
    </div>

    <div class="search-wrapper">
      <input
        bind:this={inputRef}
        type="text"
        placeholder="Search labels..."
        bind:value={query}
      />
    </div>

    <div class="labels-list" bind:this={listRef}>
      {#each filteredLabels as label, index (label.id)}
        <button
          class="label-option"
          class:selected={index === currentIndex}
          onclick={() => toggleLabel(label)}
          onmouseenter={() => (currentIndex = index)}
        >
          <span class="checkbox" class:checked={isLabelAssigned(label.id)}>
            {#if isLabelAssigned(label.id)}
              <svg viewBox="0 0 16 16" width="16" height="16">
                <rect x="1" y="1" width="14" height="14" rx="2" fill="var(--accent)" />
                <path
                  d="M4.5 8L7 10.5L11.5 5.5"
                  stroke="white"
                  stroke-width="2"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else}
              <svg viewBox="0 0 16 16" width="16" height="16">
                <rect
                  x="1.5"
                  y="1.5"
                  width="13"
                  height="13"
                  rx="1.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
              </svg>
            {/if}
          </span>
          <span class="label-color" style="background-color: {label.color}"></span>
          <span class="label-name">{label.name}</span>
        </button>
      {/each}

      {#if filteredLabels.length === 0}
        <div class="no-results">
          {#if query}
            No labels matching "{query}"
          {:else}
            No labels available. Create labels in Settings.
          {/if}
        </div>
      {/if}
    </div>

    <div class="footer">
      <span class="hint"><kbd>j</kbd><kbd>k</kbd> navigate</span>
      <span class="hint"><kbd>Enter</kbd> toggle</span>
      <span class="hint"><kbd>Esc</kbd> close</span>
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
    padding-top: 120px;
    z-index: 100;
  }

  .label-picker {
    width: 340px;
    max-height: 420px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .search-wrapper {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .search-wrapper input {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
  }

  .search-wrapper input:focus {
    border-color: var(--accent);
  }

  .search-wrapper input::placeholder {
    color: var(--text-muted);
  }

  .labels-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    max-height: 260px;
  }

  .label-option {
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

  .label-option:hover,
  .label-option.selected {
    background: var(--bg-hover);
  }

  .label-option.selected {
    background: var(--accent);
  }

  .checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .label-option.selected .checkbox {
    color: white;
  }

  .label-color {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .label-name {
    flex: 1;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-results {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
  }

  .footer {
    display: flex;
    justify-content: center;
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
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 5px;
    font-size: 11px;
    font-family: inherit;
  }
</style>
