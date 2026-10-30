<script lang="ts">
  import { KeyRound } from "@lucide/svelte";
  import { sessionApi, type SessionStatus } from "$lib/api";
  import { getPasskey, passkeysAvailable } from "$lib/webauthn";

  let { status, onAuthenticated }: { status: SessionStatus; onAuthenticated: () => void } = $props();

  let username = $state("");
  let password = $state("");
  let confirmPassword = $state("");
  let error = $state("");
  let busy = $state(false);

  const setup = $derived(status.setupRequired);
  const showPasskey = $derived(!setup && status.passkeysSupported && status.hasPasskeys && passkeysAvailable());

  async function submit(e: Event) {
    e.preventDefault();
    error = "";
    if (setup && password !== confirmPassword) {
      error = "Passwords don't match";
      return;
    }
    busy = true;
    try {
      const res = setup
        ? await sessionApi.setup(username.trim(), password)
        : await sessionApi.login(username.trim(), password);
      if (res.success) onAuthenticated();
      else error = res.error || "Sign-in failed";
    } catch {
      error = "Can't reach the server";
    } finally {
      busy = false;
    }
  }

  async function passkeyLogin() {
    error = "";
    busy = true;
    try {
      const start = await sessionApi.passkeyLoginStart();
      if (!start.ceremonyId) throw new Error(start.error || "Passkey sign-in unavailable");
      const credential = await getPasskey(start.options);
      const res = await sessionApi.passkeyLoginFinish(start.ceremonyId, credential);
      if (res.success) onAuthenticated();
      else error = res.error || "Passkey sign-in failed";
    } catch (e) {
      // NotAllowedError = user dismissed the prompt
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) {
        error = e instanceof Error ? e.message : "Passkey sign-in failed";
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <form class="card" onsubmit={submit}>
    <div class="brand">
      <img src="/favicon-96x96.png" alt="" width="40" height="40" />
      <h1>Hamba</h1>
    </div>
    <p class="subtitle">{setup ? "Create your login to secure this Hamba." : "Sign in to continue."}</p>

    {#if showPasskey}
      <button type="button" class="passkey" onclick={passkeyLogin} disabled={busy}>
        <KeyRound size={16} /> Sign in with a passkey
      </button>
      <div class="divider"><span>or</span></div>
    {/if}

    <label>
      Username
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" bind:value={username} autocomplete="username" autofocus required maxlength="100" />
    </label>
    <label>
      Password
      <input
        type="password"
        bind:value={password}
        autocomplete={setup ? "new-password" : "current-password"}
        required
        minlength={setup ? 8 : undefined}
      />
    </label>
    {#if setup}
      <label>
        Confirm password
        <input type="password" bind:value={confirmPassword} autocomplete="new-password" required minlength="8" />
      </label>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button type="submit" class="primary" disabled={busy || !username.trim() || !password}>
      {setup ? "Create login" : "Sign in"}
    </button>
    {#if setup}
      <p class="hint">After signing in you can add a passkey in Settings → Security.</p>
    {/if}
  </form>
</div>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--bg-primary);
    padding: 16px;
  }
  .card {
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 28px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-pop);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    color: var(--text-primary);
  }
  .subtitle {
    margin: 0 0 4px;
    color: var(--text-secondary);
    font-size: 13px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  input {
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-primary);
    font-size: 14px;
  }
  input:focus {
    outline: 2px solid var(--focus-ring);
    outline-offset: -1px;
  }
  button {
    padding: 9px 12px;
    border-radius: var(--r-md);
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: none;
    margin-top: 4px;
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .passkey {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  .passkey:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--border);
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
