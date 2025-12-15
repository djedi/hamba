<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api, type Email, type Draft } from "$lib/api";
  import { view, selectedAccountId, currentDraftId, drafts, showToast, dismissToast, scheduledEmails, snippets, snippetActions } from "$lib/stores";
  import { get } from "svelte/store";

  interface Props {
    replyTo?: Email | null;
    mode?: "new" | "reply" | "replyAll" | "forward";
    draft?: Draft | null;
  }

  interface AttachmentFile {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    content: string; // base64 encoded
  }

  let { replyTo = null, mode = "new", draft = null }: Props = $props();

  let to = $state("");
  let cc = $state("");
  let bcc = $state("");
  let subject = $state("");
  let body = $state("");
  // Load CC/BCC visibility preferences from localStorage
  const savedShowCc = typeof localStorage !== 'undefined' ? localStorage.getItem('compose.showCc') === 'true' : false;
  const savedShowBcc = typeof localStorage !== 'undefined' ? localStorage.getItem('compose.showBcc') === 'true' : false;
  let showCc = $state(savedShowCc);
  let showBcc = $state(savedShowBcc);

  // Persist CC/BCC preferences when they change
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('compose.showCc', String(showCc));
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('compose.showBcc', String(showBcc));
    }
  });
  let sending = $state(false);
  let error = $state("");
  let lastSaved = $state<string | null>(null);
  let reminderDays = $state<number | null>(null);
  let showReminderPicker = $state(false);
  let attachments = $state<AttachmentFile[]>([]);
  let isDragging = $state(false);
  let showSchedulePicker = $state(false);
  let customScheduleDate = $state("");
  let customScheduleTime = $state("");
  let snippetQuery = $state("");
  let showSnippetSuggestions = $state(false);
  let selectedSnippetIndex = $state(0);

  let toInput: HTMLInputElement;
  let fileInput: HTMLInputElement;
  let bodyTextarea: HTMLTextAreaElement;
  let draftId = draft?.id || crypto.randomUUID();
  let autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSavedContent = "";

  // Filter snippets based on query
  $effect(() => {
    if (snippetQuery) {
      selectedSnippetIndex = 0;
    }
  });

  // Get filtered snippets
  function getFilteredSnippets() {
    const $snippets = get(snippets);
    if (!snippetQuery) return [];
    const query = snippetQuery.toLowerCase();
    return $snippets.filter(
      (s) => s.shortcut.toLowerCase().startsWith(query) || s.name.toLowerCase().includes(query)
    );
  }

  // Check if body text ends with a snippet trigger pattern (;shortcut)
  function checkForSnippetTrigger(text: string, cursorPos: number): string | null {
    // Look backward from cursor to find a semicolon
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastSemicolon = textBeforeCursor.lastIndexOf(";");

    if (lastSemicolon === -1) return null;

    // Check if there's only valid shortcut characters after the semicolon
    const afterSemicolon = textBeforeCursor.slice(lastSemicolon + 1);

    // If there's a space or newline, the trigger is broken
    if (/[\s\n]/.test(afterSemicolon)) return null;

    // Valid shortcut characters: alphanumeric, underscore, hyphen
    if (!/^[a-zA-Z0-9_-]*$/.test(afterSemicolon)) return null;

    return afterSemicolon;
  }

  // Handle body input and check for snippet triggers
  function handleBodyInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    const cursorPos = textarea.selectionStart || 0;
    const trigger = checkForSnippetTrigger(textarea.value, cursorPos);

    if (trigger !== null) {
      snippetQuery = trigger;
      const filteredSnippets = getFilteredSnippets();
      showSnippetSuggestions = filteredSnippets.length > 0;
      selectedSnippetIndex = 0;
    } else {
      snippetQuery = "";
      showSnippetSuggestions = false;
    }
  }

  // Expand a snippet at the current cursor position
  function expandSnippet(snippetContent: string) {
    if (!bodyTextarea) return;

    const cursorPos = bodyTextarea.selectionStart || 0;
    const text = body;

    // Find the start of the trigger (the semicolon)
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastSemicolon = textBeforeCursor.lastIndexOf(";");

    if (lastSemicolon === -1) return;

    // Replace from semicolon to cursor with the snippet content
    const beforeTrigger = text.slice(0, lastSemicolon);
    const afterCursor = text.slice(cursorPos);

    body = beforeTrigger + snippetContent + afterCursor;

    // Reset snippet state
    snippetQuery = "";
    showSnippetSuggestions = false;

    // Move cursor to end of inserted content
    setTimeout(() => {
      if (bodyTextarea) {
        const newCursorPos = beforeTrigger.length + snippetContent.length;
        bodyTextarea.setSelectionRange(newCursorPos, newCursorPos);
        bodyTextarea.focus();
      }
    }, 0);
  }

  // Handle snippet selection
  function selectSnippet(index: number) {
    const filtered = getFilteredSnippets();
    if (index >= 0 && index < filtered.length) {
      expandSnippet(filtered[index].content);
    }
  }

  // Handle keyboard navigation in snippet suggestions
  function handleSnippetKeydown(e: KeyboardEvent) {
    if (!showSnippetSuggestions) return false;

    const filtered = getFilteredSnippets();
    if (filtered.length === 0) return false;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedSnippetIndex = (selectedSnippetIndex + 1) % filtered.length;
      return true;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedSnippetIndex = (selectedSnippetIndex - 1 + filtered.length) % filtered.length;
      return true;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectSnippet(selectedSnippetIndex);
      return true;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      snippetQuery = "";
      showSnippetSuggestions = false;
      return true;
    }

    return false;
  }

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

    // Load snippets for the current account
    const accountId = get(selectedAccountId);
    if (accountId) {
      snippetActions.loadSnippets(accountId);
    }

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

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;

    for (const file of Array.from(files)) {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1]; // Remove data:mime;base64, prefix
        attachments = [
          ...attachments,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            content: base64,
          },
        ];
      };
      reader.readAsDataURL(file);
    }
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter((a) => a.id !== id);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    addFiles(e.dataTransfer?.files || null);
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    addFiles(input.files);
    input.value = ""; // Reset so same file can be selected again
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

    // Store form data for potential undo/retry
    const sendData = {
      accountId,
      to: to.trim(),
      cc: cc.trim() || undefined,
      bcc: bcc.trim() || undefined,
      subject: subject.trim(),
      body: body || "<p></p>",
      replyToId: replyTo?.id,
      attachments: attachments.length > 0
        ? attachments.map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            content: a.content,
          }))
        : undefined,
    };

    // Store reminder setting
    const savedReminderDays = reminderDays;

    try {
      // Queue the email for sending (with undo window)
      const result = await api.queueSendEmail(sendData);

      if (result.error) {
        error = result.error;
        sending = false;
        return;
      }

      // Success - delete the draft
      try {
        await api.deleteDraft(draftId);
        drafts.update(d => d.filter(draft => draft.id !== draftId));
      } catch (e) {
        // Ignore errors when deleting draft
      }

      // Navigate back to inbox immediately
      view.set("inbox");
      sending = false;

      // Show toast with undo option
      const undoWindowMs = (result.undoWindowSeconds || 5) * 1000;
      let undone = false;

      const toastId = showToast("Email sent", "success", {
        duration: undoWindowMs,
        action: {
          label: "Undo",
          onClick: async () => {
            if (undone) return;
            undone = true;

            try {
              const cancelResult = await api.cancelPendingSend(result.pendingId!);
              if (cancelResult.success) {
                showToast("Email cancelled", "success");
                // Re-open compose with the same data
                // The user can manually re-compose if needed
              } else {
                showToast(cancelResult.error || "Could not undo - email already sent", "error");
              }
            } catch (e) {
              showToast("Could not undo - email already sent", "error");
            }
          },
        },
      });

      // Handle reminder setting after the email is sent (after undo window)
      if (savedReminderDays !== null) {
        setTimeout(async () => {
          if (undone) return; // Don't set reminder if undone

          try {
            // Sync sent folder to get the sent email
            await api.syncSentEmails(accountId);
            // Get sent emails and find the one we just sent
            const sentEmails = await api.getSentEmails(accountId, 10);
            // Find the email that matches our subject and recipient (best effort)
            const sentEmail = sentEmails.find(
              e => e.subject === sendData.subject && e.to_addresses.includes(sendData.to.split(',')[0])
            );
            if (sentEmail) {
              // Set reminder for X days from now
              const remindAt = Math.floor(Date.now() / 1000) + (savedReminderDays * 24 * 60 * 60);
              await api.setReminder(sentEmail.id, remindAt);
            }
          } catch (e) {
            console.error("Failed to set reminder on sent email:", e);
            // Don't show error to user - the email was sent successfully
          }
        }, undoWindowMs + 2000); // Wait a bit after undo window for the email to be sent
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to send";
      sending = false;
    }
  }

  let ccInput: HTMLInputElement;
  let bccInput: HTMLInputElement;

  function handleKeydown(e: KeyboardEvent) {
    // Handle snippet keyboard navigation first
    if (handleSnippetKeydown(e)) {
      return;
    }

    // Cmd/Ctrl + Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }

    // Cmd/Ctrl + Shift + C to toggle/focus Cc field
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      showCc = true;
      setTimeout(() => ccInput?.focus(), 0);
    }

    // Cmd/Ctrl + Shift + B to toggle/focus Bcc field
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      showBcc = true;
      setTimeout(() => bccInput?.focus(), 0);
    }

    // Escape to close (unless in textarea with content or snippet suggestions shown)
    if (e.key === "Escape") {
      if (showSnippetSuggestions) {
        snippetQuery = "";
        showSnippetSuggestions = false;
        return;
      }
      if (!body && !to && !subject) {
        handleClose();
      }
    }
  }

  // Schedule presets (returns Unix timestamp)
  function getSchedulePreset(preset: string): number {
    const now = new Date();
    const date = new Date();

    switch (preset) {
      case "tomorrow-morning":
        date.setDate(now.getDate() + 1);
        date.setHours(9, 0, 0, 0);
        break;
      case "tomorrow-afternoon":
        date.setDate(now.getDate() + 1);
        date.setHours(14, 0, 0, 0);
        break;
      case "monday-morning": {
        const dayOfWeek = now.getDay();
        const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
        date.setDate(now.getDate() + daysUntilMonday);
        date.setHours(9, 0, 0, 0);
        break;
      }
      default:
        return 0;
    }

    return Math.floor(date.getTime() / 1000);
  }

  function formatPresetLabel(preset: string): string {
    const timestamp = getSchedulePreset(preset);
    if (!timestamp) return "";
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
           " at " + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function handleSchedule(sendAt: number) {
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
    showSchedulePicker = false;

    try {
      const result = await api.scheduleEmail({
        accountId,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        body: body || "<p></p>",
        replyToId: replyTo?.id,
        attachments: attachments.length > 0
          ? attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              content: a.content,
            }))
          : undefined,
        sendAt,
      });

      if (result.error) {
        error = result.error;
        sending = false;
        return;
      }

      // Success - delete the draft
      try {
        await api.deleteDraft(draftId);
        drafts.update(d => d.filter(draft => draft.id !== draftId));
      } catch (e) {
        // Ignore errors when deleting draft
      }

      // Update scheduled emails list
      const scheduled = await api.getScheduledEmails(accountId);
      scheduledEmails.set(scheduled);

      // Navigate back to inbox
      view.set("inbox");
      sending = false;

      // Show success toast
      const sendDate = new Date(sendAt * 1000);
      const formattedDate = sendDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
                           " at " + sendDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      showToast(`Email scheduled for ${formattedDate}`, "success");
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to schedule";
      sending = false;
    }
  }

  function handleCustomSchedule() {
    if (!customScheduleDate || !customScheduleTime) {
      error = "Please select date and time";
      return;
    }

    const dateTime = new Date(`${customScheduleDate}T${customScheduleTime}`);
    const sendAt = Math.floor(dateTime.getTime() / 1000);

    // Ensure it's in the future
    const now = Math.floor(Date.now() / 1000);
    if (sendAt <= now) {
      error = "Scheduled time must be in the future";
      return;
    }

    handleSchedule(sendAt);
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
        <input bind:this={ccInput} id="cc" type="text" bind:value={cc} placeholder="cc@example.com" />
      </div>
    {/if}

    {#if showBcc}
      <div class="field">
        <label for="bcc">Bcc</label>
        <input bind:this={bccInput} id="bcc" type="text" bind:value={bcc} placeholder="bcc@example.com" />
      </div>
    {/if}

    <div class="field">
      <label for="subject">Subject</label>
      <input id="subject" type="text" bind:value={subject} placeholder="Subject" />
    </div>
  </div>

  <div
    class="body-wrapper"
    class:dragging={isDragging}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <textarea
      class="compose-body"
      bind:this={bodyTextarea}
      bind:value={body}
      oninput={handleBodyInput}
      placeholder="Write your message... (type ;shortcut to expand snippets)"
    ></textarea>
    {#if showSnippetSuggestions}
      {@const filteredSnippets = getFilteredSnippets()}
      <div class="snippet-suggestions">
        <div class="snippet-header">Snippets</div>
        {#each filteredSnippets as snippet, index (snippet.id)}
          <button
            class="snippet-item"
            class:selected={index === selectedSnippetIndex}
            onclick={() => selectSnippet(index)}
            onmouseenter={() => selectedSnippetIndex = index}
          >
            <span class="snippet-shortcut">;{snippet.shortcut}</span>
            <span class="snippet-name">{snippet.name}</span>
          </button>
        {/each}
        <div class="snippet-hint">
          <kbd>↑</kbd><kbd>↓</kbd> to navigate, <kbd>Tab</kbd> or <kbd>Enter</kbd> to expand, <kbd>Esc</kbd> to dismiss
        </div>
      </div>
    {/if}
    {#if isDragging}
      <div class="drop-overlay">
        Drop files to attach
      </div>
    {/if}
  </div>

  {#if attachments.length > 0}
    <div class="attachments">
      {#each attachments as attachment (attachment.id)}
        <div class="attachment">
          <span class="attachment-icon">📎</span>
          <span class="attachment-name">{attachment.filename}</span>
          <span class="attachment-size">{formatFileSize(attachment.size)}</span>
          <button
            class="attachment-remove"
            onclick={() => removeAttachment(attachment.id)}
            title="Remove attachment"
          >
            ✕
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <input
    type="file"
    multiple
    bind:this={fileInput}
    onchange={handleFileSelect}
    style="display: none;"
  />

  <footer class="footer">
    <button class="send-btn primary" onclick={handleSend} disabled={sending}>
      {#if sending}
        Sending...
      {:else}
        Send
      {/if}
      <kbd>⌘↵</kbd>
    </button>
    <div class="schedule-picker">
      <button
        class="schedule-btn"
        onclick={() => showSchedulePicker = !showSchedulePicker}
        disabled={sending}
      >
        📅 Schedule
      </button>
      {#if showSchedulePicker}
        <div class="schedule-dropdown">
          <div class="schedule-section">
            <button onclick={() => handleSchedule(getSchedulePreset('tomorrow-morning'))}>
              <span class="schedule-label">Tomorrow morning</span>
              <span class="schedule-time">{formatPresetLabel('tomorrow-morning')}</span>
            </button>
            <button onclick={() => handleSchedule(getSchedulePreset('tomorrow-afternoon'))}>
              <span class="schedule-label">Tomorrow afternoon</span>
              <span class="schedule-time">{formatPresetLabel('tomorrow-afternoon')}</span>
            </button>
            <button onclick={() => handleSchedule(getSchedulePreset('monday-morning'))}>
              <span class="schedule-label">Monday morning</span>
              <span class="schedule-time">{formatPresetLabel('monday-morning')}</span>
            </button>
          </div>
          <div class="schedule-divider"></div>
          <div class="schedule-custom">
            <span class="schedule-custom-label">Custom time</span>
            <div class="schedule-custom-inputs">
              <input type="date" bind:value={customScheduleDate} min={new Date().toISOString().split('T')[0]} />
              <input type="time" bind:value={customScheduleTime} />
            </div>
            <button class="schedule-custom-btn" onclick={handleCustomSchedule}>
              Schedule
            </button>
          </div>
        </div>
      {/if}
    </div>
    <div class="reminder-picker">
      <button
        class="reminder-btn"
        class:active={reminderDays !== null}
        onclick={() => showReminderPicker = !showReminderPicker}
      >
        🔔 {reminderDays !== null ? `${reminderDays}d` : 'Remind'}
      </button>
      {#if showReminderPicker}
        <div class="reminder-dropdown">
          <button onclick={() => { reminderDays = null; showReminderPicker = false; }}>No reminder</button>
          <button onclick={() => { reminderDays = 1; showReminderPicker = false; }}>1 day</button>
          <button onclick={() => { reminderDays = 2; showReminderPicker = false; }}>2 days</button>
          <button onclick={() => { reminderDays = 3; showReminderPicker = false; }}>3 days</button>
          <button onclick={() => { reminderDays = 7; showReminderPicker = false; }}>1 week</button>
          <button onclick={() => { reminderDays = 14; showReminderPicker = false; }}>2 weeks</button>
        </div>
      {/if}
    </div>
    <button class="attach-btn" onclick={() => fileInput?.click()}>
      📎 Attach
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
    position: relative;
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

  .reminder-picker {
    position: relative;
  }

  .reminder-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
  }

  .reminder-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .reminder-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .reminder-dropdown {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    z-index: 10;
    min-width: 120px;
  }

  .reminder-dropdown button {
    display: block;
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    border: none;
    text-align: left;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 13px;
  }

  .reminder-dropdown button:hover {
    background: var(--bg-hover);
  }

  .body-wrapper.dragging {
    background: var(--bg-hover);
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(99, 102, 241, 0.1);
    border: 2px dashed var(--accent);
    border-radius: 8px;
    color: var(--accent);
    font-size: 16px;
    font-weight: 500;
    pointer-events: none;
  }

  .attachments {
    padding: 8px 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    border-top: 1px solid var(--border);
  }

  .attachment {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
  }

  .attachment-icon {
    font-size: 14px;
  }

  .attachment-name {
    color: var(--text-primary);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-size {
    color: var(--text-muted);
    font-size: 12px;
  }

  .attachment-remove {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 12px;
    line-height: 1;
    border-radius: 4px;
  }

  .attachment-remove:hover {
    background: var(--danger);
    color: white;
  }

  .attach-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
  }

  .attach-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .schedule-picker {
    position: relative;
  }

  .schedule-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
  }

  .schedule-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .schedule-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .schedule-dropdown {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    z-index: 10;
    min-width: 250px;
  }

  .schedule-section button {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    gap: 2px;
  }

  .schedule-section button:hover {
    background: var(--bg-hover);
  }

  .schedule-label {
    color: var(--text-primary);
    font-size: 13px;
  }

  .schedule-time {
    color: var(--text-muted);
    font-size: 11px;
  }

  .schedule-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .schedule-custom {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .schedule-custom-label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .schedule-custom-inputs {
    display: flex;
    gap: 8px;
  }

  .schedule-custom-inputs input {
    flex: 1;
    padding: 6px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
  }

  .schedule-custom-inputs input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .schedule-custom-btn {
    padding: 8px 12px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 13px;
    cursor: pointer;
  }

  .schedule-custom-btn:hover {
    filter: brightness(1.1);
  }

  .snippet-suggestions {
    position: absolute;
    top: 0;
    right: 24px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    z-index: 20;
    min-width: 250px;
    max-width: 350px;
    max-height: 300px;
    overflow-y: auto;
  }

  .snippet-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .snippet-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .snippet-item:hover,
  .snippet-item.selected {
    background: var(--bg-hover);
  }

  .snippet-item.selected {
    background: var(--accent);
  }

  .snippet-item.selected .snippet-shortcut,
  .snippet-item.selected .snippet-name {
    color: white;
  }

  .snippet-shortcut {
    font-family: monospace;
    font-size: 13px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .snippet-name {
    font-size: 13px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet-hint {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .snippet-hint kbd {
    display: inline-block;
    padding: 2px 5px;
    font-size: 10px;
    font-family: monospace;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 3px;
    margin: 0 2px;
  }
</style>
