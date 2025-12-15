<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api, type Email, type Draft } from "$lib/api";
  import { view, selectedAccountId, currentDraftId, drafts } from "$lib/stores";
  import { get } from "svelte/store";

  interface Props {
    replyTo?: Email | null;
    mode?: "new" | "reply" | "replyAll" | "forward";
    draft?: Draft | null;
  }

  let { replyTo = null, mode = "new", draft = null }: Props = $props();

  let to = $state("");
  let cc = $state("");
  let bcc = $state("");
  let subject = $state("");
  let body = $state("");
  let showCc = $state(false);
  let showBcc = $state(false);
  let sending = $state(false);
  let error = $state("");
  let lastSaved = $state<string | null>(null);

  let toInput: HTMLInputElement;
  let draftId = draft?.id || crypto.randomUUID();
  let autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSavedContent = "";

  // Generate a content hash for change detection
  function getContentHash(): string {
    return `${to}|${cc}|${bcc}|${subject}|${body}`;
  }

  // Auto-save draft every 5 seconds if content changed
  async function autoSave() {
    const accountId = get(selectedAccountId);
    if (!accountId) return;

    const currentHash = getContentHash();
    if (currentHash === lastSavedContent) return; // No changes

    // Don't save completely empty drafts
    if (!to && !cc && !bcc && !subject && !body) return;

    try {
      await api.saveDraft({
        id: draftId,
        accountId,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        body,
        replyToId: replyTo?.id,
        replyMode: mode !== "new" ? mode : undefined,
      });

      lastSavedContent = currentHash;
      lastSaved = new Date().toLocaleTimeString();
      currentDraftId.set(draftId);
    } catch (e) {
      console.error("Auto-save failed:", e);
    }
  }

  onMount(() => {
    // Load from existing draft if provided
    if (draft) {
      to = draft.to_addresses || "";
      cc = draft.cc_addresses || "";
      bcc = draft.bcc_addresses || "";
      subject = draft.subject || "";
      body = draft.body || "";
      if (cc) showCc = true;
      if (bcc) showBcc = true;
      draftId = draft.id;
      lastSavedContent = getContentHash();
    }
    // Pre-fill based on mode (for new compositions)
    else if (replyTo && mode !== "new") {
      if (mode === "reply") {
        to = replyTo.from_email;
        subject = replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`;
        body = buildQuotedReply(replyTo);
      } else if (mode === "replyAll") {
        to = replyTo.from_email;
        // Add original To recipients (excluding self) to CC
        const accountEmail = get(selectedAccountId);
        cc = replyTo.to_addresses
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e && !e.includes(accountEmail || ""))
          .join(", ");
        if (replyTo.cc_addresses) {
          cc = cc ? `${cc}, ${replyTo.cc_addresses}` : replyTo.cc_addresses;
        }
        if (cc) showCc = true;
        subject = replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`;
        body = buildQuotedReply(replyTo);
      } else if (mode === "forward") {
        subject = replyTo.subject.startsWith("Fwd:") ? replyTo.subject : `Fwd: ${replyTo.subject}`;
        body = buildForwardedMessage(replyTo);
      }
    }

    // Start auto-save timer
    autoSaveTimer = setInterval(autoSave, 5000);

    // Focus the appropriate field
    setTimeout(() => {
      if (mode === "new" || mode === "forward") {
        toInput?.focus();
      } else {
        // Focus body for replies
        document.querySelector<HTMLTextAreaElement>(".compose-body")?.focus();
      }
    }, 100);
  });

  onDestroy(() => {
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer);
    }
    currentDraftId.set(null);
  });

  function buildQuotedReply(email: Email): string {
    const date = new Date(email.received_at * 1000).toLocaleString();
    return `<br><br><div style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">
On ${date}, ${email.from_name || email.from_email} wrote:<br><br>
${email.body_html || email.body_text.replace(/\n/g, "<br>")}
</div>`;
  }

  function buildForwardedMessage(email: Email): string {
    const date = new Date(email.received_at * 1000).toLocaleString();
    return `<br><br>---------- Forwarded message ----------<br>
From: ${email.from_name} &lt;${email.from_email}&gt;<br>
Date: ${date}<br>
Subject: ${email.subject}<br>
To: ${email.to_addresses}<br><br>
${email.body_html || email.body_text.replace(/\n/g, "<br>")}`;
  }

  async function handleClose() {
    // Delete the draft if it's empty (discarding)
    if (!to && !cc && !bcc && !subject && !body) {
      try {
        await api.deleteDraft(draftId);
        drafts.update(d => d.filter(draft => draft.id !== draftId));
      } catch (e) {
        // Ignore errors when deleting draft
      }
    }
    view.set("inbox");
  }

  async function handleSend() {
    const accountId = get(selectedAccountId);
    if (!accountId) {
      error = "No account selected";
      return;
    }

    if (!to.trim()) {
      error = "Please enter a recipient";
      return;
    }

    if (!subject.trim()) {
      error = "Please enter a subject";
      return;
    }

    sending = true;
    error = "";

    try {
      const result = await api.sendEmail({
        accountId,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        body: body || "<p></p>",
        replyToId: replyTo?.id,
      });

      if (result.error) {
        error = result.error;
      } else {
        // Success - delete the draft and go back to inbox
        try {
          await api.deleteDraft(draftId);
          drafts.update(d => d.filter(draft => draft.id !== draftId));
        } catch (e) {
          // Ignore errors when deleting draft
        }
        view.set("inbox");
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to send";
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Cmd/Ctrl + Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
    // Escape to close (unless in textarea with content)
    if (e.key === "Escape") {
      if (!body && !to && !subject) {
        handleClose();
      }
    }
  }
</script>

<div class="compose" onkeydown={handleKeydown}>
  <header class="header">
    <h2>
      {#if mode === "reply"}
        Reply
      {:else if mode === "replyAll"}
        Reply All
      {:else if mode === "forward"}
        Forward
      {:else}
        New Message
      {/if}
    </h2>
    <div class="header-actions">
      <button class="close-btn" onclick={handleClose}>✕</button>
    </div>
  </header>

  <div class="fields">
    <div class="field">
      <label for="to">To</label>
      <input
        bind:this={toInput}
        id="to"
        type="text"
        bind:value={to}
        placeholder="recipient@example.com"
      />
      <div class="field-actions">
        {#if !showCc}
          <button class="link-btn" onclick={() => (showCc = true)}>Cc</button>
        {/if}
        {#if !showBcc}
          <button class="link-btn" onclick={() => (showBcc = true)}>Bcc</button>
        {/if}
      </div>
    </div>

    {#if showCc}
      <div class="field">
        <label for="cc">Cc</label>
        <input id="cc" type="text" bind:value={cc} placeholder="cc@example.com" />
      </div>
    {/if}

    {#if showBcc}
      <div class="field">
        <label for="bcc">Bcc</label>
        <input id="bcc" type="text" bind:value={bcc} placeholder="bcc@example.com" />
      </div>
    {/if}

    <div class="field">
      <label for="subject">Subject</label>
      <input id="subject" type="text" bind:value={subject} placeholder="Subject" />
    </div>
  </div>

  <div class="body-wrapper">
    <textarea
      class="compose-body"
      bind:value={body}
      placeholder="Write your message..."
    ></textarea>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <footer class="footer">
    <button class="send-btn primary" onclick={handleSend} disabled={sending}>
      {#if sending}
        Sending...
      {:else}
        Send
      {/if}
      <kbd>⌘↵</kbd>
    </button>
    <button class="discard-btn" onclick={handleClose}>Discard</button>
    {#if lastSaved}
      <span class="saved-indicator">Saved at {lastSaved}</span>
    {/if}
  </footer>
</div>

<style>
  .compose {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .header h2 {
    font-size: 16px;
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

  .fields {
    padding: 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1px solid var(--border);
  }

  .field {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .field label {
    width: 60px;
    font-size: 13px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .field input {
    flex: 1;
    background: transparent;
    border: none;
    padding: 8px 0;
    font-size: 14px;
    color: var(--text-primary);
    outline: none;
  }

  .field input::placeholder {
    color: var(--text-muted);
  }

  .field-actions {
    display: flex;
    gap: 8px;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    font-size: 13px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .link-btn:hover {
    text-decoration: underline;
  }

  .body-wrapper {
    flex: 1;
    padding: 16px 24px;
    overflow: hidden;
    display: flex;
  }

  .compose-body {
    flex: 1;
    background: transparent;
    border: none;
    resize: none;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
  }

  .compose-body::placeholder {
    color: var(--text-muted);
  }

  .error {
    padding: 12px 24px;
    background: var(--danger);
    color: white;
    font-size: 13px;
  }

  .footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .send-btn {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .send-btn kbd {
    opacity: 0.7;
    font-size: 11px;
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .discard-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .discard-btn:hover {
    color: var(--danger);
  }

  .saved-indicator {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
