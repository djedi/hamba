<script lang="ts" generics="T">
  import { onMount, tick } from "svelte";
  import type { Snippet } from "svelte";

  interface Props {
    items: T[];
    itemHeight: number;
    overscan?: number;
    getKey: (item: T, index: number) => string | number;
    children: Snippet<[{ item: T; index: number }]>;
    class?: string;
  }

  let {
    items,
    itemHeight,
    overscan = 3,
    getKey,
    children,
    class: className = "",
  }: Props = $props();

  // Container element reference
  let container: HTMLDivElement | null = $state(null);

  // Scroll state
  let scrollTop = $state(0);
  let containerHeight = $state(0);

  // Calculate visible range
  const visibleRange = $derived.by(() => {
    const totalItems = items.length;
    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const endIndex = Math.min(totalItems, startIndex + visibleCount + overscan * 2);

    return { start: startIndex, end: endIndex };
  });

  // Items to render
  const visibleItems = $derived(items.slice(visibleRange.start, visibleRange.end));

  // Total height for scroll area
  const totalHeight = $derived(items.length * itemHeight);

  // Offset for positioning visible items
  const offsetY = $derived(visibleRange.start * itemHeight);

  function handleScroll(e: Event) {
    const target = e.target as HTMLDivElement;
    scrollTop = target.scrollTop;
  }

  // Scroll to a specific index (for keyboard navigation)
  export function scrollToIndex(index: number, behavior: ScrollBehavior = "auto") {
    if (!container || index < 0 || index >= items.length) return;

    const itemTop = index * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + containerHeight;

    // Check if item is already fully visible
    if (itemTop >= viewportTop && itemBottom <= viewportBottom) {
      return; // Already visible, no scroll needed
    }

    // Scroll to make item visible
    let newScrollTop: number;
    if (itemTop < viewportTop) {
      // Item is above viewport - scroll up
      newScrollTop = itemTop;
    } else {
      // Item is below viewport - scroll down
      newScrollTop = itemBottom - containerHeight;
    }

    container.scrollTo({ top: newScrollTop, behavior });
  }

  // Update container height on mount and resize
  onMount(() => {
    if (!container) return;

    containerHeight = container.clientHeight;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight = entry.contentRect.height;
      }
    });

    observer.observe(container);

    return () => observer.disconnect();
  });
</script>

<div
  bind:this={container}
  class="virtual-list {className}"
  onscroll={handleScroll}
>
  <div class="virtual-list-inner" style="height: {totalHeight}px;">
    <div class="virtual-list-content" style="transform: translateY({offsetY}px);">
      {#each visibleItems as item, i (getKey(item, visibleRange.start + i))}
        {@render children({ item, index: visibleRange.start + i })}
      {/each}
    </div>
  </div>
</div>

<style>
  .virtual-list {
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    position: relative;
  }

  .virtual-list-inner {
    position: relative;
    width: 100%;
  }

  .virtual-list-content {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }
</style>
