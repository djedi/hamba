import { Elysia } from "elysia";
import { draftQueries } from "../db";
import { getProvider } from "../services/providers";

export const draftRoutes = new Elysia({ prefix: "/drafts", detail: { tags: ["Drafts"] } })
  .get("/", ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return draftQueries.getByAccount.all(accountId);
  }, {
    detail: {
      summary: "List drafts",
      description: "Returns all drafts for the specified account",
      responses: {
        200: {
          description: "List of drafts",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Draft" },
              },
            },
          },
        },
      },
    },
  })

  .get("/:id", ({ params }) => {
    return draftQueries.getById.get(params.id);
  }, {
    detail: {
      summary: "Get draft by ID",
      description: "Returns a single draft by its ID",
      responses: {
        200: {
          description: "Draft details",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Draft" } } },
        },
      },
    },
  })

  .post("/", async ({ body }) => {
    const {
      id,
      accountId,
      to,
      cc,
      bcc,
      subject,
      body: draftBody,
      replyToId,
      replyMode,
    } = body as {
      id: string;
      accountId: string;
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body?: string;
      replyToId?: string;
      replyMode?: string;
    };

    if (!id || !accountId) {
      return { error: "id and accountId are required" };
    }

    try {
      draftQueries.upsert.run(
        id,
        accountId,
        null, // remote_id - will be set when syncing to server
        to || "",
        cc || "",
        bcc || "",
        subject || "",
        draftBody || "",
        replyToId || null,
        replyMode || null
      );

      return { success: true, id };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }, {
    detail: {
      summary: "Create or update draft",
      description: "Creates a new draft or updates an existing one (upsert). Auto-save uses this endpoint.",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["id", "accountId"],
              properties: {
                id: { type: "string", description: "Draft UUID (generate client-side)" },
                accountId: { type: "string", description: "Account UUID" },
                to: { type: "string", description: "Recipient addresses" },
                cc: { type: "string", description: "CC addresses" },
                bcc: { type: "string", description: "BCC addresses" },
                subject: { type: "string", description: "Email subject" },
                body: { type: "string", description: "Email body content" },
                replyToId: { type: "string", description: "ID of email being replied to" },
                replyMode: { type: "string", enum: ["reply", "reply-all", "forward"], description: "Reply mode" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Success or error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  id: { type: "string", description: "Draft UUID" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  })

  .delete("/:id", async ({ params }) => {
    try {
      // Get draft to check if it has a remote_id
      const draft = draftQueries.getById.get(params.id) as any;

      if (draft?.remote_id && draft?.account_id) {
        // Try to delete from server
        try {
          const provider = getProvider(draft.account_id);
          if ('deleteDraft' in provider) {
            await (provider as any).deleteDraft(draft.remote_id);
          }
        } catch (e) {
          console.error("Failed to delete draft from server:", e);
          // Continue to delete locally even if server delete fails
        }
      }

      draftQueries.delete.run(params.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }, {
    detail: {
      summary: "Delete draft",
      description: "Deletes a draft locally and from the server if synced",
      responses: {
        200: {
          description: "Success or error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  })

  .post("/sync/:accountId", async ({ params }) => {
    try {
      const provider = getProvider(params.accountId);

      if ('syncDrafts' in provider) {
        const result = await (provider as any).syncDrafts();
        return result;
      }

      return { synced: 0, total: 0, error: "Provider does not support draft sync" };
    } catch (error) {
      return { error: String(error), synced: 0, total: 0 };
    }
  }, {
    detail: {
      summary: "Sync drafts from server",
      description: "Synchronizes drafts from the email provider (Gmail, Microsoft, etc.) to local database",
      responses: {
        200: {
          description: "Sync result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  synced: { type: "integer", description: "Number of drafts synced" },
                  total: { type: "integer", description: "Total drafts on server" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  });
