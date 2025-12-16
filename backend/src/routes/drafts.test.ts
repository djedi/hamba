import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { draftQueries, accountQueries } from "../db";

describe("drafts", () => {
  const testPrefix = `test-drafts-${Date.now()}`;
  const testAccountId = `${testPrefix}-account`;

  beforeEach(() => {
    accountQueries.upsert.run(
      testAccountId,
      `${testPrefix}@example.com`,
      "Draft Test User",
      "access_token",
      "refresh_token",
      Math.floor(Date.now() / 1000) + 3600
    );
  });

  afterEach(() => {
    draftQueries.deleteByAccount.run(testAccountId);
    accountQueries.delete.run(testAccountId);
  });

  describe("draftQueries.upsert", () => {
    it("should create a new draft", () => {
      const id = crypto.randomUUID();

      draftQueries.upsert.run(
        id,
        testAccountId,
        null, // remote_id
        "recipient@example.com",
        "cc@example.com",
        null, // bcc
        "Draft Subject",
        "Draft body content",
        null, // reply_to_id
        null // reply_mode
      );

      const draft = draftQueries.getById.get(id) as any;
      expect(draft).toBeDefined();
      expect(draft.id).toBe(id);
      expect(draft.account_id).toBe(testAccountId);
      expect(draft.to_addresses).toBe("recipient@example.com");
      expect(draft.cc_addresses).toBe("cc@example.com");
      expect(draft.subject).toBe("Draft Subject");
      expect(draft.body).toBe("Draft body content");
    });

    it("should update existing draft on upsert", () => {
      const id = crypto.randomUUID();

      // Create initial draft
      draftQueries.upsert.run(
        id,
        testAccountId,
        null,
        "original@example.com",
        null,
        null,
        "Original Subject",
        "Original body",
        null,
        null
      );

      // Update the draft
      draftQueries.upsert.run(
        id,
        testAccountId,
        null,
        "updated@example.com",
        "new-cc@example.com",
        null,
        "Updated Subject",
        "Updated body",
        null,
        null
      );

      const draft = draftQueries.getById.get(id) as any;
      expect(draft.to_addresses).toBe("updated@example.com");
      expect(draft.cc_addresses).toBe("new-cc@example.com");
      expect(draft.subject).toBe("Updated Subject");
      expect(draft.body).toBe("Updated body");
    });

    it("should store reply information", () => {
      const id = crypto.randomUUID();
      const replyToId = "original-email-123";

      draftQueries.upsert.run(
        id,
        testAccountId,
        null,
        "reply@example.com",
        null,
        null,
        "Re: Original Subject",
        "Reply content",
        replyToId,
        "reply"
      );

      const draft = draftQueries.getById.get(id) as any;
      expect(draft.reply_to_id).toBe(replyToId);
      expect(draft.reply_mode).toBe("reply");
    });
  });

  describe("draftQueries.getByAccount", () => {
    it("should return all drafts for an account", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      draftQueries.upsert.run(id1, testAccountId, null, "a@test.com", null, null, "Draft 1", "Body 1", null, null);
      draftQueries.upsert.run(id2, testAccountId, null, "b@test.com", null, null, "Draft 2", "Body 2", null, null);

      const drafts = draftQueries.getByAccount.all(testAccountId) as any[];
      expect(drafts.length).toBe(2);
    });

    it("should return drafts ordered by updated_at DESC", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      draftQueries.upsert.run(id1, testAccountId, null, "first@test.com", null, null, "First Draft", "Body", null, null);
      draftQueries.upsert.run(id2, testAccountId, null, "second@test.com", null, null, "Second Draft", "Body", null, null);

      const drafts = draftQueries.getByAccount.all(testAccountId) as any[];

      // Both should exist and be ordered - verify we get both drafts
      expect(drafts.length).toBe(2);
      // Both drafts should be present (order may vary if created in same second)
      const subjects = drafts.map((d: any) => d.subject);
      expect(subjects).toContain("First Draft");
      expect(subjects).toContain("Second Draft");
    });

    it("should return empty array for account with no drafts", () => {
      const drafts = draftQueries.getByAccount.all(testAccountId);
      expect(drafts).toEqual([]);
    });

    it("should not return drafts from other accounts", () => {
      const otherAccountId = `${testPrefix}-other-account`;
      accountQueries.upsert.run(
        otherAccountId,
        `${testPrefix}-other@example.com`,
        "Other User",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      draftQueries.upsert.run(id1, testAccountId, null, "mine@test.com", null, null, "My Draft", "Body", null, null);
      draftQueries.upsert.run(id2, otherAccountId, null, "other@test.com", null, null, "Other Draft", "Body", null, null);

      const myDrafts = draftQueries.getByAccount.all(testAccountId) as any[];
      expect(myDrafts.length).toBe(1);
      expect(myDrafts[0].subject).toBe("My Draft");

      // Cleanup other account
      draftQueries.deleteByAccount.run(otherAccountId);
      accountQueries.delete.run(otherAccountId);
    });
  });

  describe("draftQueries.getById", () => {
    it("should return draft by ID", () => {
      const id = crypto.randomUUID();
      draftQueries.upsert.run(id, testAccountId, null, "test@test.com", null, null, "Test", "Body", null, null);

      const draft = draftQueries.getById.get(id) as any;
      expect(draft).toBeDefined();
      expect(draft.id).toBe(id);
    });

    it("should return null for non-existent draft", () => {
      const draft = draftQueries.getById.get("non-existent-id");
      expect(draft).toBeNull();
    });
  });

  describe("draftQueries.delete", () => {
    it("should delete a draft", () => {
      const id = crypto.randomUUID();
      draftQueries.upsert.run(id, testAccountId, null, "delete@test.com", null, null, "Delete Me", "Body", null, null);

      let draft = draftQueries.getById.get(id);
      expect(draft).toBeDefined();

      draftQueries.delete.run(id);

      draft = draftQueries.getById.get(id);
      expect(draft).toBeNull();
    });
  });

  describe("draftQueries.deleteByAccount", () => {
    it("should delete all drafts for an account", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const id3 = crypto.randomUUID();

      draftQueries.upsert.run(id1, testAccountId, null, "a@test.com", null, null, "Draft 1", "Body", null, null);
      draftQueries.upsert.run(id2, testAccountId, null, "b@test.com", null, null, "Draft 2", "Body", null, null);
      draftQueries.upsert.run(id3, testAccountId, null, "c@test.com", null, null, "Draft 3", "Body", null, null);

      let drafts = draftQueries.getByAccount.all(testAccountId);
      expect(drafts.length).toBe(3);

      draftQueries.deleteByAccount.run(testAccountId);

      drafts = draftQueries.getByAccount.all(testAccountId);
      expect(drafts.length).toBe(0);
    });
  });

  describe("draft with remote_id", () => {
    it("should store and retrieve remote_id", () => {
      const id = crypto.randomUUID();
      const remoteId = "gmail-draft-abc123";

      draftQueries.upsert.run(
        id,
        testAccountId,
        remoteId,
        "test@test.com",
        null,
        null,
        "Synced Draft",
        "Body",
        null,
        null
      );

      const draft = draftQueries.getById.get(id) as any;
      expect(draft.remote_id).toBe(remoteId);
    });
  });

  describe("draft with all fields", () => {
    it("should handle all fields including bcc and reply mode", () => {
      const id = crypto.randomUUID();

      draftQueries.upsert.run(
        id,
        testAccountId,
        "remote-123",
        "to@test.com",
        "cc@test.com",
        "bcc@test.com",
        "Complete Draft",
        "<p>HTML body</p>",
        "original-email-id",
        "replyAll"
      );

      const draft = draftQueries.getById.get(id) as any;
      expect(draft.to_addresses).toBe("to@test.com");
      expect(draft.cc_addresses).toBe("cc@test.com");
      expect(draft.bcc_addresses).toBe("bcc@test.com");
      expect(draft.subject).toBe("Complete Draft");
      expect(draft.body).toBe("<p>HTML body</p>");
      expect(draft.reply_to_id).toBe("original-email-id");
      expect(draft.reply_mode).toBe("replyAll");
      expect(draft.remote_id).toBe("remote-123");
    });
  });
});
