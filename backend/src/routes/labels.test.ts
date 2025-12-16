import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { labelQueries, emailLabelQueries, emailQueries, accountQueries } from "../db";

describe("labels", () => {
  const testPrefix = `test-labels-${Date.now()}`;
  const testAccountId = `${testPrefix}-account`;

  beforeEach(() => {
    accountQueries.upsert.run(
      testAccountId,
      `${testPrefix}@example.com`,
      "Label Test User",
      "access_token",
      "refresh_token",
      Math.floor(Date.now() / 1000) + 3600
    );
  });

  afterEach(() => {
    labelQueries.deleteByAccount.run(testAccountId);
    accountQueries.delete.run(testAccountId);
  });

  describe("labelQueries.insert", () => {
    it("should create a label", () => {
      const id = crypto.randomUUID();

      labelQueries.insert.run(
        id,
        testAccountId,
        "Work",
        "#ff5722",
        "user",
        null
      );

      const label = labelQueries.getById.get(id) as any;
      expect(label).toBeDefined();
      expect(label.id).toBe(id);
      expect(label.name).toBe("Work");
      expect(label.color).toBe("#ff5722");
      expect(label.type).toBe("user");
    });

    it("should enforce unique name per account", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      labelQueries.insert.run(id1, testAccountId, "Unique", "#000000", "user", null);

      expect(() => {
        labelQueries.insert.run(id2, testAccountId, "Unique", "#ffffff", "user", null);
      }).toThrow();
    });

    it("should allow same name in different accounts", () => {
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

      labelQueries.insert.run(id1, testAccountId, "Shared Name", "#ff0000", "user", null);
      labelQueries.insert.run(id2, otherAccountId, "Shared Name", "#00ff00", "user", null);

      const label1 = labelQueries.getById.get(id1) as any;
      const label2 = labelQueries.getById.get(id2) as any;

      expect(label1).toBeDefined();
      expect(label2).toBeDefined();
      expect(label1.account_id).not.toBe(label2.account_id);

      // Cleanup
      labelQueries.deleteByAccount.run(otherAccountId);
      accountQueries.delete.run(otherAccountId);
    });

    it("should store remote_id for synced labels", () => {
      const id = crypto.randomUUID();
      const remoteId = "gmail-label-123";

      labelQueries.insert.run(id, testAccountId, "Gmail Label", "#4285f4", "system", remoteId);

      const label = labelQueries.getById.get(id) as any;
      expect(label.remote_id).toBe(remoteId);
      expect(label.type).toBe("system");
    });
  });

  describe("labelQueries.getByAccount", () => {
    it("should return all labels for an account", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      labelQueries.insert.run(id1, testAccountId, "Label A", "#ff0000", "user", null);
      labelQueries.insert.run(id2, testAccountId, "Label B", "#00ff00", "user", null);

      const labels = labelQueries.getByAccount.all(testAccountId) as any[];
      expect(labels.length).toBe(2);
    });

    it("should return labels ordered by type DESC then name ASC", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const id3 = crypto.randomUUID();

      labelQueries.insert.run(id1, testAccountId, "Zebra", "#000000", "user", null);
      labelQueries.insert.run(id2, testAccountId, "Apple", "#000000", "user", null);
      labelQueries.insert.run(id3, testAccountId, "System Label", "#000000", "system", null);

      const labels = labelQueries.getByAccount.all(testAccountId) as any[];

      // 'user' > 'system' alphabetically, so user comes first in DESC order
      // Within same type, sorted by name ASC
      expect(labels[0].name).toBe("Apple"); // user, alphabetically first
      expect(labels[1].name).toBe("Zebra"); // user, alphabetically second
      expect(labels[2].name).toBe("System Label"); // system type comes last in DESC
    });

    it("should return empty array for account with no labels", () => {
      const labels = labelQueries.getByAccount.all(testAccountId);
      expect(labels).toEqual([]);
    });
  });

  describe("labelQueries.getByName", () => {
    it("should find label by name", () => {
      const id = crypto.randomUUID();
      labelQueries.insert.run(id, testAccountId, "Searchable", "#123456", "user", null);

      const label = labelQueries.getByName.get(testAccountId, "Searchable") as any;
      expect(label).toBeDefined();
      expect(label.id).toBe(id);
    });

    it("should return null for non-existent name", () => {
      const label = labelQueries.getByName.get(testAccountId, "Does Not Exist");
      expect(label).toBeNull();
    });

    it("should not find labels from other accounts", () => {
      const otherAccountId = `${testPrefix}-search-other`;
      accountQueries.upsert.run(
        otherAccountId,
        `${testPrefix}-search-other@example.com`,
        "Other",
        "token",
        "refresh",
        Math.floor(Date.now() / 1000) + 3600
      );

      const id = crypto.randomUUID();
      labelQueries.insert.run(id, otherAccountId, "Other Account Label", "#000000", "user", null);

      const label = labelQueries.getByName.get(testAccountId, "Other Account Label");
      expect(label).toBeNull();

      // Cleanup
      labelQueries.deleteByAccount.run(otherAccountId);
      accountQueries.delete.run(otherAccountId);
    });
  });

  describe("labelQueries.getByRemoteId", () => {
    it("should find label by remote ID", () => {
      const id = crypto.randomUUID();
      const remoteId = "gmail-label-xyz";

      labelQueries.insert.run(id, testAccountId, "Remote Label", "#000000", "user", remoteId);

      const label = labelQueries.getByRemoteId.get(testAccountId, remoteId) as any;
      expect(label).toBeDefined();
      expect(label.id).toBe(id);
    });
  });

  describe("labelQueries.upsert", () => {
    it("should create new label if not exists", () => {
      const id = crypto.randomUUID();

      labelQueries.upsert.run(id, testAccountId, "New Label", "#abcdef", "user", null);

      const label = labelQueries.getById.get(id) as any;
      expect(label).toBeDefined();
      expect(label.name).toBe("New Label");
    });

    it("should update existing label on conflict", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      labelQueries.insert.run(id1, testAccountId, "Existing", "#111111", "user", "remote-1");

      // Upsert with same name should update
      labelQueries.upsert.run(id2, testAccountId, "Existing", "#222222", "system", "remote-2");

      const labels = labelQueries.getByAccount.all(testAccountId) as any[];
      expect(labels.length).toBe(1);

      const label = labels[0] as any;
      expect(label.color).toBe("#222222");
      expect(label.type).toBe("system");
    });
  });

  describe("labelQueries.update", () => {
    it("should update label name and color", () => {
      const id = crypto.randomUUID();
      labelQueries.insert.run(id, testAccountId, "Original", "#000000", "user", null);

      labelQueries.update.run("Updated", "#ffffff", id);

      const label = labelQueries.getById.get(id) as any;
      expect(label.name).toBe("Updated");
      expect(label.color).toBe("#ffffff");
    });
  });

  describe("labelQueries.delete", () => {
    it("should delete a label", () => {
      const id = crypto.randomUUID();
      labelQueries.insert.run(id, testAccountId, "To Delete", "#000000", "user", null);

      let label = labelQueries.getById.get(id);
      expect(label).toBeDefined();

      labelQueries.delete.run(id);

      label = labelQueries.getById.get(id);
      expect(label).toBeNull();
    });
  });

  describe("emailLabelQueries", () => {
    const testEmailId = `${testPrefix}-email`;
    const testLabelId = `${testPrefix}-label`;

    beforeEach(() => {
      // Create test email
      emailQueries.upsert.run(
        testEmailId,
        testAccountId,
        "thread-1",
        "message-id-1",
        "Test Email",
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

      // Create test label
      labelQueries.insert.run(testLabelId, testAccountId, "Test Label", "#ff0000", "user", null);
    });

    afterEach(() => {
      emailLabelQueries.removeAllLabelsFromEmail.run(testEmailId);
      emailQueries.delete.run(testEmailId);
    });

    describe("emailLabelQueries.addLabelToEmail", () => {
      it("should add label to email", () => {
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

        const labels = emailLabelQueries.getLabelsForEmail.all(testEmailId) as any[];
        expect(labels.length).toBe(1);
        expect(labels[0].name).toBe("Test Label");
      });

      it("should not duplicate labels (OR IGNORE)", () => {
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

        const labels = emailLabelQueries.getLabelsForEmail.all(testEmailId) as any[];
        expect(labels.length).toBe(1);
      });
    });

    describe("emailLabelQueries.removeLabelFromEmail", () => {
      it("should remove label from email", () => {
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

        let labels = emailLabelQueries.getLabelsForEmail.all(testEmailId);
        expect(labels.length).toBe(1);

        emailLabelQueries.removeLabelFromEmail.run(testEmailId, testLabelId);

        labels = emailLabelQueries.getLabelsForEmail.all(testEmailId);
        expect(labels.length).toBe(0);
      });
    });

    describe("emailLabelQueries.getEmailsForLabel", () => {
      it("should return emails with label", () => {
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

        const emails = emailLabelQueries.getEmailsForLabel.all(testLabelId, 50, 0) as any[];
        expect(emails.length).toBe(1);
        expect(emails[0].subject).toBe("Test Email");
      });

      it("should respect pagination", () => {
        // Create more emails
        const email2Id = `${testPrefix}-email-2`;
        emailQueries.upsert.run(
          email2Id,
          testAccountId,
          "thread-2",
          "message-id-2",
          "Email 2",
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
          Math.floor(Date.now() / 1000) - 60,
          "inbox"
        );

        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);
        emailLabelQueries.addLabelToEmail.run(email2Id, testLabelId);

        const page1 = emailLabelQueries.getEmailsForLabel.all(testLabelId, 1, 0) as any[];
        const page2 = emailLabelQueries.getEmailsForLabel.all(testLabelId, 1, 1) as any[];

        expect(page1.length).toBe(1);
        expect(page2.length).toBe(1);
        expect(page1[0].id).not.toBe(page2[0].id);

        // Cleanup
        emailLabelQueries.removeAllLabelsFromEmail.run(email2Id);
        emailQueries.delete.run(email2Id);
      });

      it("should not return trashed emails", () => {
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

        let emails = emailLabelQueries.getEmailsForLabel.all(testLabelId, 50, 0);
        expect(emails.length).toBe(1);

        emailQueries.trash.run(testEmailId);

        emails = emailLabelQueries.getEmailsForLabel.all(testLabelId, 50, 0);
        expect(emails.length).toBe(0);

        // Restore for cleanup
        emailQueries.untrash.run(testEmailId);
      });
    });

    describe("emailLabelQueries.countEmailsForLabel", () => {
      it("should return count of emails with label", () => {
        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);

        const result = emailLabelQueries.countEmailsForLabel.get(testLabelId) as { count: number };
        expect(result.count).toBe(1);
      });

      it("should return 0 for label with no emails", () => {
        const result = emailLabelQueries.countEmailsForLabel.get(testLabelId) as { count: number };
        expect(result.count).toBe(0);
      });
    });

    describe("emailLabelQueries.removeAllLabelsFromEmail", () => {
      it("should remove all labels from email", () => {
        const label2Id = `${testPrefix}-label-2`;
        labelQueries.insert.run(label2Id, testAccountId, "Label 2", "#00ff00", "user", null);

        emailLabelQueries.addLabelToEmail.run(testEmailId, testLabelId);
        emailLabelQueries.addLabelToEmail.run(testEmailId, label2Id);

        let labels = emailLabelQueries.getLabelsForEmail.all(testEmailId);
        expect(labels.length).toBe(2);

        emailLabelQueries.removeAllLabelsFromEmail.run(testEmailId);

        labels = emailLabelQueries.getLabelsForEmail.all(testEmailId);
        expect(labels.length).toBe(0);
      });
    });
  });
});
