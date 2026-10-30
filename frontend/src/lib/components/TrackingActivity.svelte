<script lang="ts">
  import { Eye, ChevronDown, ChevronRight } from "@lucide/svelte";
  import { api, type Email } from "$lib/api";
  import { activityLine, PRIVACY_NOTE, type TrackingEvent } from "$lib/tracking";

  interface Props {
    email: Email;
  }

  let { email }: Props = $props();

  let open = $state(false);
  let events = $state<TrackingEvent[] | null>(null);
  let loadedFor = "";

  const line = $derived(activityLine(email.tracking));
  // Reload the list whenever counts change while expanded
  const signature = $derived(`${email.id}:${email.tracking?.opens}:${email.tracking?.clicks}`);

  $effect(() => {
    if (open && loadedFor !== signature) {
      loadedFor = signature;
      api.getTrackingEvents(email.id)
        .then((e) => (events = e))
        .catch(() => (events = []));
    }
  });

  function when(ts: number): string {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
</script>

{#if line}
  <div class="tracking">
    <button class="summary" onclick={() => (open = !open)} title={PRIVACY_NOTE}>
      <Eye size={14} />
      <span>{line}</span>
      {#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
    </button>
    {#if open}
      <ul class="events">
        {#if events === null}
          <li class="muted">Loading...</li>
        {:else if events.length === 0}
          <li class="muted">No activity yet</li>
        {:else}
          {#each events as ev, i (i)}
            <li>
              <span class="kind">{ev.type === "open" ? "Opened" : "Clicked"}</span>
              <span class="when">{when(ev.createdAt)}</span>
              {#if ev.url}<span class="url" title={ev.url}>{ev.url}</span>{/if}
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .tracking {
    padding: 4px 24px 8px;
    font-size: 12px;
  }

  .summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    background: transparent;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
  }

  .events {
    list-style: none;
    margin: 4px 0 0 20px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-secondary);
  }

  .events li {
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .kind {
    width: 52px;
    flex-shrink: 0;
    color: var(--text-primary);
  }

  .when {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
