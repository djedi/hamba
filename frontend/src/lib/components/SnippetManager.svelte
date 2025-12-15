<script lang="ts">
  import { snippets, snippetActions, selectedAccountId } from "$lib/stores";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let newName = $state("");
  let newShortcut = $state("");
  let newContent = $state("");
  let editingId = $state<string | null>(null);
  let editName = $state("");
  let editShortcut = $state("");
  let editContent = $state("");
  let isCreating = $state(false);
  let error = $state("");

  async function createSnippet() {
    const accountId = $selectedAccountId;
    if (!accountId || !newName.trim() || !newShortcut.trim() || !newContent.trim()) return;

    isCreating = true;
    error = "";
    const result = await snippetActions.createSnippet(accountId, newName.trim(), newShortcut.trim(), newContent);
    isCreating = false;

    if (result.success) {
      newName = "";
      newShortcut = "";
      newContent = "";
    } else {
      error = result.error || "Failed to create snippet";
    }
  }

  function startEdit(snippet: { id: string; name: string; shortcut: string; content: string }) {
    editingId = snippet.id;
    editName = snippet.name;
    editShortcut = snippet.shortcut;
    editContent = snippet.content;
  }

  function cancelEdit() {
    editingId = null;
    editName = "";
    editShortcut = "";
    editContent = "";
  }

  async function saveEdit() {
    if (!editingId || !editName.trim() || !editShortcut.trim() || !editContent.trim()) return;

    const result = await snippetActions.updateSnippet(editingId, {
      name: editName.trim(),
      shortcut: editShortcut.trim(),
      content: editContent
    });
    if (result.success) {
      cancelEdit();
    } else {
      error = result.error || "Failed to update snippet";
    }
  }

  async function deleteSnippet(id: string) {
    if (!confirm("Delete this snippet?")) return;

    const result = await snippetActions.deleteSnippet(id);
    if (!result.success) {
      error = result.error || "Failed to delete snippet";
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (editingId) {
        cancelEdit();
      } else {
        onClose();
      }
    }
  }

  function truncateContent(content: string, maxLength: number = 50): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_interactive_supports_focus -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <h2>Manage Snippets</h2>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-body">
      {#if error}
        <div class="error-message">{error}</div>
      {/if}

      <div class="help-text">
        Snippets are text templates you can quickly insert while composing emails.
        Type <code>;shortcut</code> in the compose body to expand a snippet.
      </div>

      <div class="create-snippet">
        <div class="form-row">
          <div class="form-field">
            <label for="snippet-name">Name</label>
            <input
              id="snippet-name"
              type="text"
              placeholder="e.g., Meeting Follow-up"
              bind:value={newName}
            />
          </div>
          <div class="form-field shortcut-field">
            <label for="snippet-shortcut">Shortcut</label>
            <div class="shortcut-input">
              <span class="shortcut-prefix">;</span>
              <input
                id="snippet-shortcut"
                type="text"
                placeholder="e.g., followup"
                bind:value={newShortcut}
                pattern="[a-zA-Z0-9_-]+"
              />
            </div>
          </div>
        </div>
        <div class="form-field">
          <label for="snippet-content">Content</label>
          <textarea
            id="snippet-content"
            placeholder="The text that will be inserted when you use this snippet..."
            bind:value={newContent}
            rows="4"
          ></textarea>
        </div>
        <button class="primary" onclick={createSnippet} disabled={isCreating || !newName.trim() || !newShortcut.trim() || !newContent.trim()}>
          {isCreating ? "Creating..." : "Create Snippet"}
        </button>
      </div>

      <div class="snippets-list">
        {#each $snippets as snippet (snippet.id)}
          <div class="snippet-row">
            {#if editingId === snippet.id}
              <div class="snippet-edit">
                <div class="form-row">
                  <div class="form-field">
                    <label for="edit-name-{snippet.id}">Name</label>
                    <input id="edit-name-{snippet.id}" type="text" bind:value={editName} />
                  </div>
                  <div class="form-field shortcut-field">
                    <label for="edit-shortcut-{snippet.id}">Shortcut</label>
                    <div class="shortcut-input">
                      <span class="shortcut-prefix">;</span>
                      <input id="edit-shortcut-{snippet.id}" type="text" bind:value={editShortcut} />
                    </div>
                  </div>
                </div>
                <div class="form-field">
                  <label for="edit-content-{snippet.id}">Content</label>
                  <textarea id="edit-content-{snippet.id}" bind:value={editContent} rows="4"></textarea>
                </div>
                <div class="edit-actions">
                  <button class="save" onclick={saveEdit}>Save</button>
                  <button class="cancel" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            {:else}
              <div class="snippet-info">
                <div class="snippet-header-row">
                  <span class="snippet-name">{snippet.name}</span>
                  <span class="snippet-shortcut">;{snippet.shortcut}</span>
                </div>
                <div class="snippet-preview">{truncateContent(snippet.content)}</div>
              </div>
              <div class="snippet-actions">
                <button class="edit" onclick={() => startEdit(snippet)}>Edit</button>
                <button class="delete" onclick={() => deleteSnippet(snippet.id)}>Delete</button>
              </div>
            {/if}
          </div>
        {/each}

        {#if $snippets.length === 0}
          <div class="empty">No snippets yet. Create one above to get started.</div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-primary);
    border-radius: 12px;
    width: 560px;
    max-width: 90vw;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 24px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
  }

  .help-text {
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 20px;
    line-height: 1.5;
  }

  .help-text code {
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    color: var(--accent);
  }

  .error-message {
    background: var(--danger);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 13px;
  }

  .create-snippet {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }

  .form-row {
    display: flex;
    gap: 12px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .form-field.shortcut-field {
    flex: 0 0 180px;
  }

  .form-field label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .form-field input,
  .form-field textarea {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
  }

  .form-field input:focus,
  .form-field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .form-field textarea {
    resize: vertical;
    min-height: 80px;
  }

  .shortcut-input {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .shortcut-prefix {
    padding: 10px 0 10px 12px;
    color: var(--accent);
    font-family: monospace;
    font-size: 14px;
    font-weight: 600;
  }

  .shortcut-input input {
    border: none;
    background: transparent;
    padding-left: 2px;
  }

  .shortcut-input input:focus {
    border: none;
    outline: none;
  }

  .primary {
    align-self: flex-start;
  }

  .snippets-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .snippet-row {
    padding: 12px;
    border-radius: 8px;
    background: var(--bg-secondary);
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .snippet-info {
    flex: 1;
    min-width: 0;
  }

  .snippet-header-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }

  .snippet-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .snippet-shortcut {
    font-family: monospace;
    font-size: 12px;
    color: var(--accent);
    background: var(--bg-primary);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .snippet-preview {
    font-size: 13px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet-actions {
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.1s;
    flex-shrink: 0;
  }

  .snippet-row:hover .snippet-actions {
    opacity: 1;
  }

  .snippet-actions button {
    background: transparent;
    border: none;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .snippet-actions .edit {
    color: var(--accent);
  }

  .snippet-actions .edit:hover {
    background: var(--accent);
    color: white;
  }

  .snippet-actions .delete {
    color: var(--danger);
  }

  .snippet-actions .delete:hover {
    background: var(--danger);
    color: white;
  }

  .snippet-edit {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
  }

  .snippet-edit input,
  .snippet-edit textarea {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
  }

  .snippet-edit .shortcut-input {
    background: var(--bg-primary);
  }

  .edit-actions {
    display: flex;
    gap: 8px;
  }

  .edit-actions button {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .edit-actions .save {
    background: var(--accent);
    color: white;
    border: none;
  }

  .edit-actions .cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 24px;
    font-size: 14px;
  }
</style>
