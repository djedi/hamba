<script lang="ts">
  import { onMount } from "svelte";
  import { emailActions } from "$lib/stores";

  interface Props {
    emailId: string;
    onClose: () => void;
  }

  let { emailId, onClose }: Props = $props();
  let currentIndex = $state(0);
  let showCustomDate = $state(false);
  let customDate = $state("");
  let customTime = $state("09:00");

  interface ReminderOption {
    id: string;
    label: string;
    getTimestamp: () => number;
  }

  function getNextWeekday(dayOfWeek: number): Date {
    const date = new Date();
    const currentDay = date.getDay();
    const daysUntil = (dayOfWeek - currentDay + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntil);
    date.setHours(9, 0, 0, 0);
    return date;
  }

  function getTomorrow(): number {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  function getIn2Days(): number {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    date.setHours(9, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  function getIn3Days(): number {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    date.setHours(9, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  function getNextWeek(): number {
    // Next Monday at 9am
    const monday = getNextWeekday(1);
    return Math.floor(monday.getTime() / 1000);
  }

  function getIn2Weeks(): number {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    date.setHours(9, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  const options: ReminderOption[] = [
    { id: "tomorrow", label: "If no reply by tomorrow", getTimestamp: getTomorrow },
    { id: "2days", label: "If no reply in 2 days", getTimestamp: getIn2Days },
    { id: "3days", label: "If no reply in 3 days", getTimestamp: getIn3Days },
    { id: "nextweek", label: "If no reply in 1 week", getTimestamp: getNextWeek },
    { id: "2weeks", label: "If no reply in 2 weeks", getTimestamp: getIn2Weeks },
    { id: "custom", label: "Pick date & time...", getTimestamp: () => 0 },
  ];

  function formatReminderTime(option: ReminderOption): string {
    if (option.id === "custom") return "";
    const ts = option.getTimestamp();
    const date = new Date(ts * 1000);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayName = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    return dayName;
  }

  function selectOption(option: ReminderOption) {
    if (option.id === "custom") {
      showCustomDate = true;
      // Set default date to 2 days from now
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 2);
      customDate = defaultDate.toISOString().split("T")[0];
    } else {
      const timestamp = option.getTimestamp();
      emailActions.setReminder(emailId, timestamp);
      onClose();
    }
  }

  function confirmCustomReminder() {
    if (!customDate) return;
    const [hours, minutes] = customTime.split(":").map(Number);
    const date = new Date(customDate);
    date.setHours(hours, minutes, 0, 0);
    const timestamp = Math.floor(date.getTime() / 1000);
    emailActions.setReminder(emailId, timestamp);
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showCustomDate) {
      if (e.key === "Escape") {
        showCustomDate = false;
        e.preventDefault();
      } else if (e.key === "Enter") {
        confirmCustomReminder();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        currentIndex = Math.min(currentIndex + 1, options.length - 1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        currentIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Enter":
        e.preventDefault();
        selectOption(options[currentIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  onMount(() => {
    // Focus the modal for keyboard navigation
    const modal = document.querySelector(".reminder-modal") as HTMLElement;
    modal?.focus();
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
  <div class="reminder-modal slide-up" tabindex="-1">
    <div class="header">
      <span class="icon">🔔</span>
      <span class="title">Remind me to follow up...</span>
    </div>

    {#if showCustomDate}
      <div class="custom-date">
        <div class="date-row">
          <label>
            <span>Date</span>
            <input type="date" bind:value={customDate} />
          </label>
          <label>
            <span>Time</span>
            <input type="time" bind:value={customTime} />
          </label>
        </div>
        <div class="custom-actions">
          <button class="btn-secondary" onclick={() => (showCustomDate = false)}>
            Back
          </button>
          <button class="btn-primary" onclick={confirmCustomReminder}>
            Set Reminder
          </button>
        </div>
      </div>
    {:else}
      <div class="options">
        {#each options as option, index (option.id)}
          <button
            class="option"
            class:selected={index === currentIndex}
            onclick={() => selectOption(option)}
            onmouseenter={() => (currentIndex = index)}
          >
            <span class="label">{option.label}</span>
            <span class="time">{formatReminderTime(option)}</span>
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
    z-index: 100;
  }

  .reminder-modal {
    width: 340px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    outline: none;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .icon {
    font-size: 18px;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .options {
    padding: 8px;
  }

  .option {
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

  .option:hover,
  .option.selected {
    background: var(--bg-hover);
  }

  .option.selected {
    background: var(--accent);
  }

  .label {
    flex: 1;
  }

  .time {
    font-size: 12px;
    color: var(--text-muted);
  }

  .option.selected .time {
    color: rgba(255, 255, 255, 0.7);
  }

  .custom-date {
    padding: 16px;
  }

  .date-row {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }

  .date-row label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .date-row span {
    font-size: 12px;
    color: var(--text-muted);
  }

  .date-row input {
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .date-row input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .custom-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-secondary {
    padding: 8px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
  }

  .btn-primary {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
  }

  .btn-primary:hover {
    opacity: 0.9;
  }
</style>
