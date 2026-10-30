<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { initKeyboardNavigation } from "$lib/keyboard";
  import { registerServiceWorker, initOnlineListener } from "$lib/offline";
  import { get } from "svelte/store";
  import { selectedAccount, view, showToast } from "$lib/stores";
  import { DEFAULT_ACCOUNT_COLOR } from "$lib/accountAppearance";
  import ErrorBoundary from "$lib/components/ErrorBoundary.svelte";
  import Login from "$lib/components/Login.svelte";
  import { sessionApi, setUnauthorizedHandler, type SessionStatus } from "$lib/api";
  import { initViewportHeight } from "$lib/mobile";

  let { children } = $props();

  // App login gate. "checking" until /session/status answers; if the server is
  // unreachable, render the app anyway so offline mode still works.
  let session = $state<SessionStatus | null>(null);
  let gate = $state<"checking" | "login" | "app">("checking");

  async function checkSession() {
    try {
      session = await sessionApi.status();
      gate = session.authenticated ? "app" : "login";
    } catch {
      gate = "app";
    }
  }

  // A 401 mid-session (expired or signed out elsewhere) drops back to the login screen
  setUnauthorizedHandler(() => {
    if (gate === "app") checkSession();
  });

  // Notification taps (service worker posts {type: "open-url"}). On the login screen the
  // target is kept until sign-in; in the app it's opened unless a draft is being written.
  let pendingUrl: string | null = null;
  $effect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "open-url" || typeof e.data.url !== "string") return;
      const url = new URL(e.data.url, location.origin);
      if (url.origin !== location.origin) return;
      if (gate !== "app") {
        pendingUrl = url.href;
      } else if (get(view) === "compose") {
        showToast("New mail — finish or close your draft to open it", "success");
      } else {
        location.assign(url.href);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  });

  function onAuthenticated() {
    if (pendingUrl) location.assign(pendingUrl);
    else location.reload();
  }

  // Keyboard shortcuts only once the app is showing
  $effect(() => {
    if (gate !== "app") return;
    return initKeyboardNavigation();
  });

  // Expose the selected account's color for icon glow etc.
  $effect(() => {
    const c = $selectedAccount?.color || DEFAULT_ACCOUNT_COLOR;
    const root = document.documentElement;
    root.style.setProperty("--account-color", c);
    root.style.setProperty("--account-glow", `color-mix(in srgb, ${c} var(--glow-strength), transparent)`);
  });

  onMount(() => {
    checkSession();
    const cleanupOnline = initOnlineListener();
    const cleanupViewport = initViewportHeight();

    // Register service worker for offline support
    registerServiceWorker();

    return () => {
      cleanupOnline();
      cleanupViewport();
    };
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

{#if gate === "login" && session}
  <!-- Reload so every store and the WebSocket start fresh with the new session -->
  <Login status={session} {onAuthenticated} />
{:else if gate === "app"}
  <ErrorBoundary>
    {@render children()}
  </ErrorBoundary>
{/if}
