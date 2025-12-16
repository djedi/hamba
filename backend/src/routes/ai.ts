import { Elysia } from "elysia";
import Anthropic from "@anthropic-ai/sdk";
import { emailQueries } from "../db";

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
  })

  // Summarize an email
  .post("/summarize", async ({ body }) => {
    const { emailId, regenerate } = body as {
      emailId: string;
      regenerate?: boolean;
    };

    if (!emailId || typeof emailId !== "string") {
      return { success: false, error: "Email ID is required" };
    }

    try {
      // Fetch the email
      const email = emailQueries.getById.get(emailId) as {
        id: string;
        subject: string;
        from_name: string;
        from_email: string;
        body_text: string;
        body_html: string;
        summary: string | null;
        summary_generated_at: number | null;
      } | undefined;

      if (!email) {
        return { success: false, error: "Email not found" };
      }

      // Return cached summary if available and not regenerating
      if (email.summary && !regenerate) {
        return {
          success: true,
          summary: email.summary,
          cached: true,
          generated_at: email.summary_generated_at,
        };
      }

      // Get the email body text
      let bodyText = email.body_text || "";

      // If no plain text, try to extract from HTML
      if (!bodyText && email.body_html) {
        bodyText = email.body_html
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      if (!bodyText || bodyText.length < 50) {
        return { success: false, error: "Email is too short to summarize" };
      }

      // Truncate very long emails
      const maxLength = 8000;
      if (bodyText.length > maxLength) {
        bodyText = bodyText.substring(0, maxLength) + "...";
      }

      const client = getAnthropicClient();

      const systemMessage = `You are a helpful assistant that summarizes emails concisely.

Guidelines:
- Provide a 2-3 sentence summary capturing the key points
- Focus on: what the email is about, what action (if any) is requested, and any important details
- Use clear, direct language
- Do not include greetings or sign-offs in the summary
- If the email is a newsletter or promotional, note that briefly`;

      const userMessage = `Summarize this email:

From: ${email.from_name || email.from_email}
Subject: ${email.subject || "(no subject)"}

${bodyText}`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: systemMessage,
        messages: [
          {
            role: "user",
            content: userMessage,
          },
        ],
      });

      const textContent = response.content.find((block) => block.type === "text");
      if (!textContent || textContent.type !== "text") {
        return { success: false, error: "No text content in response" };
      }

      const summary = textContent.text.trim();

      // Cache the summary in the database
      emailQueries.setSummary.run(summary, emailId);

      return {
        success: true,
        summary,
        cached: false,
        generated_at: Math.floor(Date.now() / 1000),
      };
    } catch (error: any) {
      console.error("AI summarize error:", error);

      if (error.message?.includes("ANTHROPIC_API_KEY")) {
        return { success: false, error: "AI is not configured. Please add your ANTHROPIC_API_KEY to the .env file." };
      }

      if (error.status === 401) {
        return { success: false, error: "Invalid API key. Please check your ANTHROPIC_API_KEY." };
      }

      if (error.status === 429) {
        return { success: false, error: "Rate limit exceeded. Please try again later." };
      }

      return { success: false, error: error.message || "Failed to summarize email" };
    }
  });
