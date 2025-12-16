import { Elysia } from "elysia";
import Anthropic from "@anthropic-ai/sdk";

// Initialize the Anthropic client (uses ANTHROPIC_API_KEY env var by default)
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export const aiRoutes = new Elysia({ prefix: "/ai" })
  // Check if AI is configured
  .get("/status", () => {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    return { configured: hasApiKey };
  })

  // Generate email content from a prompt
  .post("/compose", async ({ body }) => {
    const { prompt, context } = body as {
      prompt: string;
      context?: {
        replyTo?: {
          subject: string;
          from: string;
          body: string;
        };
        mode?: "new" | "reply" | "replyAll" | "forward";
      };
    };

    if (!prompt || typeof prompt !== "string") {
      return { success: false, error: "Prompt is required" };
    }

    try {
      const client = getAnthropicClient();

      // Build the system message
      const systemMessage = `You are an expert email writer. Generate professional, clear, and concise email content based on the user's request.

Guidelines:
- Write in a professional but friendly tone unless otherwise specified
- Keep emails concise and to the point
- Use appropriate greeting and sign-off based on context
- Do not include the subject line in your response - only the email body
- Output plain text (no markdown formatting)
- If this is a reply, maintain appropriate context from the original email`;

      // Build the user message with context
      let userMessage = prompt;

      if (context?.replyTo) {
        const { subject, from, body } = context.replyTo;
        userMessage = `${prompt}

--- Original email context ---
From: ${from}
Subject: ${subject}
Body: ${body}
---

Please write ${context.mode === "reply" || context.mode === "replyAll" ? "a reply to" : "an email based on"} the above context, following the user's instructions.`;
      }

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemMessage,
        messages: [
          {
            role: "user",
            content: userMessage,
          },
        ],
      });

      // Extract text from response
      const textContent = response.content.find((block) => block.type === "text");
      if (!textContent || textContent.type !== "text") {
        return { success: false, error: "No text content in response" };
      }

      return {
        success: true,
        content: textContent.text,
      };
    } catch (error: any) {
      console.error("AI compose error:", error);

      // Handle specific error types
      if (error.message?.includes("ANTHROPIC_API_KEY")) {
        return { success: false, error: "AI is not configured. Please add your ANTHROPIC_API_KEY to the .env file." };
      }

      if (error.status === 401) {
        return { success: false, error: "Invalid API key. Please check your ANTHROPIC_API_KEY." };
      }

      if (error.status === 429) {
        return { success: false, error: "Rate limit exceeded. Please try again later." };
      }

      return { success: false, error: error.message || "Failed to generate email" };
    }
  });
