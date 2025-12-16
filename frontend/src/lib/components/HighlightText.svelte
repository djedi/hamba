<script lang="ts">
  import { splitTextForHighlight } from "$lib/search";

  interface Props {
    text: string;
    searchTerms: string[];
  }

  let { text, searchTerms }: Props = $props();

  const segments = $derived(splitTextForHighlight(text, searchTerms));
</script>

{#each segments as segment}
  {#if segment.highlight}
    <mark class="highlight">{segment.text}</mark>
  {:else}
    {segment.text}
  {/if}
{/each}

<style>
  .highlight {
    background-color: rgba(250, 204, 21, 0.4);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
