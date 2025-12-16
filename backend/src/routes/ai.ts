import { Elysia } from "elysia";
import Anthropic from "@anthropic-ai/sdk";
import { db, emailQueries } from "../db";
import { classifyImportance, classifyAndUpdateEmail } from "../services/importance";

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
  })

  // Classify a single email's importance using AI
  .post("/classify", async ({ body }) => {
    const { emailId, force } = body as {
      emailId: string;
      force?: boolean;
    };

    if (!emailId || typeof emailId !== "string") {
      return { success: false, error: "Email ID is required" };
    }

    try {
      // Fetch the email
      const email = emailQueries.getById.get(emailId) as {
        id: string;
        account_id: string;
        subject: string;
        from_name: string;
        from_email: string;
        to_addresses: string;
        labels: string;
        snippet: string;
        body_text: string;
        ai_importance_score: number | null;
        ai_classified_at: number | null;
      } | undefined;

      if (!email) {
        return { success: false, error: "Email not found" };
      }

      // Return cached classification if available and not forcing reclassification
      if (email.ai_importance_score !== null && !force) {
        const isImportant = email.ai_importance_score >= 0.5;
        return {
          success: true,
          score: email.ai_importance_score,
          is_important: isImportant,
          cached: true,
          classified_at: email.ai_classified_at,
        };
      }

      const client = getAnthropicClient();

      // Get sender stats for context
      const senderStats = db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM emails WHERE account_id = ? AND LOWER(from_email) = LOWER(?)) as received_count,
            (SELECT COUNT(*) FROM emails WHERE account_id = ? AND folder = 'sent' AND LOWER(to_addresses) LIKE ?) as sent_to_count
          `
        )
        .get(email.account_id, email.from_email, email.account_id, `%${email.from_email.toLowerCase()}%`) as {
          received_count: number;
          sent_to_count: number;
        };

      const systemMessage = `You are an email importance classifier. Your task is to determine if an email is important (requires attention/action from the user) or not important (promotional, automated, newsletters, notifications that can be ignored).

Classify emails as IMPORTANT (score >= 0.5) if:
- From a person the user has communicated with before (look at sent_to_count)
- Contains time-sensitive information or action items
- Personal communication (not mass-sent)
- Business-critical information
- Direct questions or requests

Classify emails as NOT IMPORTANT (score < 0.5) if:
- Promotional/marketing emails
- Newsletters or digests
- Automated notifications (shipping updates, social media alerts, etc.)
- Mass-sent emails to many recipients
- From no-reply addresses

Output ONLY a JSON object with:
- score: a number from 0.0 to 1.0 (0 = definitely not important, 1 = definitely important)
- reason: a brief 1-sentence explanation`;

      // Build email context - use snippet if body is too long
      const content = email.snippet || email.body_text?.substring(0, 500) || "";

      const userMessage = `Classify this email:

From: ${email.from_name || ""} <${email.from_email}>
To: ${email.to_addresses}
Subject: ${email.subject || "(no subject)"}
Labels: ${email.labels || "[]"}

Sender stats:
- Emails received from this sender: ${senderStats.received_count}
- Emails user has sent to this sender: ${senderStats.sent_to_count}

Preview: ${content}`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 128,
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

      // Parse the JSON response
      let score: number;
      let reason: string;
      try {
        const parsed = JSON.parse(textContent.text.trim());
        score = Math.max(0, Math.min(1, parsed.score || 0.5));
        reason = parsed.reason || "";
      } catch {
        // If JSON parsing fails, try to extract score from text
        const scoreMatch = textContent.text.match(/score["\s:]+([0-9.]+)/i);
        score = scoreMatch && scoreMatch[1] ? parseFloat(scoreMatch[1]) : 0.5;
        reason = textContent.text;
      }

      // Cache the classification in the database
      emailQueries.setAiImportanceScore.run(score, emailId);

      // Also update is_important based on AI classification
      const isImportant = score >= 0.5;
      if (isImportant) {
        emailQueries.markImportant.run(emailId);
      } else {
        emailQueries.markNotImportant.run(emailId);
      }

      return {
        success: true,
        score,
        is_important: isImportant,
        reason,
        cached: false,
        classified_at: Math.floor(Date.now() / 1000),
      };
    } catch (error: any) {
      console.error("AI classify error:", error);

      if (error.message?.includes("ANTHROPIC_API_KEY")) {
        return { success: false, error: "AI is not configured. Please add your ANTHROPIC_API_KEY to the .env file." };
      }

      if (error.status === 401) {
        return { success: false, error: "Invalid API key. Please check your ANTHROPIC_API_KEY." };
      }

      if (error.status === 429) {
        return { success: false, error: "Rate limit exceeded. Please try again later." };
      }

      return { success: false, error: error.message || "Failed to classify email" };
    }
  })

  // Batch classify emails for an account using AI
  .post("/classify-batch", async ({ body }) => {
    const { accountId, limit, force } = body as {
      accountId: string;
      limit?: number;
      force?: boolean;
    };

    if (!accountId || typeof accountId !== "string") {
      return { success: false, error: "Account ID is required" };
    }

    const batchLimit = Math.min(limit || 20, 50); // Cap at 50 to avoid rate limits

    try {
      // Get emails to classify
      let emails: Array<{
        id: string;
        account_id: string;
        from_email: string;
        from_name: string;
        subject: string;
        to_addresses: string;
        labels: string;
        snippet: string;
      }>;

      if (force) {
        // Reclassify all inbox emails
        emails = db
          .prepare(
            `SELECT id, account_id, from_email, from_name, subject, to_addresses, labels, snippet
             FROM emails
             WHERE account_id = ? AND folder = 'inbox' AND is_trashed = 0
             ORDER BY received_at DESC
             LIMIT ?`
          )
          .all(accountId, batchLimit) as typeof emails;
      } else {
        // Only classify emails not yet classified by AI
        emails = emailQueries.getUnclassifiedByAi.all(accountId, batchLimit) as typeof emails;
      }

      if (emails.length === 0) {
        return {
          success: true,
          classified: 0,
          message: "No emails to classify",
        };
      }

      const client = getAnthropicClient();

      // Build batch classification prompt
      const systemMessage = `You are an email importance classifier. Classify each email as important or not important.

IMPORTANT (score >= 0.5):
- Personal communication from known contacts
- Time-sensitive or action-required emails
- Business-critical information
- Direct questions or requests

NOT IMPORTANT (score < 0.5):
- Promotional/marketing emails
- Newsletters, digests, or automated updates
- Social media notifications
- Mass-sent emails

Output a JSON array with objects containing:
- id: the email ID
- score: 0.0 to 1.0
- reason: brief explanation (optional)`;

      // Build the email list for classification
      const emailSummaries = emails.map((e, i) => {
        return `[${i + 1}] ID: ${e.id}
From: ${e.from_name || ""} <${e.from_email}>
Subject: ${e.subject || "(no subject)"}
Preview: ${(e.snippet || "").substring(0, 200)}`;
      }).join("\n\n");

      const userMessage = `Classify these ${emails.length} emails. Return a JSON array:

${emailSummaries}`;

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

      const textContent = response.content.find((block) => block.type === "text");
      if (!textContent || textContent.type !== "text") {
        return { success: false, error: "No text content in response" };
      }

      // Parse the JSON array response
      let classifications: Array<{ id: string; score: number; reason?: string }>;
      try {
        // Extract JSON from the response (handle markdown code blocks)
        const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error("No JSON array found in response");
        }
        classifications = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error("Failed to parse batch classification response:", textContent.text);
        return { success: false, error: "Failed to parse AI response" };
      }

      // Update each email's classification
      let classified = 0;
      for (const classification of classifications) {
        const score = Math.max(0, Math.min(1, classification.score || 0.5));
        const isImportant = score >= 0.5;

        // Update AI score
        emailQueries.setAiImportanceScore.run(score, classification.id);

        // Update is_important flag
        if (isImportant) {
          emailQueries.markImportant.run(classification.id);
        } else {
          emailQueries.markNotImportant.run(classification.id);
        }

        classified++;
      }

      return {
        success: true,
        classified,
        total: emails.length,
        message: `Classified ${classified} emails using AI`,
      };
    } catch (error: any) {
      console.error("AI batch classify error:", error);

      if (error.message?.includes("ANTHROPIC_API_KEY")) {
        return { success: false, error: "AI is not configured. Please add your ANTHROPIC_API_KEY to the .env file." };
      }

      if (error.status === 401) {
        return { success: false, error: "Invalid API key. Please check your ANTHROPIC_API_KEY." };
      }

      if (error.status === 429) {
        return { success: false, error: "Rate limit exceeded. Please try again later." };
      }

      return { success: false, error: error.message || "Failed to classify emails" };
    }
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
  });
