<script lang="ts">
  import { api, type Contact } from "$lib/api";
  import { selectedAccountId } from "$lib/stores";
  import { get } from "svelte/store";

  interface Props {
    value: string;
    placeholder?: string;
    id?: string;
    onchange?: (value: string) => void;
  }

  let { value = $bindable(), placeholder = "", id = "", onchange }: Props = $props();

  let inputElement: HTMLInputElement;
  let contacts = $state<Contact[]>([]);
  let showDropdown = $state(false);
  let selectedIndex = $state(0);
  let loading = $state(false);
  let searchQuery = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let dropdownElement: HTMLDivElement;

  // Get the current token being edited (after the last comma)
  function getCurrentToken(inputValue: string, cursorPos: number): { token: string; start: number; end: number } {
    // Find the start of the current token (after last comma before cursor)
    const beforeCursor = inputValue.slice(0, cursorPos);
    const lastCommaBeforeCursor = beforeCursor.lastIndexOf(",");
    const start = lastCommaBeforeCursor === -1 ? 0 : lastCommaBeforeCursor + 1;

    // Find the end of the current token (next comma after cursor, or end)
    const afterCursor = inputValue.slice(cursorPos);
    const nextCommaAfterCursor = afterCursor.indexOf(",");
    const end = nextCommaAfterCursor === -1 ? inputValue.length : cursorPos + nextCommaAfterCursor;

    const token = inputValue.slice(start, end).trim();
    return { token, start, end };
  }

  // Search for contacts
  async function searchContacts(query: string) {
    const accountId = get(selectedAccountId);
    if (!accountId) {
      contacts = [];
      return;
    }

    loading = true;
    try {
      const results = await api.searchContacts(accountId, query, 8);
      contacts = results;
      selectedIndex = 0;
    } catch (e) {
      console.error("Error searching contacts:", e);
      contacts = [];
    } finally {
      loading = false;
    }
  }

  // Handle input changes with debounce
  function handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const cursorPos = input.selectionStart || 0;
    const { token } = getCurrentToken(input.value, cursorPos);

    searchQuery = token;

    // Clear previous timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Show dropdown and search
    if (token.length >= 1) {
      showDropdown = true;
      // Debounce the search
      debounceTimer = setTimeout(() => {
        searchContacts(token);
      }, 150);
    } else {
      // Show recent contacts when field is focused but empty or just whitespace
      showDropdown = true;
      debounceTimer = setTimeout(() => {
        searchContacts("");
      }, 150);
    }

    if (onchange) {
      onchange(input.value);
    }
  }

  // Handle focus
  function handleFocus() {
    const cursorPos = inputElement?.selectionStart || 0;
    const { token } = getCurrentToken(value, cursorPos);
    searchQuery = token;

    // Show recent contacts when focused
    showDropdown = true;
    if (token.length >= 1) {
      searchContacts(token);
    } else {
      searchContacts("");
    }
  }

  // Handle blur with delay to allow click on dropdown
  function handleBlur() {
    setTimeout(() => {
      showDropdown = false;
    }, 200);
  }

  // Select a contact
  function selectContact(contact: Contact) {
    if (!inputElement) return;

    const cursorPos = inputElement.selectionStart || 0;
    const { start, end } = getCurrentToken(value, cursorPos);

    // Format the contact as "Name <email>" or just "email"
    const formatted = contact.name
      ? `${contact.name} <${contact.email}>`
      : contact.email;

    // Replace the current token with the selected contact
    const before = value.slice(0, start);
    const after = value.slice(end);

    // Add comma after if there's more content after
    const newValue = before + formatted + (after.trim() ? after : ", ");
    value = newValue;

    // Move cursor to end of inserted value
    const newCursorPos = before.length + formatted.length + (after.trim() ? 0 : 2);
    setTimeout(() => {
      inputElement?.setSelectionRange(newCursorPos, newCursorPos);
      inputElement?.focus();
    }, 0);

    showDropdown = false;
    contacts = [];

    if (onchange) {
      onchange(newValue);
    }
  }

  // Handle keyboard navigation
  function handleKeydown(e: KeyboardEvent) {
    if (!showDropdown || contacts.length === 0) {
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % contacts.length;
      scrollToSelected();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + contacts.length) % contacts.length;
      scrollToSelected();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (contacts.length > 0) {
        e.preventDefault();
        selectContact(contacts[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      showDropdown = false;
    }
  }

  // Scroll selected item into view
  function scrollToSelected() {
    if (!dropdownElement) return;
    const items = dropdownElement.querySelectorAll(".contact-item");
    const selectedItem = items[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }

  // Format display name
  function formatContact(contact: Contact): string {
    if (contact.name) {
      return `${contact.name} <${contact.email}>`;
    }
    return contact.email;
  }

  // Format relative time
  function formatRelativeTime(timestamp: number): string {
    if (!timestamp) return "";
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
  }
</script>

<div class="email-input-wrapper">
  <input
    bind:this={inputElement}
    {id}
    type="text"
    bind:value
    {placeholder}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    autocomplete="off"
  />
  {#if showDropdown && (contacts.length > 0 || loading)}
    <div class="dropdown" bind:this={dropdownElement}>
      {#if loading && contacts.length === 0}
        <div class="loading">Searching...</div>
      {:else}
        {#if contacts.length > 0}
          <div class="dropdown-header">
            {searchQuery ? "Matches" : "Recent contacts"}
          </div>
        {/if}
        {#each contacts as contact, index (contact.id)}
          <button
            class="contact-item"
            class:selected={index === selectedIndex}
            onmousedown={() => selectContact(contact)}
            onmouseenter={() => selectedIndex = index}
          >
            <div class="contact-info">
              {#if contact.name}
                <span class="contact-name">{contact.name}</span>
                <span class="contact-email">&lt;{contact.email}&gt;</span>
              {:else}
                <span class="contact-email-only">{contact.email}</span>
              {/if}
            </div>
            <span class="contact-time">{formatRelativeTime(contact.last_contacted)}</span>
          </button>
        {/each}
        {#if contacts.length === 0 && !loading && searchQuery}
          <div class="no-results">No contacts found</div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .email-input-wrapper {
    position: relative;
    flex: 1;
  }

  input {
    width: 100%;
    background: transparent;
    border: none;
    padding: 8px 0;
    font-size: 14px;
    color: var(--text-primary);
    outline: none;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100;
    max-height: 280px;
    overflow-y: auto;
    margin-top: 4px;
  }

  .dropdown-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
    position: sticky;
    top: 0;
  }

  .contact-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .contact-item:hover,
  .contact-item.selected {
    background: var(--bg-hover);
  }

  .contact-item.selected {
    background: var(--accent);
  }

  .contact-item.selected .contact-name,
  .contact-item.selected .contact-email,
  .contact-item.selected .contact-email-only,
  .contact-item.selected .contact-time {
    color: white;
  }

  .contact-info {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  .contact-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact-email {
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact-email-only {
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact-time {
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
    margin-left: 8px;
  }

  .loading {
    padding: 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  .no-results {
    padding: 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
</style>
