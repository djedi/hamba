import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  accountQueries,
  emailQueries,
  attachmentQueries,
  draftQueries,
  labelQueries,
  emailLabelQueries,
  pendingSendQueries,
  scheduledEmailQueries,
  contactQueries,
} from "./index";

describe("Database Queries", () => {
  // Test account prefix to avoid conflicts
  const testPrefix = `test-db-${Date.now()}`;

  describe("accountQueries", () => {
    const testAccountId = `${testPrefix}-account-1`;

    afterEach(() => {
      accountQueries.delete.run(testAccountId);
    });

    it("should upsert a new account", () => {
      accountQueries.upsert.run(
        testAccountId,
        "test@example.com",
        "Test User",
        "access_token_123",
        "refresh_token_456",
        Math.floor(Date.now() / 1000) + 3600
      );

      const account = accountQueries.getById.get(testAccountId) as any;
      expect(account).toBeDefined();
      expect(account.id).toBe(testAccountId);
      expect(account.email).toBe("test@example.com");
      expect(account.name).toBe("Test User");
      expect(account.access_token).toBe("access_token_123");
    });

    it("should update existing account on upsert", () => {
      accountQueries.upsert.run(
        testAccountId,
        "test@example.com",
        "Test User",
        "old_token",
        "old_refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      accountQueries.upsert.run(
        "new-id", // Different ID but same email
        "test@example.com",
        "Updated Name",
        "new_token",
        "new_refresh",
        Math.floor(Date.now() / 1000) + 7200
      );

      const account = accountQueries.getByEmail.get("test@example.com") as any;
      expect(account.name).toBe("Updated Name");
      expect(account.access_token).toBe("new_token");
    });

    it("should get account by email", () => {
      accountQueries.upsert.run(
        testAccountId,
        "unique@example.com",
        "Unique User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      const account = accountQueries.getByEmail.get("unique@example.com") as any;
      expect(account).toBeDefined();
      expect(account.id).toBe(testAccountId);
    });

    it("should return null for non-existent account", () => {
      const account = accountQueries.getById.get("nonexistent-id");
      expect(account).toBeNull();
    });

    it("should update account settings", () => {
      accountQueries.upsert.run(
        testAccountId,
        "settings@example.com",
        "Settings User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      accountQueries.updateSettings.run("Custom Display Name", 120, testAccountId);

      const account = accountQueries.getById.get(testAccountId) as any;
      expect(account.display_name).toBe("Custom Display Name");
      expect(account.sync_frequency_seconds).toBe(120);
    });

    it("should delete account", () => {
      accountQueries.upsert.run(
        testAccountId,
        "delete@example.com",
        "Delete User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      let account = accountQueries.getById.get(testAccountId);
      expect(account).toBeDefined();

      accountQueries.delete.run(testAccountId);

      account = accountQueries.getById.get(testAccountId);
      expect(account).toBeNull();
    });
  });

  describe("emailQueries", () => {
    const testAccountId = `${testPrefix}-email-account`;
    const testEmailId = `${testPrefix}-email-1`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-email@example.com`,
        "Email Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );
    });

    afterEach(() => {
      emailQueries.delete.run(testEmailId);
      emailQueries.delete.run(`${testEmailId}-2`);
      emailQueries.delete.run(`${testEmailId}-3`);
      accountQueries.delete.run(testAccountId);
    });

    it("should upsert a new email", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Test Subject",
        "This is a snippet...",
        "John Doe",
        "john@example.com",
        "recipient@example.com",
        null, // cc
        null, // bcc
        "Plain text body",
        "<p>HTML body</p>",
        JSON.stringify(["INBOX"]),
        0, // is_read
        0, // is_starred
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      const email = emailQueries.getById.get(testEmailId) as any;
      expect(email).toBeDefined();
      expect(email.id).toBe(testEmailId);
      expect(email.subject).toBe("Test Subject");
      expect(email.from_name).toBe("John Doe");
      expect(email.from_email).toBe("john@example.com");
    });

    it("should mark email as read/unread", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Test",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_read).toBe(0);

      emailQueries.markRead.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_read).toBe(1);

      emailQueries.markUnread.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_read).toBe(0);
    });

    it("should star/unstar email", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Test",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      emailQueries.star.run(testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_starred).toBe(1);

      emailQueries.unstar.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_starred).toBe(0);
    });

    it("should archive/unarchive email", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Test",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      emailQueries.archive.run(testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_archived).toBe(1);

      emailQueries.unarchive.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_archived).toBe(0);
    });

    it("should trash/untrash email", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Test",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      emailQueries.trash.run(testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_trashed).toBe(1);
      expect(email.trashed_at).toBeDefined();

      emailQueries.untrash.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_trashed).toBe(0);
      expect(email.trashed_at).toBeNull();
    });

    it("should get emails by account", () => {
      const now = Math.floor(Date.now() / 1000);

      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Email 1",
        "Snippet 1",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        now,
        "inbox"
      );

      emailQueries.upsert.run(
        `${testEmailId}-2`,
        testAccountId,
        "thread-2",
        "message-id-2",
        "Email 2",
        "Snippet 2",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        now - 60,
        "inbox"
      );

      const emails = emailQueries.getByAccount.all(testAccountId, 50, 0) as any[];
      expect(emails.length).toBe(2);
      // Should be ordered by received_at DESC
      expect(emails[0].subject).toBe("Email 1");
      expect(emails[1].subject).toBe("Email 2");
    });

    it("should get starred emails", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Starred Email",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        1, // starred
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      emailQueries.upsert.run(
        `${testEmailId}-2`,
        testAccountId,
        "thread-2",
        "message-id-2",
        "Unstarred Email",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0, // not starred
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      const starred = emailQueries.getStarred.all(testAccountId, 50, 0) as any[];
      expect(starred.length).toBe(1);
      expect(starred[0].subject).toBe("Starred Email");
    });

    it("should get emails by thread", () => {
      const threadId = "test-thread-123";
      const now = Math.floor(Date.now() / 1000);

      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        threadId,
        "message-id-1",
        "First in thread",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        now - 120,
        "inbox"
      );

      emailQueries.upsert.run(
        `${testEmailId}-2`,
        testAccountId,
        threadId,
        "message-id-2",
        "Second in thread",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        now - 60,
        "inbox"
      );

      emailQueries.upsert.run(
        `${testEmailId}-3`,
        testAccountId,
        threadId,
        "message-id-3",
        "Third in thread",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        now,
        "inbox"
      );

      const threadEmails = emailQueries.getByThread.all(threadId) as any[];
      expect(threadEmails.length).toBe(3);
      // Should be ordered by received_at ASC
      expect(threadEmails[0].subject).toBe("First in thread");
      expect(threadEmails[2].subject).toBe("Third in thread");
    });

    it("should set and clear summary", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Email with summary",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      emailQueries.setSummary.run("This is an AI-generated summary.", testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.summary).toBe("This is an AI-generated summary.");
      expect(email.summary_generated_at).toBeDefined();

      emailQueries.clearSummary.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.summary).toBeNull();
    });

    it("should snooze/unsnooze email", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Snoozed Email",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      const snoozeUntil = Math.floor(Date.now() / 1000) + 3600;
      emailQueries.snooze.run(snoozeUntil, testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.snoozed_until).toBe(snoozeUntil);

      emailQueries.unsnooze.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.snoozed_until).toBeNull();
    });

    it("should set/clear reminder", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Reminder Email",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      const remindAt = Math.floor(Date.now() / 1000) + 86400;
      emailQueries.setReminder.run(remindAt, testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.remind_at).toBe(remindAt);

      emailQueries.clearReminder.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.remind_at).toBeNull();
    });

    it("should mark/unmark as important", () => {
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Important Email",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      emailQueries.markImportant.run(testEmailId);
      let email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_important).toBe(1);

      emailQueries.markNotImportant.run(testEmailId);
      email = emailQueries.getById.get(testEmailId) as any;
      expect(email.is_important).toBe(0);
    });

    describe("advancedSearch", () => {
      beforeEach(() => {
        // Insert test emails for search
        emailQueries.upsert.run(
          testEmailId,
          testAccountId,
          "thread-1",
          "message-id-search-1",
          "Project Update Meeting",
          "Weekly standup notes",
          "Alice Smith",
          "alice@company.com",
          "team@company.com",
          null,
          null,
          "Here are the weekly updates for our project.",
          "<p>Weekly updates</p>",
          "[]",
          0, // unread
          1, // starred
          Math.floor(Date.now() / 1000) - 3600,
          "inbox"
        );

        emailQueries.upsert.run(
          `${testEmailId}-2`,
          testAccountId,
          "thread-2",
          "message-id-search-2",
          "Invoice #12345",
          "Payment due",
          "Bob Billing",
          "billing@vendor.com",
          "finance@company.com",
          null,
          null,
          "Please pay the attached invoice.",
          "<p>Invoice details</p>",
          "[]",
          1, // read
          0, // not starred
          Math.floor(Date.now() / 1000) - 7200,
          "inbox"
        );
      });

      it("should search by from email", () => {
        const results = emailQueries.advancedSearch({
          from: "alice@company.com",
          accountId: testAccountId,
        }) as any[];

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some((e: any) => e.from_email === "alice@company.com")).toBe(true);
      });

      it("should search by subject", () => {
        const results = emailQueries.advancedSearch({
          subject: "Invoice",
          accountId: testAccountId,
        }) as any[];

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some((e: any) => e.subject.includes("Invoice"))).toBe(true);
      });

      it("should filter unread emails", () => {
        const results = emailQueries.advancedSearch({
          isUnread: true,
          accountId: testAccountId,
        }) as any[];

        for (const email of results) {
          expect(email.is_read).toBe(0);
        }
      });

      it("should filter starred emails", () => {
        const results = emailQueries.advancedSearch({
          isStarred: true,
          accountId: testAccountId,
        }) as any[];

        for (const email of results) {
          expect(email.is_starred).toBe(1);
        }
      });
    });
  });

  describe("draftQueries", () => {
    const testAccountId = `${testPrefix}-draft-account`;
    const testDraftId = `${testPrefix}-draft-1`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-draft@example.com`,
        "Draft Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );
    });

    afterEach(() => {
      draftQueries.deleteByAccount.run(testAccountId);
      accountQueries.delete.run(testAccountId);
    });

    it("should upsert a draft", () => {
      draftQueries.upsert.run(
        testDraftId,
        testAccountId,
        null, // remote_id
        "recipient@test.com",
        null, // cc
        null, // bcc
        "Draft Subject",
        "Draft body content",
        null, // reply_to_id
        null // reply_mode
      );

      const draft = draftQueries.getById.get(testDraftId) as any;
      expect(draft).toBeDefined();
      expect(draft.subject).toBe("Draft Subject");
      expect(draft.body).toBe("Draft body content");
    });

    it("should get drafts by account", () => {
      draftQueries.upsert.run(
        testDraftId,
        testAccountId,
        null,
        "recipient@test.com",
        null,
        null,
        "Draft 1",
        "Content 1",
        null,
        null
      );

      draftQueries.upsert.run(
        `${testDraftId}-2`,
        testAccountId,
        null,
        "other@test.com",
        null,
        null,
        "Draft 2",
        "Content 2",
        null,
        null
      );

      const drafts = draftQueries.getByAccount.all(testAccountId) as any[];
      expect(drafts.length).toBe(2);
    });

    it("should delete draft", () => {
      draftQueries.upsert.run(
        testDraftId,
        testAccountId,
        null,
        "recipient@test.com",
        null,
        null,
        "To Delete",
        "Content",
        null,
        null
      );

      let draft = draftQueries.getById.get(testDraftId);
      expect(draft).toBeDefined();

      draftQueries.delete.run(testDraftId);

      draft = draftQueries.getById.get(testDraftId);
      expect(draft).toBeNull();
    });
  });

  describe("labelQueries", () => {
    const testAccountId = `${testPrefix}-label-account`;
    const testLabelId = `${testPrefix}-label-1`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-label@example.com`,
        "Label Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );
    });

    afterEach(() => {
      labelQueries.deleteByAccount.run(testAccountId);
      accountQueries.delete.run(testAccountId);
    });

    it("should insert a label", () => {
      labelQueries.insert.run(
        testLabelId,
        testAccountId,
        "Work",
        "#ff5722",
        "user",
        "gmail-label-123"
      );

      const label = labelQueries.getById.get(testLabelId) as any;
      expect(label).toBeDefined();
      expect(label.name).toBe("Work");
      expect(label.color).toBe("#ff5722");
    });

    it("should get label by name", () => {
      labelQueries.insert.run(
        testLabelId,
        testAccountId,
        "Personal",
        "#4caf50",
        "user",
        null
      );

      const label = labelQueries.getByName.get(testAccountId, "Personal") as any;
      expect(label).toBeDefined();
      expect(label.id).toBe(testLabelId);
    });

    it("should update label", () => {
      labelQueries.insert.run(
        testLabelId,
        testAccountId,
        "Original",
        "#ffffff",
        "user",
        null
      );

      labelQueries.update.run("Updated", "#000000", testLabelId);

      const label = labelQueries.getById.get(testLabelId) as any;
      expect(label.name).toBe("Updated");
      expect(label.color).toBe("#000000");
    });

    it("should enforce unique name per account", () => {
      labelQueries.insert.run(
        testLabelId,
        testAccountId,
        "Unique Label",
        "#ffffff",
        "user",
        null
      );

      expect(() => {
        labelQueries.insert.run(
          `${testLabelId}-2`,
          testAccountId,
          "Unique Label", // same name
          "#000000",
          "user",
          null
        );
      }).toThrow();
    });
  });

  describe("contactQueries", () => {
    const testAccountId = `${testPrefix}-contact-account`;
    const testContactId = `${testPrefix}-contact-1`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-contact@example.com`,
        "Contact Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );
    });

    afterEach(() => {
      contactQueries.deleteByAccount.run(testAccountId);
      accountQueries.delete.run(testAccountId);
    });

    it("should upsert a contact", () => {
      const now = Math.floor(Date.now() / 1000);
      contactQueries.upsert.run(
        testContactId,
        testAccountId,
        "jane@example.com",
        "Jane Doe",
        now
      );

      const contact = contactQueries.getByEmail.get(testAccountId, "jane@example.com") as any;
      expect(contact).toBeDefined();
      expect(contact.name).toBe("Jane Doe");
      expect(contact.contact_count).toBe(1);
    });

    it("should increment contact count on upsert", () => {
      const now = Math.floor(Date.now() / 1000);
      contactQueries.upsert.run(
        testContactId,
        testAccountId,
        "frequent@example.com",
        "Frequent Contact",
        now
      );

      contactQueries.upsert.run(
        `${testContactId}-2`,
        testAccountId,
        "frequent@example.com",
        "Frequent Contact",
        now + 60
      );

      const contact = contactQueries.getByEmail.get(testAccountId, "frequent@example.com") as any;
      expect(contact.contact_count).toBe(2);
    });

    it("should search contacts", () => {
      const now = Math.floor(Date.now() / 1000);
      contactQueries.upsert.run(
        testContactId,
        testAccountId,
        "alice@example.com",
        "Alice Wonderland",
        now
      );

      contactQueries.upsert.run(
        `${testContactId}-2`,
        testAccountId,
        "bob@example.com",
        "Bob Builder",
        now - 60
      );

      const results = contactQueries.search.all(testAccountId, "%alice%", "%alice%", 10) as any[];
      expect(results.length).toBe(1);
      expect(results[0].email).toBe("alice@example.com");
    });
  });

  describe("scheduledEmailQueries", () => {
    const testAccountId = `${testPrefix}-scheduled-account`;
    const testScheduledId = `${testPrefix}-scheduled-1`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-scheduled@example.com`,
        "Scheduled Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );
    });

    afterEach(() => {
      scheduledEmailQueries.deleteByAccount.run(testAccountId);
      accountQueries.delete.run(testAccountId);
    });

    it("should insert a scheduled email", () => {
      const sendAt = Math.floor(Date.now() / 1000) + 3600;
      scheduledEmailQueries.insert.run(
        testScheduledId,
        testAccountId,
        "recipient@test.com",
        null, // cc
        null, // bcc
        "Scheduled Subject",
        "Scheduled body",
        null, // reply_to_id
        null, // attachments
        sendAt
      );

      const scheduled = scheduledEmailQueries.getById.get(testScheduledId) as any;
      expect(scheduled).toBeDefined();
      expect(scheduled.subject).toBe("Scheduled Subject");
      expect(scheduled.send_at).toBe(sendAt);
    });

    it("should get scheduled emails by account", () => {
      const now = Math.floor(Date.now() / 1000);
      scheduledEmailQueries.insert.run(
        testScheduledId,
        testAccountId,
        "recipient@test.com",
        null,
        null,
        "First Scheduled",
        "Body 1",
        null,
        null,
        now + 7200 // later
      );

      scheduledEmailQueries.insert.run(
        `${testScheduledId}-2`,
        testAccountId,
        "other@test.com",
        null,
        null,
        "Second Scheduled",
        "Body 2",
        null,
        null,
        now + 3600 // earlier
      );

      const scheduled = scheduledEmailQueries.getByAccount.all(testAccountId) as any[];
      expect(scheduled.length).toBe(2);
      // Should be ordered by send_at ASC
      expect(scheduled[0].subject).toBe("Second Scheduled");
      expect(scheduled[1].subject).toBe("First Scheduled");
    });

    it("should get ready scheduled emails", () => {
      const now = Math.floor(Date.now() / 1000);
      scheduledEmailQueries.insert.run(
        testScheduledId,
        testAccountId,
        "recipient@test.com",
        null,
        null,
        "Ready to Send",
        "Body",
        null,
        null,
        now - 60 // in the past
      );

      scheduledEmailQueries.insert.run(
        `${testScheduledId}-2`,
        testAccountId,
        "other@test.com",
        null,
        null,
        "Not Ready",
        "Body",
        null,
        null,
        now + 3600 // in the future
      );

      const ready = scheduledEmailQueries.getReady.all() as any[];
      const readyFromTest = ready.filter((s: any) => s.account_id === testAccountId);
      expect(readyFromTest.length).toBe(1);
      expect(readyFromTest[0].subject).toBe("Ready to Send");
    });

    it("should update scheduled email", () => {
      const sendAt = Math.floor(Date.now() / 1000) + 3600;
      scheduledEmailQueries.insert.run(
        testScheduledId,
        testAccountId,
        "recipient@test.com",
        null,
        null,
        "Original Subject",
        "Original body",
        null,
        null,
        sendAt
      );

      const newSendAt = sendAt + 3600;
      scheduledEmailQueries.update.run(
        "new-recipient@test.com",
        "cc@test.com",
        null,
        "Updated Subject",
        "Updated body",
        null,
        null,
        newSendAt,
        testScheduledId
      );

      const scheduled = scheduledEmailQueries.getById.get(testScheduledId) as any;
      expect(scheduled.subject).toBe("Updated Subject");
      expect(scheduled.to_addresses).toBe("new-recipient@test.com");
      expect(scheduled.send_at).toBe(newSendAt);
    });
  });

  describe("attachmentQueries", () => {
    const testAccountId = `${testPrefix}-att-account`;
    const testEmailId = `${testPrefix}-att-email`;
    const testAttachmentId = `${testPrefix}-attachment-1`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-att@example.com`,
        "Attachment Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-att",
        "Email with attachment",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );
    });

    afterEach(() => {
      attachmentQueries.delete.run(testEmailId);
      emailQueries.delete.run(testEmailId);
      accountQueries.delete.run(testAccountId);
    });

    it("should insert an attachment", () => {
      const imageData = Buffer.from("fake image data");
      attachmentQueries.insert.run(
        testAttachmentId,
        testEmailId,
        "image001",
        "logo.png",
        "image/png",
        imageData.length,
        imageData
      );

      const attachments = attachmentQueries.getByEmailId.all(testEmailId) as any[];
      expect(attachments.length).toBe(1);
      expect(attachments[0].filename).toBe("logo.png");
      expect(attachments[0].mime_type).toBe("image/png");
    });

    it("should get attachment by content ID", () => {
      const imageData = Buffer.from("fake image data");
      attachmentQueries.insert.run(
        testAttachmentId,
        testEmailId,
        "unique-cid",
        "inline.jpg",
        "image/jpeg",
        imageData.length,
        imageData
      );

      const attachment = attachmentQueries.getByContentId.get(testEmailId, "unique-cid") as any;
      expect(attachment).toBeDefined();
      expect(attachment.filename).toBe("inline.jpg");
    });
  });

  describe("emailLabelQueries", () => {
    const testAccountId = `${testPrefix}-el-account`;
    const testEmailId = `${testPrefix}-el-email`;
    const testLabelId = `${testPrefix}-el-label`;

    beforeEach(() => {
      accountQueries.upsert.run(
        testAccountId,
        `${testPrefix}-el@example.com`,
        "Email Label Test User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-el",
        "Labeled Email",
        "Snippet",
        "Sender",
        "sender@test.com",
        "to@test.com",
        null,
        null,
        "body",
        "<p>body</p>",
        "[]",
        0,
        0,
        Math.floor(Date.now() / 1000),
        "inbox"
      );

      labelQueries.insert.run(
        testLabelId,
        testAccountId,
        "Test Label",
        "#ff0000",
        "user",
        null
      );
    });

    afterEach(() => {
      emailLabelQueries.removeAllLabelsFromEmail.run(testEmailId);
      labelQueries.delete.run(testLabelId);
      emailQueries.delete.run(testEmailId);
      accountQueries.delete.run(testAccountId);
    });

    it("should add label to email", () => {
      emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

      const labels = emailLabelQueries.getLabelsForEmail.all(testEmailId) as any[];
      expect(labels.length).toBe(1);
      expect(labels[0].name).toBe("Test Label");
    });

    it("should remove label from email", () => {
      emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

      let labels = emailLabelQueries.getLabelsForEmail.all(testEmailId);
      expect(labels.length).toBe(1);

      emailLabelQueries.removeLabelFromEmail.run(testEmailId, testLabelId);

      labels = emailLabelQueries.getLabelsForEmail.all(testEmailId);
      expect(labels.length).toBe(0);
    });

    it("should get emails for label", () => {
      emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

      const emails = emailLabelQueries.getEmailsForLabel.all(testLabelId, 50, 0) as any[];
      expect(emails.length).toBe(1);
      expect(emails[0].subject).toBe("Labeled Email");
    });

    it("should count emails for label", () => {
      emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

      const result = emailLabelQueries.countEmailsForLabel.get(testLabelId) as { count: number };
      expect(result.count).toBe(1);
    });
  });
});
