import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { aiRoutes } from "./ai";

describe("ai routes", () => {
  let app: ReturnType<typeof Elysia.prototype.use>;

  beforeAll(() => {
    app = new Elysia().use(aiRoutes);
  });

  describe("GET /ai/status", () => {
    it("should return configured: false when API key is not set", async () => {
      // Store original env
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const response = await app.handle(
        new Request("http://localhost/ai/status")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.configured).toBe(false);

      // Restore original env
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it("should return configured: true when API key is set", async () => {
      // Store original and set test key
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";

      const response = await app.handle(
        new Request("http://localhost/ai/status")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.configured).toBe(true);

      // Restore original env
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });
  });

  describe("POST /ai/compose", () => {
    it("should return error when prompt is missing", async () => {
      const response = await app.handle(
        new Request("http://localhost/ai/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("Prompt is required");
    });

    it("should return error when prompt is empty string", async () => {
      const response = await app.handle(
        new Request("http://localhost/ai/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "" }),
        })
      );
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("Prompt is required");
    });

    it("should return error when API key is not configured", async () => {
      // Store original and clear key
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const response = await app.handle(
        new Request("http://localhost/ai/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "Write an email" }),
        })
      );
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toContain("ANTHROPIC_API_KEY");

      // Restore original env
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it("should accept valid prompt with context", async () => {
      // Store original and clear key (to test validation passes before API call)
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const response = await app.handle(
        new Request("http://localhost/ai/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "Decline politely",
            context: {
              replyTo: {
                subject: "Meeting Request",
                from: "sender@example.com",
                body: "Can we meet tomorrow?",
              },
              mode: "reply",
            },
          }),
        })
      );
      const data = await response.json();

      // Should fail at API key check, not validation
      expect(data.success).toBe(false);
      expect(data.error).toContain("ANTHROPIC_API_KEY");

      // Restore original env
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });
  });
});
