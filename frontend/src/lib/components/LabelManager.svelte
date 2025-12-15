<script lang="ts">
  import { labels, labelActions, selectedAccountId } from "$lib/stores";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let newLabelName = $state("");
  let newLabelColor = $state("#6366f1");
  let editingId = $state<string | null>(null);
  let editName = $state("");
  let editColor = $state("");
  let isCreating = $state(false);
  let error = $state("");

  const colorOptions = [
    "#ef4444", // red
    "#f97316", // orange
    "#eab308", // yellow
    "#22c55e", // green
    "#14b8a6", // teal
    "#3b82f6", // blue
    "#6366f1", // indigo
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#6b7280", // gray
  ];

  async function createLabel() {
    const accountId = $selectedAccountId;
    if (!accountId || !newLabelName.trim()) return;

    isCreating = true;
    error = "";
    const result = await labelActions.createLabel(accountId, newLabelName.trim(), newLabelColor);
    isCreating = false;

    if (result.success) {
      newLabelName = "";
      newLabelColor = "#6366f1";
    } else {
      error = result.error || "Failed to create label";
    }
  }

  function startEdit(label: { id: string; name: string; color: string }) {
    editingId = label.id;
    editName = label.name;
    editColor = label.color;
  }

  function cancelEdit() {
    editingId = null;
    editName = "";
    editColor = "";
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;

    const result = await labelActions.updateLabel(editingId, { name: editName.trim(), color: editColor });
    if (result.success) {
      cancelEdit();
    } else {
      error = result.error || "Failed to update label";
    }
  }

  async function deleteLabel(id: string) {
    if (!confirm("Delete this label? Emails with this label will not be deleted.")) return;

    const result = await labelActions.deleteLabel(id);
    if (!result.success) {
      error = result.error || "Failed to delete label";
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
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => e.key === "Escape" && onClose()} role="presentation" tabindex="-1">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
    <div class="modal-header">
      <h2>Manage Labels</h2>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-body">
      {#if error}
        <div class="error-message">{error}</div>
      {/if}

      <div class="create-label">
        <input
          type="text"
          placeholder="New label name"
          bind:value={newLabelName}
          onkeydown={(e) => e.key === "Enter" && createLabel()}
        />
        <div class="color-picker">
          {#each colorOptions as color}
            <button
              class="color-option"
              class:selected={newLabelColor === color}
              style="background-color: {color}"
              onclick={() => (newLabelColor = color)}
              title={color}
              aria-label={`Select color ${color}`}
            ></button>
          {/each}
        </div>
        <button class="primary" onclick={createLabel} disabled={isCreating || !newLabelName.trim()}>
          {isCreating ? "Creating..." : "Create"}
        </button>
      </div>

      <div class="labels-list">
        {#each $labels.filter(l => l.type === "user") as label (label.id)}
          <div class="label-row">
            {#if editingId === label.id}
              <div class="label-edit">
                <input type="text" bind:value={editName} />
                <div class="color-picker small">
                  {#each colorOptions as color}
                    <button
                      class="color-option small"
                      class:selected={editColor === color}
                      style="background-color: {color}"
                      onclick={() => (editColor = color)}
                      title={color}
                      aria-label={`Select color ${color}`}
                    ></button>
                  {/each}
                </div>
                <div class="edit-actions">
                  <button class="save" onclick={saveEdit}>Save</button>
                  <button class="cancel" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            {:else}
              <span class="label-dot" style="background-color: {label.color}"></span>
              <span class="label-name">{label.name}</span>
              <div class="label-actions">
                <button class="edit" onclick={() => startEdit(label)}>Edit</button>
                <button class="delete" onclick={() => deleteLabel(label.id)}>Delete</button>
              </div>
            {/if}
          </div>
        {/each}

        {#if $labels.filter(l => l.type === "user").length === 0}
          <div class="empty">No custom labels yet. Create one above.</div>
        {/if}
      </div>

      {#if $labels.filter(l => l.type !== "user").length > 0}
        <h3>Synced Labels</h3>
        <div class="labels-list synced">
          {#each $labels.filter(l => l.type !== "user") as label (label.id)}
            <div class="label-row readonly">
              <span class="label-dot" style="background-color: {label.color}"></span>
              <span class="label-name">{label.name}</span>
              <span class="label-type">{label.type}</span>
            </div>
          {/each}
        </div>
      {/if}
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
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
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

  .error-message {
    background: var(--danger);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 13px;
  }

  .create-label {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }

  .create-label input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 14px;
  }

  .create-label input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .color-picker {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .color-picker.small {
    gap: 4px;
  }

  .color-option {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .color-option.small {
    width: 18px;
    height: 18px;
  }

  .color-option:hover {
    transform: scale(1.1);
  }

  .color-option.selected {
    border-color: var(--text-primary);
  }

  .primary {
    align-self: flex-start;
  }

  .labels-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .labels-list.synced {
    margin-top: 12px;
  }

  h3 {
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 24px 0 8px;
    letter-spacing: 0.5px;
  }

  .label-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--bg-secondary);
  }

  .label-row.readonly {
    opacity: 0.7;
  }

  .label-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .label-name {
    flex: 1;
    font-size: 14px;
  }

  .label-type {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .label-actions {
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .label-row:hover .label-actions {
    opacity: 1;
  }

  .label-actions button {
    background: transparent;
    border: none;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .label-actions .edit {
    color: var(--accent);
  }

  .label-actions .edit:hover {
    background: var(--accent);
    color: white;
  }

  .label-actions .delete {
    color: var(--danger);
  }

  .label-actions .delete:hover {
    background: var(--danger);
    color: white;
  }

  .label-edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }

  .label-edit input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 14px;
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
    padding: 20px;
    font-size: 14px;
  }
</style>
