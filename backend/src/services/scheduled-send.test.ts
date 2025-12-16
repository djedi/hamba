import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  scheduleEmail,
  cancelScheduledEmail,
  updateScheduledEmail,
  getScheduledEmails,
  getScheduledEmail,
} from "./scheduled-send";
import { scheduledEmailQueries, accountQueries } from "../db";

describe("scheduled-send", () => {
  const testAccountId = "test-account-" + Date.now();

  beforeEach(() => {
    // Create a test account using upsert
    accountQueries.upsert.run(
      testAccountId,
      "test-schedule@example.com",
      "Test User",
      "access_token",
      "refresh_token",
      Math.floor(Date.now() / 1000) + 3600
    );
  });

  afterEach(() => {
    // Clean up test data
    scheduledEmailQueries.deleteByAccount.run(testAccountId);
    accountQueries.delete.run(testAccountId);
  });

  describe("scheduleEmail", () => {
    it("should schedule an email for future delivery", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const result = scheduleEmail({
        accountId: testAccountId,
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sendAt: futureTime,
      });

      expect(result.success).toBe(true);
      expect(result.scheduledId).toBeDefined();
      expect(result.sendAt).toBe(futureTime);
    });

    it("should fail if send time is in the past", () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      const result = scheduleEmail({
        accountId: testAccountId,
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sendAt: pastTime,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("future");
    });

    it("should fail for non-existent account", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;

      const result = scheduleEmail({
        accountId: "non-existent-account",
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sendAt: futureTime,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Account not found");
    });

    it("should include optional cc, bcc, and attachments", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;

      const result = scheduleEmail({
        accountId: testAccountId,
        to: "recipient@example.com",
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sendAt: futureTime,
        attachments: [{ filename: "test.txt", mimeType: "text/plain", content: "dGVzdA==" }],
      });

      expect(result.success).toBe(true);

      const scheduled = getScheduledEmail(result.scheduledId!);
      expect(scheduled).toBeDefined();
      expect(scheduled!.cc_addresses).toBe("cc@example.com");
      expect(scheduled!.bcc_addresses).toBe("bcc@example.com");
      expect(scheduled!.attachments).toContain("test.txt");
    });
  });

  describe("cancelScheduledEmail", () => {
    it("should cancel a scheduled email", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;

      const scheduleResult = scheduleEmail({
        accountId: testAccountId,
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sendAt: futureTime,
      });

      expect(scheduleResult.success).toBe(true);

      const cancelResult = cancelScheduledEmail(scheduleResult.scheduledId!);
      expect(cancelResult.success).toBe(true);

      // Verify it's deleted
      const scheduled = getScheduledEmail(scheduleResult.scheduledId!);
      expect(scheduled).toBeNull();
    });

    it("should fail for non-existent scheduled email", () => {
      const result = cancelScheduledEmail("non-existent-id");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("updateScheduledEmail", () => {
    it("should update scheduled email properties", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const newFutureTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours

      const scheduleResult = scheduleEmail({
        accountId: testAccountId,
        to: "recipient@example.com",
        subject: "Original Subject",
        body: "<p>Original body</p>",
        sendAt: futureTime,
      });

      expect(scheduleResult.success).toBe(true);

      const updateResult = updateScheduledEmail(scheduleResult.scheduledId!, {
        subject: "Updated Subject",
        sendAt: newFutureTime,
      });

      expect(updateResult.success).toBe(true);

      const scheduled = getScheduledEmail(scheduleResult.scheduledId!);
      expect(scheduled!.subject).toBe("Updated Subject");
      expect(scheduled!.send_at).toBe(newFutureTime);
    });

    it("should fail if updated send time is in the past", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const pastTime = Math.floor(Date.now() / 1000) - 3600;

      const scheduleResult = scheduleEmail({
        accountId: testAccountId,
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sendAt: futureTime,
      });

      const updateResult = updateScheduledEmail(scheduleResult.scheduledId!, {
        sendAt: pastTime,
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toContain("future");
    });
  });

  describe("getScheduledEmails", () => {
    it("should return all scheduled emails for an account", () => {
      const futureTime1 = Math.floor(Date.now() / 1000) + 3600;
      const futureTime2 = Math.floor(Date.now() / 1000) + 7200;

      scheduleEmail({
        accountId: testAccountId,
        to: "recipient1@example.com",
        subject: "Subject 1",
        body: "<p>Body 1</p>",
        sendAt: futureTime1,
      });

      scheduleEmail({
        accountId: testAccountId,
        to: "recipient2@example.com",
        subject: "Subject 2",
        body: "<p>Body 2</p>",
        sendAt: futureTime2,
      });

      const scheduled = getScheduledEmails(testAccountId);
      expect(scheduled.length).toBe(2);
      // Should be sorted by send_at ascending
      expect(scheduled[0]!.send_at).toBe(futureTime1);
      expect(scheduled[1]!.send_at).toBe(futureTime2);
    });

    it("should return empty array for account with no scheduled emails", () => {
      const scheduled = getScheduledEmails(testAccountId);
      expect(scheduled.length).toBe(0);
    });
  });
});
