import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { db, contactQueries, accountQueries } from "../db";

// Test account ID
const testAccountId = "test-account-contacts";

// Clean up test data
function cleanup() {
  try {
    contactQueries.deleteByAccount.run(testAccountId);
    accountQueries.delete.run(testAccountId);
  } catch (e) {
    // Ignore errors
  }
}

beforeAll(() => {
  cleanup();
  // Create test account
  db.run(`
    INSERT INTO accounts (id, email, name, provider_type)
    VALUES (?, ?, ?, ?)
  `, [testAccountId, "test@contacts.com", "Test User", "gmail"]);
});

afterAll(() => {
  cleanup();
});

describe("Contact Queries", () => {
  test("upsert creates new contact", () => {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    contactQueries.upsert.run(id, testAccountId, "new@example.com", "New User", now);

    const contact = contactQueries.getByEmail.get(testAccountId, "new@example.com") as any;
    expect(contact).toBeDefined();
    expect(contact.email).toBe("new@example.com");
    expect(contact.name).toBe("New User");
    expect(contact.contact_count).toBe(1);
  });

  test("upsert increments contact_count for existing contact", () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // First insert
    contactQueries.upsert.run(id1, testAccountId, "repeat@example.com", "Repeat User", now);

    // Second insert (should increment count)
    contactQueries.upsert.run(id2, testAccountId, "repeat@example.com", null, now + 1);

    const contact = contactQueries.getByEmail.get(testAccountId, "repeat@example.com") as any;
    expect(contact.contact_count).toBe(2);
    // Name should be preserved from first insert
    expect(contact.name).toBe("Repeat User");
  });

  test("search finds contacts by email", () => {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    contactQueries.upsert.run(id, testAccountId, "searchable@example.com", "Searchable", now);

    const results = contactQueries.search.all(testAccountId, "%searchable%", "%searchable%", 10) as any[];
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.email === "searchable@example.com")).toBe(true);
  });

  test("search finds contacts by name", () => {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    contactQueries.upsert.run(id, testAccountId, "unique.email@example.com", "UniqueNameXYZ", now);

    const results = contactQueries.search.all(testAccountId, "%UniqueNameXYZ%", "%UniqueNameXYZ%", 10) as any[];
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.name === "UniqueNameXYZ")).toBe(true);
  });

  test("getByAccount returns contacts sorted by last_contacted", () => {
    const now = Math.floor(Date.now() / 1000);

    // Create contacts with different timestamps
    contactQueries.upsert.run(crypto.randomUUID(), testAccountId, "older@example.com", "Older", now - 1000);
    contactQueries.upsert.run(crypto.randomUUID(), testAccountId, "newer@example.com", "Newer", now);

    const contacts = contactQueries.getByAccount.all(testAccountId) as any[];
    const newerIndex = contacts.findIndex((c: any) => c.email === "newer@example.com");
    const olderIndex = contacts.findIndex((c: any) => c.email === "older@example.com");

    // Newer contact should come before older
    expect(newerIndex).toBeLessThan(olderIndex);
  });

  test("delete removes contact", () => {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    contactQueries.upsert.run(id, testAccountId, "todelete@example.com", "To Delete", now);

    let contact = contactQueries.getByEmail.get(testAccountId, "todelete@example.com");
    expect(contact).toBeDefined();

    contactQueries.delete.run((contact as any).id);

    contact = contactQueries.getByEmail.get(testAccountId, "todelete@example.com");
    expect(contact).toBeFalsy();
  });
});

describe("parseEmailAddresses", () => {
  // Import the function - we'll test it via the API behavior
  test("parses simple email addresses via API behavior", async () => {
    // Test that contacts are properly extracted when added through the API
    // This tests the parsing logic indirectly
    const { addContactFromSend } = await import("./contacts");

    // Clean up before test
    const existingBefore = contactQueries.getByEmail.get(testAccountId, "simple@example.com");
    if (existingBefore) contactQueries.delete.run((existingBefore as any).id);

    addContactFromSend(testAccountId, "simple@example.com");

    const contact = contactQueries.getByEmail.get(testAccountId, "simple@example.com") as any;
    expect(contact).toBeDefined();
    expect(contact.email).toBe("simple@example.com");
  });

  test("parses name <email> format via API behavior", async () => {
    const { addContactFromSend } = await import("./contacts");

    // Clean up before test
    const existingBefore = contactQueries.getByEmail.get(testAccountId, "formatted@example.com");
    if (existingBefore) contactQueries.delete.run((existingBefore as any).id);

    addContactFromSend(testAccountId, "John Doe <formatted@example.com>");

    const contact = contactQueries.getByEmail.get(testAccountId, "formatted@example.com") as any;
    expect(contact).toBeDefined();
    expect(contact.email).toBe("formatted@example.com");
    expect(contact.name).toBe("John Doe");
  });

  test("parses multiple comma-separated addresses", async () => {
    const { addContactFromSend } = await import("./contacts");

    // Clean up before test
    for (const email of ["multi1@example.com", "multi2@example.com"]) {
      const existing = contactQueries.getByEmail.get(testAccountId, email);
      if (existing) contactQueries.delete.run((existing as any).id);
    }

    addContactFromSend(testAccountId, "multi1@example.com, Jane Smith <multi2@example.com>");

    const contact1 = contactQueries.getByEmail.get(testAccountId, "multi1@example.com") as any;
    const contact2 = contactQueries.getByEmail.get(testAccountId, "multi2@example.com") as any;

    expect(contact1).toBeDefined();
    expect(contact2).toBeDefined();
    expect(contact2.name).toBe("Jane Smith");
  });
});
