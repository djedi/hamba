import { Elysia } from "elysia";
import { draftQueries } from "../db";
import { getProvider } from "../services/providers";

export const draftRoutes = new Elysia({ prefix: "/drafts" })
  .get("/", ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return draftQueries.getByAccount.all(accountId);
  })

  .get("/:id", ({ params }) => {
    return draftQueries.getById.get(params.id);
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
  });
