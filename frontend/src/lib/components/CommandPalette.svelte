<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import {
    isCommandPaletteOpen,
    view,
    selectedEmailId,
    emails,
    currentFolder,
    labels,
    selectedAccountId,
    composeMode,
    replyToEmail,
    selectedLabelId,
    emailActions,
  } from "$lib/stores";
  import { api } from "$lib/api";
  import type { Contact, Email, Label } from "$lib/api";

  let inputRef: HTMLInputElement;
  let resultsRef: HTMLDivElement;
  let query = $state("");
  let currentIndex = $state(0);
  let isLoading = $state(false);

  // Search results from API
  let contactResults = $state<Contact[]>([]);
  let emailResults = $state<Email[]>([]);

  // Debounce timer for API searches
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Result item types
  type ResultType = "command" | "email" | "contact" | "label";

  interface ResultItem {
    id: string;
    type: ResultType;
    label: string;
    sublabel?: string;
    icon: string;
    shortcut?: string;
    action: () => void;
    score: number;
  }

  // Fuzzy search scoring
  function fuzzyScore(query: string, text: string): number {
    if (!query) return 1;

    const lowerQuery = query.toLowerCase();
    const lowerText = text.toLowerCase();

    // Exact match gets highest score
    if (lowerText === lowerQuery) return 100;

    // Starts with query
    if (lowerText.startsWith(lowerQuery)) return 90;

    // Contains query as substring
    if (lowerText.includes(lowerQuery)) return 70;

    // Fuzzy match - check if all query chars appear in order
    let queryIdx = 0;
    let score = 0;
    let consecutiveBonus = 0;
    let lastMatchIdx = -2;

    for (let i = 0; i < lowerText.length && queryIdx < lowerQuery.length; i++) {
      if (lowerText[i] === lowerQuery[queryIdx]) {
        // Bonus for consecutive matches
        if (i === lastMatchIdx + 1) {
          consecutiveBonus += 5;
        }
        // Bonus for matching at word boundaries
        if (i === 0 || lowerText[i - 1] === ' ' || lowerText[i - 1] === '-' || lowerText[i - 1] === '_') {
          score += 10;
        }
        score += 5 + consecutiveBonus;
        lastMatchIdx = i;
        queryIdx++;
      }
    }

    // All query chars must match
    if (queryIdx < lowerQuery.length) return 0;

    // Normalize score based on text length (prefer shorter matches)
    return Math.min(60, score - (lowerText.length - lowerQuery.length) * 0.5);
  }

  // Commands definition
  const commands: Array<{
    id: string;
    label: string;
    icon: string;
    shortcut?: string;
    keywords?: string[];
    action: () => void;
  }> = [
    {
      id: "inbox",
      label: "Go to Inbox",
      icon: "📥",
      shortcut: "g i",
      keywords: ["home", "main"],
      action: () => {
        currentFolder.set("inbox");
        view.set("inbox");
        close();
      },
    },
    {
      id: "compose",
      label: "Compose new email",
      icon: "✏️",
      shortcut: "c",
      keywords: ["new", "write", "create"],
      action: () => {
        composeMode.set("new");
        replyToEmail.set(null);
        view.set("compose");
        close();
      },
    },
    {
      id: "starred",
      label: "Go to Starred",
      icon: "⭐",
      shortcut: "g s",
      keywords: ["favorites", "important"],
      action: () => {
        currentFolder.set("starred");
        view.set("inbox");
        close();
      },
    },
    {
      id: "sent",
      label: "Go to Sent",
      icon: "📤",
      shortcut: "g t",
      keywords: ["outbox"],
      action: () => {
        currentFolder.set("sent");
        view.set("inbox");
        close();
      },
    },
    {
      id: "drafts",
      label: "Go to Drafts",
      icon: "📝",
      shortcut: "g d",
      action: () => {
        currentFolder.set("drafts");
        view.set("inbox");
        close();
      },
    },
    {
      id: "trash",
      label: "Go to Trash",
      icon: "🗑️",
      shortcut: "g x",
      keywords: ["deleted", "bin"],
      action: () => {
        currentFolder.set("trash");
        view.set("inbox");
        close();
      },
    },
    {
      id: "archive",
      label: "Go to Archive",
      icon: "📦",
      shortcut: "g a",
      keywords: ["all mail"],
      action: () => {
        currentFolder.set("archive");
        view.set("inbox");
        close();
      },
    },
    {
      id: "snoozed",
      label: "Go to Snoozed",
      icon: "😴",
      shortcut: "g h",
      keywords: ["later", "remind"],
      action: () => {
        currentFolder.set("snoozed");
        view.set("inbox");
        close();
      },
    },
    {
      id: "reminders",
      label: "Go to Reminders",
      icon: "🔔",
      shortcut: "g r",
      keywords: ["follow up"],
      action: () => {
        currentFolder.set("reminders");
        view.set("inbox");
        close();
      },
    },
    {
      id: "scheduled",
      label: "Go to Scheduled",
      icon: "🕐",
      shortcut: "g l",
      keywords: ["send later"],
      action: () => {
        currentFolder.set("scheduled");
        view.set("inbox");
        close();
      },
    },
    {
      id: "archive-email",
      label: "Archive selected email",
      icon: "📦",
      shortcut: "e",
      keywords: ["remove", "hide"],
      action: () => {
        const id = get(selectedEmailId);
        if (id) {
          emailActions.archive(id);
        }
        close();
      },
    },
    {
      id: "star-email",
      label: "Star/unstar selected email",
      icon: "⭐",
      shortcut: "s",
      keywords: ["favorite"],
      action: () => {
        const id = get(selectedEmailId);
        if (id) {
          emailActions.toggleStar(id);
        }
        close();
      },
    },
    {
      id: "trash-email",
      label: "Move to trash",
      icon: "🗑️",
      shortcut: "#",
      keywords: ["delete", "remove"],
      action: () => {
        const id = get(selectedEmailId);
        if (id) {
          emailActions.trash(id);
        }
        close();
      },
    },
    {
      id: "mark-read",
      label: "Toggle read/unread",
      icon: "👁️",
      shortcut: "Shift+I",
      keywords: ["seen", "unseen"],
      action: () => {
        const id = get(selectedEmailId);
        if (id) {
          emailActions.toggleRead(id);
        }
        close();
      },
    },
    {
      id: "search",
      label: "Search emails",
      icon: "🔍",
      shortcut: "/",
      keywords: ["find", "filter"],
      action: () => {
        close();
        // Focus search bar after closing
        setTimeout(() => {
          document.querySelector<HTMLInputElement>('.search-bar input')?.focus();
        }, 100);
      },
    },
    {
      id: "refresh",
      label: "Refresh / Sync emails",
      icon: "🔄",
      shortcut: "Shift+R",
      keywords: ["reload", "update", "fetch"],
      action: () => {
        close();
        // Trigger sync via keyboard handler
        const event = new KeyboardEvent('keydown', { key: 'R', shiftKey: true });
        window.dispatchEvent(event);
      },
    },
    {
      id: "shortcuts",
      label: "Show keyboard shortcuts",
      icon: "⌨️",
      shortcut: "?",
      keywords: ["help", "keys", "hotkeys"],
      action: () => {
        close();
        // Open shortcuts overlay
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', { key: '?' });
          window.dispatchEvent(event);
        }, 100);
      },
    },
  ];

  // Search for emails and contacts when query changes
  async function searchAsync(searchQuery: string) {
    const accountId = get(selectedAccountId);
    if (!accountId || searchQuery.length < 2) {
      emailResults = [];
      contactResults = [];
      return;
    }

    isLoading = true;
    try {
      // Search emails and contacts in parallel
      const [emailsRes, contactsRes] = await Promise.all([
        api.searchEmails(searchQuery, 5, accountId),
        api.searchContacts(accountId, searchQuery, 5),
      ]);
      emailResults = emailsRes;
      contactResults = contactsRes;
    } catch (e) {
      console.error("Command palette search error:", e);
      emailResults = [];
      contactResults = [];
    } finally {
      isLoading = false;
    }
  }

  // Debounced search effect
  $effect(() => {
    const q = query;
    if (searchTimer) clearTimeout(searchTimer);

    if (q.length >= 2) {
      searchTimer = setTimeout(() => searchAsync(q), 150);
    } else {
      emailResults = [];
      contactResults = [];
    }
  });

  // Build combined results
  let allResults = $derived.by(() => {
    const results: ResultItem[] = [];
    const lowerQuery = query.toLowerCase();

    // Add commands (always show some, filter by query)
    for (const cmd of commands) {
      // Check label and keywords
      const labelScore = fuzzyScore(query, cmd.label);
      const keywordScores = (cmd.keywords || []).map(k => fuzzyScore(query, k));
      const maxScore = Math.max(labelScore, ...keywordScores);

      if (!query || maxScore > 0) {
        results.push({
          id: `cmd-${cmd.id}`,
          type: "command",
          label: cmd.label,
          icon: cmd.icon,
          shortcut: cmd.shortcut,
          action: cmd.action,
          score: query ? maxScore : 50, // Default score when no query
        });
      }
    }

    // Add labels
    const allLabels = get(labels);
    for (const label of allLabels) {
      const score = fuzzyScore(query, label.name);
      if (!query || score > 0) {
        results.push({
          id: `label-${label.id}`,
          type: "label",
          label: `Go to label: ${label.name}`,
          icon: "🏷️",
          action: () => {
            selectedLabelId.set(label.id);
            currentFolder.set("label");
            view.set("inbox");
            close();
          },
          score: query ? score - 5 : 30, // Slightly lower priority than commands
        });
      }
    }

    // Add recent emails from current list (quick access without API)
    if (!query) {
      const currentEmails = get(emails);
      const recentEmails = currentEmails.slice(0, 5);
      for (const email of recentEmails) {
        results.push({
          id: `email-recent-${email.id}`,
          type: "email",
          label: email.subject || "(No subject)",
          sublabel: email.from_name || email.from_email,
          icon: email.is_read ? "📧" : "📬",
          action: () => {
            selectedEmailId.set(email.id);
            view.set("email");
            emailActions.markRead(email.id);
            close();
          },
          score: 20, // Lower priority for recent emails
        });
      }
    }

    // Add searched emails
    for (const email of emailResults) {
      results.push({
        id: `email-${email.id}`,
        type: "email",
        label: email.subject || "(No subject)",
        sublabel: email.from_name || email.from_email,
        icon: email.is_read ? "📧" : "📬",
        action: () => {
          selectedEmailId.set(email.id);
          view.set("email");
          emailActions.markRead(email.id);
          close();
        },
        score: 40, // Searched emails have good relevance
      });
    }

    // Add contacts
    for (const contact of contactResults) {
      results.push({
        id: `contact-${contact.id}`,
        type: "contact",
        label: contact.name || contact.email,
        sublabel: contact.name ? contact.email : undefined,
        icon: "👤",
        action: () => {
          // Open compose with this contact
          composeMode.set("new");
          replyToEmail.set(null);
          view.set("compose");
          close();
          // Set recipient after compose opens
          setTimeout(() => {
            const toInput = document.querySelector<HTMLInputElement>('input[placeholder="To"]');
            if (toInput) {
              toInput.value = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
              toInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, 100);
        },
        score: 35,
      });
    }

    // Sort by score (highest first) and limit results
    results.sort((a, b) => b.score - a.score);

    // When there's a query, only show results with positive scores
    // When no query, show top results
    const filtered = query
      ? results.filter(r => r.score > 0)
      : results;

    return filtered.slice(0, 15);
  });

  // Reset index when results change
  $effect(() => {
    // Access allResults to create dependency
    const _ = allResults.length;
    currentIndex = 0;
  });

  // Scroll selected item into view
  $effect(() => {
    const idx = currentIndex;
    tick().then(() => {
      const selectedEl = resultsRef?.querySelector('.result-item.selected');
      selectedEl?.scrollIntoView({ block: 'nearest' });
    });
  });

  function close() {
    isCommandPaletteOpen.set(false);
    query = "";
    currentIndex = 0;
    emailResults = [];
    contactResults = [];
    if (searchTimer) clearTimeout(searchTimer);
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        currentIndex = Math.min(currentIndex + 1, allResults.length - 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        currentIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          currentIndex = Math.max(currentIndex - 1, 0);
        } else {
          currentIndex = Math.min(currentIndex + 1, allResults.length - 1);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (allResults[currentIndex]) {
          allResults[currentIndex].action();
        }
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  // Type indicator text
  function getTypeLabel(type: ResultType): string {
    switch (type) {
      case "command": return "Command";
      case "email": return "Email";
      case "contact": return "Contact";
      case "label": return "Label";
    }
  }

  onMount(() => {
    inputRef?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true" tabindex="-1">
  <div class="palette slide-up">
    <div class="input-wrapper">
      <span class="icon">⌘</span>
      <input
        bind:this={inputRef}
        type="text"
        placeholder="Search commands, emails, contacts, labels..."
        bind:value={query}
        onkeydown={handleKeydown}
      />
      {#if isLoading}
        <span class="loading-indicator">...</span>
      {/if}
    </div>

    <div class="results" bind:this={resultsRef}>
      {#each allResults as result, index (result.id)}
        <button
          class="result-item"
          class:selected={index === currentIndex}
          onclick={() => result.action()}
          onmouseenter={() => (currentIndex = index)}
        >
          <span class="result-icon">{result.icon}</span>
          <div class="result-content">
            <span class="result-label">{result.label}</span>
            {#if result.sublabel}
              <span class="result-sublabel">{result.sublabel}</span>
            {/if}
          </div>
          <div class="result-meta">
            <span class="result-type">{getTypeLabel(result.type)}</span>
            {#if result.shortcut}
              <kbd>{result.shortcut}</kbd>
            {/if}
          </div>
        </button>
      {/each}

      {#if allResults.length === 0 && query}
        <div class="no-results">
          {#if isLoading}
            Searching...
          {:else}
            No results found for "{query}"
          {/if}
        </div>
      {/if}

      {#if !query && allResults.length === 0}
        <div class="no-results">Start typing to search...</div>
      {/if}
    </div>

    <div class="footer">
      <span class="hint"><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
      <span class="hint"><kbd>↵</kbd> to select</span>
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

  .palette {
    width: 560px;
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

  .loading-indicator {
    color: var(--text-muted);
    font-size: 14px;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
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

  .result-icon {
    font-size: 16px;
    width: 24px;
    text-align: center;
    flex-shrink: 0;
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

  .result-type {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
    padding: 32px 24px;
    text-align: center;
    color: var(--text-muted);
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
    padding: 1px 4px;
    font-size: 10px;
  }
</style>
