<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { isCommandPaletteOpen, view, selectedEmailId, emails } from "$lib/stores";
  import { api } from "$lib/api";

  let inputRef: HTMLInputElement;
  let query = $state("");
  let currentIndex = $state(0);

  interface Command {
    id: string;
    label: string;
    shortcut?: string;
    action: () => void;
  }

  const commands: Command[] = [
    {
      id: "inbox",
      label: "Go to Inbox",
      shortcut: "g i",
      action: () => {
        view.set("inbox");
        close();
      },
    },
    {
      id: "compose",
      label: "Compose new email",
      shortcut: "c",
      action: () => {
        view.set("compose");
        close();
      },
    },
    {
      id: "archive",
      label: "Archive selected email",
      shortcut: "e",
      action: async () => {
        const id = get(selectedEmailId);
        if (id) {
          await api.archive(id);
          emails.update((list) => list.filter((e) => e.id !== id));
        }
        close();
      },
    },
    {
      id: "star",
      label: "Star/unstar selected email",
      shortcut: "s",
      action: async () => {
        const id = get(selectedEmailId);
        const emailList = get(emails);
        const email = emailList.find((e) => e.id === id);
        if (email && id) {
          if (email.is_starred) {
            await api.unstar(id);
            emails.update((list) =>
              list.map((e) => (e.id === id ? { ...e, is_starred: 0 } : e))
            );
          } else {
            await api.star(id);
            emails.update((list) =>
              list.map((e) => (e.id === id ? { ...e, is_starred: 1 } : e))
            );
          }
        }
        close();
      },
    },
    {
      id: "trash",
      label: "Move to trash",
      shortcut: "#",
      action: async () => {
        const id = get(selectedEmailId);
        if (id) {
          await api.trash(id);
          emails.update((list) => list.filter((e) => e.id !== id));
        }
        close();
      },
    },
    {
      id: "search",
      label: "Search emails",
      shortcut: "/",
      action: () => {
        close();
        document.querySelector<HTMLInputElement>('.search-bar input')?.focus();
      },
    },
  ];

  let filteredCommands = $derived(
    query
      ? commands.filter((c) =>
          c.label.toLowerCase().includes(query.toLowerCase())
        )
      : commands
  );

  function close() {
    isCommandPaletteOpen.set(false);
    query = "";
    currentIndex = 0;
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        currentIndex = Math.min(currentIndex + 1, filteredCommands.length - 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        currentIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Enter":
        e.preventDefault();
        if (filteredCommands[currentIndex]) {
          filteredCommands[currentIndex].action();
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
        placeholder="Type a command..."
        bind:value={query}
        onkeydown={handleKeydown}
      />
    </div>

    <div class="commands">
      {#each filteredCommands as command, index (command.id)}
        <button
          class="command"
          class:selected={index === currentIndex}
          onclick={() => command.action()}
          onmouseenter={() => (currentIndex = index)}
        >
          <span class="label">{command.label}</span>
          {#if command.shortcut}
            <kbd>{command.shortcut}</kbd>
          {/if}
        </button>
      {/each}

      {#if filteredCommands.length === 0}
        <div class="no-results">No commands found</div>
      {/if}
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

  .palette {
    width: 500px;
    max-height: 400px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
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

  .commands {
    max-height: 300px;
    overflow-y: auto;
    padding: 8px;
  }

  .command {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .command:hover,
  .command.selected {
    background: var(--bg-hover);
  }

  .command.selected {
    background: var(--accent);
  }

  .label {
    flex: 1;
  }

  .no-results {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
  }
</style>
