<script lang="ts">
  import { inboxTab, type InboxTab } from "$lib/stores";

  function setTab(tab: InboxTab) {
    inboxTab.set(tab);
  }
</script>

<div class="inbox-tabs">
  <button
    class="tab"
    class:active={$inboxTab === "important"}
    onclick={() => setTab("important")}
  >
    <span class="tab-icon">⭐</span>
    Important
  </button>
  <button
    class="tab"
    class:active={$inboxTab === "other"}
    onclick={() => setTab("other")}
  >
    <span class="tab-icon">📬</span>
    Other
  </button>
  <button
    class="tab"
    class:active={$inboxTab === "all"}
    onclick={() => setTab("all")}
  >
    <span class="tab-icon">📥</span>
    All
  </button>
</div>

<style>
  .inbox-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--accent);
    color: white;
  }

  .tab-icon {
    font-size: 14px;
  }
</style>
