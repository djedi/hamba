import { Elysia } from "elysia";
import { signatureQueries } from "../db";

export const signatureRoutes = new Elysia({ prefix: "/signatures" })
  .get("/", async ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const signatures = signatureQueries.getByAccount.all(accountId);
    return signatures;
  })

  .get("/:id", ({ params }) => {
    return signatureQueries.getById.get(params.id);
  })

  .get("/default/:accountId", ({ params }) => {
    return signatureQueries.getDefault.get(params.accountId) || null;
  })

  .post("/", async ({ body }) => {
    const { accountId, name, content, isHtml, isDefault } = body as {
      accountId: string;
      name: string;
      content: string;
      isHtml?: boolean;
      isDefault?: boolean;
    };

    if (!accountId || !name || content === undefined) {
      return { success: false, error: "accountId, name, and content are required" };
    }

    if (name.length > 100) {
      return { success: false, error: "Signature name must be 100 characters or less" };
    }

    try {
      const id = crypto.randomUUID();

      // If this is set as default, clear other defaults first
      if (isDefault) {
        signatureQueries.clearDefault.run(accountId);
      }

      signatureQueries.insert.run(
        id,
        accountId,
        name,
        content,
        isHtml ? 1 : 0,
        isDefault ? 1 : 0
      );

      return { success: true, id };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .put("/:id", async ({ params, body }) => {
    const { name, content, isHtml } = body as {
      name?: string;
      content?: string;
      isHtml?: boolean;
    };

    const signature = signatureQueries.getById.get(params.id) as any;
    if (!signature) {
      return { success: false, error: "Signature not found" };
    }

    if (name && name.length > 100) {
      return { success: false, error: "Signature name must be 100 characters or less" };
    }

    try {
      signatureQueries.update.run(
        name ?? signature.name,
        content ?? signature.content,
        isHtml !== undefined ? (isHtml ? 1 : 0) : signature.is_html,
        params.id
      );
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .post("/:id/default", async ({ params }) => {
    const signature = signatureQueries.getById.get(params.id) as any;
    if (!signature) {
      return { success: false, error: "Signature not found" };
    }

    try {
      signatureQueries.setDefault.run(params.id, signature.account_id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .delete("/:id/default", async ({ params }) => {
    const signature = signatureQueries.getById.get(params.id) as any;
    if (!signature) {
      return { success: false, error: "Signature not found" };
    }

    try {
      signatureQueries.clearDefault.run(signature.account_id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .delete("/:id", async ({ params }) => {
    const signature = signatureQueries.getById.get(params.id) as any;
    if (!signature) {
      return { success: false, error: "Signature not found" };
    }

    try {
      signatureQueries.delete.run(params.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  });
