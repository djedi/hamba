import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { snippetQueries, accountQueries } from "../db";

describe("snippets", () => {
  const testAccountId = "test-snippets-account-" + Date.now();

  beforeEach(() => {
    // Create a test account using upsert
    accountQueries.upsert.run(
      testAccountId,
      "test-snippets@example.com",
      "Test User",
      "access_token",
      "refresh_token",
      Math.floor(Date.now() / 1000) + 3600
    );
  });

  afterEach(() => {
    // Clean up test data
    snippetQueries.deleteByAccount.run(testAccountId);
    accountQueries.delete.run(testAccountId);
  });

  describe("snippetQueries.insert", () => {
    it("should create a snippet", () => {
      const id = crypto.randomUUID();
      snippetQueries.insert.run(id, testAccountId, "Meeting Follow-up", "followup", "Thank you for your time...");

      const snippet = snippetQueries.getById.get(id) as any;
      expect(snippet).toBeDefined();
      expect(snippet.id).toBe(id);
      expect(snippet.account_id).toBe(testAccountId);
      expect(snippet.name).toBe("Meeting Follow-up");
      expect(snippet.shortcut).toBe("followup");
      expect(snippet.content).toBe("Thank you for your time...");
    });

    it("should enforce unique shortcut per account", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      snippetQueries.insert.run(id1, testAccountId, "First", "test", "Content 1");

      expect(() => {
        snippetQueries.insert.run(id2, testAccountId, "Second", "test", "Content 2");
      }).toThrow();
    });

    it("should allow same shortcut in different accounts", () => {
      const secondAccountId = "test-snippets-account-2-" + Date.now();
      accountQueries.upsert.run(
        secondAccountId,
        "test-snippets2@example.com",
        "Test User 2",
        "access_token",
        "refresh_token",
        Math.floor(Date.now() / 1000) + 3600
      );

      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      snippetQueries.insert.run(id1, testAccountId, "First", "test", "Content 1");
      snippetQueries.insert.run(id2, secondAccountId, "Second", "test", "Content 2");

      const snippet1 = snippetQueries.getById.get(id1) as any;
      const snippet2 = snippetQueries.getById.get(id2) as any;

      expect(snippet1).toBeDefined();
      expect(snippet2).toBeDefined();
      expect(snippet1.shortcut).toBe(snippet2.shortcut);

      // Clean up second account
      snippetQueries.deleteByAccount.run(secondAccountId);
      accountQueries.delete.run(secondAccountId);
    });
  });

  describe("snippetQueries.getByAccount", () => {
    it("should return all snippets for an account sorted by name", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const id3 = crypto.randomUUID();

      snippetQueries.insert.run(id1, testAccountId, "Zebra", "z", "Z content");
      snippetQueries.insert.run(id2, testAccountId, "Apple", "a", "A content");
      snippetQueries.insert.run(id3, testAccountId, "Mango", "m", "M content");

      const snippets = snippetQueries.getByAccount.all(testAccountId) as any[];

      expect(snippets.length).toBe(3);
      expect(snippets[0].name).toBe("Apple");
      expect(snippets[1].name).toBe("Mango");
      expect(snippets[2].name).toBe("Zebra");
    });

    it("should return empty array for account with no snippets", () => {
      const snippets = snippetQueries.getByAccount.all(testAccountId);
      expect(snippets).toEqual([]);
    });
  });

  describe("snippetQueries.getByShortcut", () => {
    it("should find a snippet by shortcut", () => {
      const id = crypto.randomUUID();
      snippetQueries.insert.run(id, testAccountId, "Greeting", "hi", "Hello there!");

      const snippet = snippetQueries.getByShortcut.get(testAccountId, "hi") as any;
      expect(snippet).toBeDefined();
      expect(snippet.name).toBe("Greeting");
      expect(snippet.content).toBe("Hello there!");
    });

    it("should return null for non-existent shortcut", () => {
      const snippet = snippetQueries.getByShortcut.get(testAccountId, "nonexistent");
      expect(snippet).toBeNull();
    });
  });

  describe("snippetQueries.update", () => {
    it("should update snippet properties", () => {
      const id = crypto.randomUUID();
      snippetQueries.insert.run(id, testAccountId, "Original Name", "orig", "Original content");

      snippetQueries.update.run("Updated Name", "updated", "Updated content", id);

      const snippet = snippetQueries.getById.get(id) as any;
      expect(snippet.name).toBe("Updated Name");
      expect(snippet.shortcut).toBe("updated");
      expect(snippet.content).toBe("Updated content");
    });
  });

  describe("snippetQueries.delete", () => {
    it("should delete a snippet", () => {
      const id = crypto.randomUUID();
      snippetQueries.insert.run(id, testAccountId, "To Delete", "del", "Delete me");

      let snippet = snippetQueries.getById.get(id);
      expect(snippet).toBeDefined();

      snippetQueries.delete.run(id);

      snippet = snippetQueries.getById.get(id);
      expect(snippet).toBeNull();
    });
  });

  describe("snippetQueries.deleteByAccount", () => {
    it("should delete all snippets for an account", () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      snippetQueries.insert.run(id1, testAccountId, "First", "first", "Content 1");
      snippetQueries.insert.run(id2, testAccountId, "Second", "second", "Content 2");

      let snippets = snippetQueries.getByAccount.all(testAccountId);
      expect(snippets.length).toBe(2);

      snippetQueries.deleteByAccount.run(testAccountId);

      snippets = snippetQueries.getByAccount.all(testAccountId);
      expect(snippets.length).toBe(0);
    });
  });
});
