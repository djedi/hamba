<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  interface ShortcutCategory {
    name: string;
    shortcuts: { key: string; description: string }[];
  }

  const categories: ShortcutCategory[] = [
    {
      name: "Navigation",
      shortcuts: [
        { key: "j", description: "Move down" },
        { key: "k", description: "Move up" },
        { key: "Enter / o", description: "Open email" },
        { key: "Escape / u", description: "Back to inbox" },
        { key: "Space", description: "Scroll down" },
        { key: "Shift + Space", description: "Scroll up" },
        { key: "g then g", description: "Go to top" },
        { key: "Shift + G", description: "Go to bottom" },
      ],
    },
    {
      name: "Actions",
      shortcuts: [
        { key: "e / y", description: "Archive" },
        { key: "# / Delete", description: "Trash" },
        { key: "s", description: "Toggle star" },
        { key: "!", description: "Toggle important" },
        { key: "Shift + I", description: "Toggle read/unread" },
        { key: "h", description: "Snooze" },
        { key: "Shift + H", description: "Set reminder" },
      ],
    },
    {
      name: "Compose",
      shortcuts: [
        { key: "c", description: "Compose new email" },
        { key: "r", description: "Reply" },
        { key: "a", description: "Reply all" },
        { key: "f", description: "Forward" },
        { key: "Cmd + J", description: "AI compose" },
        { key: "Cmd + Enter", description: "Send email" },
      ],
    },
    {
      name: "Go To",
      shortcuts: [
        { key: "g then i", description: "Go to Inbox" },
        { key: "g then s", description: "Go to Starred" },
        { key: "g then t", description: "Go to Sent" },
        { key: "g then d", description: "Go to Drafts" },
        { key: "g then x", description: "Go to Trash" },
        { key: "g then a", description: "Go to Archive" },
        { key: "g then h", description: "Go to Snoozed" },
        { key: "g then r", description: "Go to Reminders" },
        { key: "g then l", description: "Go to Scheduled" },
      ],
    },
    {
      name: "Split Inbox",
      shortcuts: [
        { key: "1", description: "Important tab" },
        { key: "2", description: "Other tab" },
        { key: "3", description: "All tab" },
      ],
    },
    {
      name: "Other",
      shortcuts: [
        { key: "/", description: "Search" },
        { key: "Cmd + K", description: "Command palette" },
        { key: "Shift + R", description: "Refresh/sync" },
        { key: "?", description: "Show this help" },
      ],
    },
  ];

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "?") {
      e.preventDefault();
      onClose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  onMount(() => {
    const overlay = document.querySelector(".shortcut-overlay") as HTMLElement;
    overlay?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="backdrop"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
  role="dialog"
  aria-modal="true"
  aria-label="Keyboard shortcuts"
  tabindex="-1"
>
  <div class="shortcut-overlay slide-up" tabindex="-1">
    <div class="header">
      <h2>Keyboard Shortcuts</h2>
      <button class="close-btn" onclick={onClose} aria-label="Close">
        <span>Esc</span>
      </button>
    </div>

    <div class="content">
      {#each categories as category (category.name)}
        <div class="category">
          <h3>{category.name}</h3>
          <div class="shortcuts">
            {#each category.shortcuts as shortcut (shortcut.key)}
              <div class="shortcut-row">
                <span class="description">{shortcut.description}</span>
                <span class="keys">
                  {#each shortcut.key.split(" + ") as part, i}
                    {#if part === "then"}
                      <span class="separator">then</span>
                    {:else}
                      {#if i > 0 && shortcut.key.split(" + ")[i-1] !== "then"}<span class="plus">+</span>{/if}
                      <kbd>{part}</kbd>
                    {/if}
                  {/each}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 60px;
    z-index: 100;
    overflow-y: auto;
  }

  .shortcut-overlay {
    width: 680px;
    max-width: 90vw;
    max-height: calc(100vh - 120px);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    outline: none;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .header h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .content {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
    padding: 20px;
    overflow-y: auto;
  }

  .category {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .category h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin: 0 0 4px 0;
  }

  .shortcuts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .description {
    font-size: 13px;
    color: var(--text-primary);
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    box-shadow: 0 1px 0 var(--border);
  }

  .separator {
    font-size: 11px;
    color: var(--text-muted);
    padding: 0 2px;
  }

  .plus {
    font-size: 10px;
    color: var(--text-muted);
  }

  @media (max-width: 600px) {
    .content {
      grid-template-columns: 1fr;
    }

    .shortcut-overlay {
      width: 95vw;
    }
  }
</style>
