<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { initKeyboardNavigation } from "$lib/keyboard";

  let { children } = $props();

  onMount(() => {
    return initKeyboardNavigation();
  });
</script>

<svelte:head>
  <title>Hamba</title>
  <meta name="description" content="Hamba - A blazing fast email client" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180x180.png" />
  <link rel="manifest" href="/manifest.json" />
</svelte:head>

{@render children()}
