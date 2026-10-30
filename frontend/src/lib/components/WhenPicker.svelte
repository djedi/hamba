<script lang="ts">
  import type { Component } from "svelte";
  import { onMount } from "svelte";
  import { parseWhen, whenPresets, formatWhen, toUnix } from "$lib/dateParse";

  interface Props {
    title: string;
    // Lucide icon component
    icon: Component<any>;
    confirmLabel?: string;
    onPick: (timestamp: number) => void;
    onClose: () => void;
  }

  let { title, icon: Icon, confirmLabel = "Confirm", onPick, onClose }: Props = $props();

  const now = new Date();
  const presets = whenPresets(now);
  let text = $state("");
  let index = $state(0);
  let input: HTMLInputElement;

  const parsed = $derived(text.trim() ? parseWhen(text, new Date()) : null);
  const invalid = $derived(text.trim() !== "" && parsed === null);

  function pick(date: Date) {
    onPick(toUnix(date));
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      index = Math.min(index + 1, presets.length - 1);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      index = Math.max(index - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (text.trim()) {
        if (parsed) pick(parsed);
      } else if (presets[index]) {
        pick(presets[index].date);
      }
    } else if (!text && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const preset = presets.find((p) => p.key === e.key);
      if (preset) {
        e.preventDefault();
        pick(preset.date);
      }
    }
  }

  onMount(() => input?.focus());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose()} onkeydown={handleKeydown} role="presentation">
  <div class="modal slide-up" role="dialog" aria-modal="true" aria-label={title}>
    <div class="header">
      <span class="icon"><Icon size={18} /></span>
      <span class="title">{title}</span>
    </div>

    <div class="input-wrap">
      <input
        bind:this={input}
        bind:value={text}
        class:invalid
        type="text"
        placeholder='Type a time: "tomorrow 9am", "fri 3pm", "in 2 hours"'
        autocomplete="off"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
      />
      {#if parsed}
        <div class="preview">
          <span>{formatWhen(parsed, new Date())}</span>
          <button class="confirm" onclick={() => pick(parsed)}>{confirmLabel} <kbd>↵</kbd></button>
        </div>
      {:else if invalid}
        <div class="preview error">Couldn't understand that, or it's in the past</div>
      {/if}
    </div>

    {#if !text}
      <div class="options">
        {#each presets as preset, i (preset.id)}
          <button
            class="option"
            class:selected={i === index}
            onclick={() => pick(preset.date)}
            onmouseenter={() => (index = i)}
          >
            <kbd>{preset.key}</kbd>
            <span class="label">{preset.label}</span>
            <span class="time">{formatWhen(preset.date, now)}</span>
          </button>
        {/each}
      </div>
    {/if}
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
    z-index: 200;
  }

  .modal {
    width: 380px;
    max-width: calc(100vw - 32px);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 6px;
  }

  .icon {
    display: inline-flex;
    color: var(--accent);
  }

  .title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .input-wrap {
    padding: 8px 12px;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 14px;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  input.invalid {
    border-color: var(--danger);
  }

  .preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 13px;
    color: var(--accent);
    font-weight: 500;
  }

  .preview.error {
    color: var(--danger);
    font-weight: 400;
  }

  .confirm {
    padding: 5px 10px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .options {
    padding: 4px 8px 8px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .option.selected {
    background: var(--accent);
  }

  .option kbd,
  .confirm kbd {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.25);
    font-family: inherit;
  }

  .label {
    flex: 1;
  }

  .time {
    font-size: 12px;
    color: var(--text-muted);
  }

  .option.selected .time {
    color: rgba(255, 255, 255, 0.75);
  }
</style>
