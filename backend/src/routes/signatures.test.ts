import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { signatureQueries, accountQueries, db } from "../db";

describe("signatureQueries", () => {
  const testAccountId = `test-account-${Date.now()}`;
  const testEmail = `test-${Date.now()}@example.com`;

  beforeAll(() => {
    // Create test account
    accountQueries.upsert.run(
      testAccountId,
      testEmail,
      "Test User",
      null,
      null,
      null
    );
  });

  afterAll(() => {
    // Clean up test data
    signatureQueries.deleteByAccount.run(testAccountId);
    accountQueries.delete.run(testAccountId);
  });

  it("should create a signature", () => {
    const id = crypto.randomUUID();
    signatureQueries.insert.run(
      id,
      testAccountId,
      "Work Signature",
      "Best regards,\nTest User",
      0, // is_html
      1  // is_default
    );

    const signature = signatureQueries.getById.get(id) as any;
    expect(signature).toBeDefined();
    expect(signature.name).toBe("Work Signature");
    expect(signature.content).toBe("Best regards,\nTest User");
    expect(signature.is_html).toBe(0);
    expect(signature.is_default).toBe(1);
  });

  it("should get signatures by account", () => {
    const signatures = signatureQueries.getByAccount.all(testAccountId) as any[];
    expect(signatures.length).toBeGreaterThanOrEqual(1);
  });

  it("should get default signature", () => {
    const defaultSig = signatureQueries.getDefault.get(testAccountId) as any;
    expect(defaultSig).toBeDefined();
    expect(defaultSig.is_default).toBe(1);
  });

  it("should update a signature", () => {
    const signatures = signatureQueries.getByAccount.all(testAccountId) as any[];
    const sig = signatures[0];

    signatureQueries.update.run(
      "Updated Name",
      "<p>Updated content</p>",
      1, // is_html
      sig.id
    );

    const updated = signatureQueries.getById.get(sig.id) as any;
    expect(updated.name).toBe("Updated Name");
    expect(updated.content).toBe("<p>Updated content</p>");
    expect(updated.is_html).toBe(1);
  });

  it("should set default signature", () => {
    // Create second signature
    const id2 = crypto.randomUUID();
    signatureQueries.insert.run(
      id2,
      testAccountId,
      "Personal Signature",
      "Cheers,\nTest",
      0,
      0
    );

    // Set it as default
    signatureQueries.setDefault.run(id2, testAccountId);

    // Verify it's now default
    const sig2 = signatureQueries.getById.get(id2) as any;
    expect(sig2.is_default).toBe(1);

    // Verify old default is cleared
    const signatures = signatureQueries.getByAccount.all(testAccountId) as any[];
    const nonDefaultCount = signatures.filter((s: any) => s.is_default === 0).length;
    const defaultCount = signatures.filter((s: any) => s.is_default === 1).length;
    expect(defaultCount).toBe(1);
    expect(nonDefaultCount).toBe(signatures.length - 1);
  });

  it("should delete a signature", () => {
    const id = crypto.randomUUID();
    signatureQueries.insert.run(
      id,
      testAccountId,
      "To Delete",
      "Content",
      0,
      0
    );

    const before = signatureQueries.getById.get(id);
    expect(before).toBeDefined();

    signatureQueries.delete.run(id);

    const after = signatureQueries.getById.get(id);
    expect(after).toBeFalsy();
  });
});
