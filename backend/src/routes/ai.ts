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

export const aiRoutes = new Elysia({ prefix: "/ai", detail: { tags: ["AI"] } })
  // Check if AI is configured
  .get("/status", () => {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    return { configured: hasApiKey };
  }, {
    detail: {
      summary: "Check AI configuration status",
      description: "Returns whether AI features are configured (ANTHROPIC_API_KEY is set)",
      responses: {
        200: {
          description: "Configuration status",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  configured: { type: "boolean", description: "Whether AI is configured" },
                },
              },
            },
          },
        },
      },
    },
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
  }, {
    detail: {
      summary: "Generate email content with AI",
      description: "Uses Claude AI to generate email content based on a prompt. Supports composing new emails or replying to existing ones.",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["prompt"],
              properties: {
                prompt: { type: "string", description: "Instructions for the AI (e.g., 'decline politely')" },
                context: {
                  type: "object",
                  properties: {
                    replyTo: {
                      type: "object",
                      properties: {
                        subject: { type: "string" },
                        from: { type: "string" },
                        body: { type: "string" },
                      },
                    },
                    mode: { type: "string", enum: ["new", "reply", "replyAll", "forward"] },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Generated email content or error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  content: { type: "string", description: "Generated email body" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
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
  }, {
    detail: {
      summary: "Summarize email content",
      description: "Uses Claude AI to generate a 2-3 sentence summary of an email. Summaries are cached.",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["emailId"],
              properties: {
                emailId: { type: "string", description: "Email UUID to summarize" },
                regenerate: { type: "boolean", default: false, description: "Force regenerate even if cached" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Summary or error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  summary: { type: "string", description: "Generated summary" },
                  cached: { type: "boolean", description: "Whether result was cached" },
                  generated_at: { type: "integer", description: "Timestamp when generated" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  })

  // Generate smart reply suggestions for an email
  .post("/smart-replies", async ({ body }) => {
    const { emailId } = body as {
      emailId: string;
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
      } | undefined;

      if (!email) {
        return { success: false, error: "Email not found" };
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

      if (!bodyText || bodyText.length < 10) {
        return { success: false, error: "Email is too short to generate replies" };
      }

      // Truncate very long emails
      const maxLength = 4000;
      if (bodyText.length > maxLength) {
        bodyText = bodyText.substring(0, maxLength) + "...";
      }

      const client = getAnthropicClient();

      const systemMessage = `You are a helpful assistant that generates smart reply suggestions for emails.

Generate exactly 3 short, contextually appropriate reply options. Each reply should be:
- Brief (1-2 sentences max)
- Different in tone/purpose: one positive/agreeable, one neutral/informative, one that asks a follow-up question or declines
- Natural and professional
- Ready to send as-is (no placeholders like [name] or [date])

Output ONLY a JSON array with exactly 3 strings, nothing else.
Example: ["Sounds great, I'm in!", "Thanks for letting me know.", "Can we discuss this further next week?"]`;

      const userMessage = `Generate 3 smart reply suggestions for this email:

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

      // Parse the JSON array response
      let replies: string[];
      try {
        // Extract JSON array from the response (handle markdown code blocks)
        const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error("No JSON array found in response");
        }
        replies = JSON.parse(jsonMatch[0]);

        // Ensure we have exactly 3 strings
        if (!Array.isArray(replies) || replies.length === 0) {
          throw new Error("Invalid reply format");
        }
        replies = replies.slice(0, 3).filter(r => typeof r === "string" && r.trim());
      } catch (parseError) {
        console.error("Failed to parse smart replies response:", textContent.text);
        return { success: false, error: "Failed to parse AI response" };
      }

      return {
        success: true,
        replies,
      };
    } catch (error: any) {
      console.error("AI smart replies error:", error);

      if (error.message?.includes("ANTHROPIC_API_KEY")) {
        return { success: false, error: "AI is not configured. Please add your ANTHROPIC_API_KEY to the .env file." };
      }

      if (error.status === 401) {
        return { success: false, error: "Invalid API key. Please check your ANTHROPIC_API_KEY." };
      }

      if (error.status === 429) {
        return { success: false, error: "Rate limit exceeded. Please try again later." };
      }

      return { success: false, error: error.message || "Failed to generate smart replies" };
    }
  }, {
    detail: {
      summary: "Generate smart reply suggestions",
      description: "Uses Claude AI to generate 3 contextual reply suggestions for an email (similar to Gmail smart replies)",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["emailId"],
              properties: {
                emailId: { type: "string", description: "Email UUID to generate replies for" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Reply suggestions or error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  replies: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of 3 suggested reply strings",
                  },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  });
