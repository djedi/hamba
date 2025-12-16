<script lang="ts">
  import { api, type ImapAccountParams } from "$lib/api";
  import { accounts } from "$lib/stores";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let step = $state<"choose" | "imap">("choose");

  // IMAP form state
  let email = $state("");
  let name = $state("");
  let username = $state("");
  let password = $state("");
  let imapHost = $state("");
  let imapPort = $state(993);
  let smtpHost = $state("");
  let smtpPort = $state(587);
  let testing = $state(false);
  let error = $state("");

  function handleGmail() {
    window.location.href = api.getLoginUrl();
  }

  function handleMicrosoft() {
    window.location.href = api.getMicrosoftLoginUrl();
  }

  function handleYahoo() {
    window.location.href = api.getYahooLoginUrl();
  }

  async function handleImapSubmit() {
    testing = true;
    error = "";

    try {
      const result = await api.addImapAccount({
        email,
        name: name || undefined,
        username: username || undefined,
        password,
        imapHost,
        imapPort,
        smtpHost,
        smtpPort,
      });

      if (result.error) {
        error = result.error;
      } else if (result.account) {
        accounts.update((a) => [...a, result.account!]);
        onClose();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to add account";
    } finally {
      testing = false;
    }
  }

  // Auto-fill common providers based on email domain
  function autoFillProvider() {
    const domain = email.split("@")[1];
    if (!domain) return;

    const providers: Record<string, { imap: string; smtp: string; imapPort?: number; smtpPort?: number }> = {
      "outlook.com": { imap: "outlook.office365.com", smtp: "smtp.office365.com" },
      "hotmail.com": { imap: "outlook.office365.com", smtp: "smtp.office365.com" },
      "live.com": { imap: "outlook.office365.com", smtp: "smtp.office365.com" },
      "yahoo.com": { imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com" },
      "icloud.com": { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com" },
      "me.com": { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com" },
      "fastmail.com": { imap: "imap.fastmail.com", smtp: "smtp.fastmail.com" },
      "protonmail.com": { imap: "127.0.0.1", smtp: "127.0.0.1", imapPort: 1143, smtpPort: 1025 },
    };

    if (providers[domain]) {
      imapHost = providers[domain].imap;
      smtpHost = providers[domain].smtp;
      if (providers[domain].imapPort) imapPort = providers[domain].imapPort;
      if (providers[domain].smtpPort) smtpPort = providers[domain].smtpPort;
    } else if (!imapHost && !smtpHost) {
      // Generic self-hosted guess
      imapHost = `imap.${domain}`;
      smtpHost = `smtp.${domain}`;
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<div class="modal-overlay" onclick={handleOverlayClick} role="dialog" aria-modal="true">
  <div class="modal">
    {#if step === "choose"}
      <header class="modal-header">
        <h2>Add Account</h2>
        <button class="close-btn" onclick={onClose}>x</button>
      </header>

      <p class="description">Choose how to connect your email</p>

      <div class="options">
        <button class="option" onclick={handleGmail}>
          <span class="icon">G</span>
          <div class="option-text">
            <span class="label">Gmail</span>
            <span class="desc">Connect with Google OAuth</span>
          </div>
        </button>

        <button class="option" onclick={handleMicrosoft}>
          <span class="icon microsoft">M</span>
          <div class="option-text">
            <span class="label">Microsoft</span>
            <span class="desc">Outlook, Hotmail, Office 365</span>
          </div>
        </button>

        <button class="option" onclick={handleYahoo}>
          <span class="icon yahoo">Y</span>
          <div class="option-text">
            <span class="label">Yahoo</span>
            <span class="desc">Yahoo Mail, AOL</span>
          </div>
        </button>

        <button class="option" onclick={() => (step = "imap")}>
          <span class="icon">@</span>
          <div class="option-text">
            <span class="label">IMAP/SMTP</span>
            <span class="desc">Self-hosted or other providers</span>
          </div>
        </button>
      </div>

    {:else if step === "imap"}
      <header class="modal-header">
        <h2>Add IMAP Account</h2>
        <button class="close-btn" onclick={onClose}>x</button>
      </header>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleImapSubmit();
        }}
      >
        <div class="form-section">
          <div class="field">
            <label for="email">Email Address</label>
            <input
              id="email"
              type="email"
              bind:value={email}
              onblur={autoFillProvider}
              placeholder="you@example.com"
              required
            />
          </div>

          <div class="field">
            <label for="name">Display Name</label>
            <input id="name" type="text" bind:value={name} placeholder="Optional" />
          </div>

          <div class="field">
            <label for="username">Username</label>
            <input id="username" type="text" bind:value={username} placeholder="Optional - if different from email" />
          </div>

          <div class="field">
            <label for="password">Password / App Password</label>
            <input id="password" type="password" bind:value={password} required />
          </div>
        </div>

        <div class="form-section">
          <h3>IMAP Settings (Incoming)</h3>
          <div class="row">
            <div class="field flex-1">
              <label for="imapHost">Server</label>
              <input
                id="imapHost"
                type="text"
                bind:value={imapHost}
                placeholder="imap.example.com"
                required
              />
            </div>
            <div class="field port-field">
              <label for="imapPort">Port</label>
              <input id="imapPort" type="number" bind:value={imapPort} />
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>SMTP Settings (Outgoing)</h3>
          <div class="row">
            <div class="field flex-1">
              <label for="smtpHost">Server</label>
              <input
                id="smtpHost"
                type="text"
                bind:value={smtpHost}
                placeholder="smtp.example.com"
                required
              />
            </div>
            <div class="field port-field">
              <label for="smtpPort">Port</label>
              <input id="smtpPort" type="number" bind:value={smtpPort} />
            </div>
          </div>
        </div>

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <div class="actions">
          <button type="button" class="secondary" onclick={() => (step = "choose")}>
            Back
          </button>
          <button type="submit" class="primary" disabled={testing}>
            {testing ? "Testing connection..." : "Add Account"}
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    width: 100%;
    max-width: 440px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .description {
    color: var(--text-muted);
    margin-bottom: 20px;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s;
  }

  .option:hover {
    border-color: var(--accent);
  }

  .option .icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
  }

  .option .icon.microsoft {
    background: #0078d4;
  }

  .option .icon.yahoo {
    background: #720e9e;
  }

  .option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .option .label {
    font-weight: 500;
    color: var(--text-primary);
  }

  .option .desc {
    font-size: 13px;
    color: var(--text-muted);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .field input {
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .field input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .row {
    display: flex;
    gap: 12px;
  }

  .flex-1 {
    flex: 1;
  }

  .port-field {
    width: 80px;
  }

  .error {
    background: var(--danger);
    color: white;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 13px;
  }

  .actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    padding-top: 8px;
  }

  .actions button {
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  .actions .secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .actions .secondary:hover {
    background: var(--bg-hover);
  }

  .actions .primary {
    background: var(--accent);
    border: none;
    color: white;
  }

  .actions .primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .actions .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
