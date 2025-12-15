import { Elysia } from "elysia";
import { labelQueries, emailLabelQueries } from "../db";
import { getProvider } from "../services/providers";

export const labelRoutes = new Elysia({ prefix: "/labels" })
  .get("/", async ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const labels = labelQueries.getByAccount.all(accountId);
    return labels;
  })

  .get("/:id", ({ params }) => {
    return labelQueries.getById.get(params.id);
  })

  .get("/:id/emails", ({ params, query }) => {
    const { limit = "50", offset = "0" } = query;

    return emailLabelQueries.getEmailsForLabel.all(
      params.id,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .get("/:id/count", ({ params }) => {
    const result = emailLabelQueries.countEmailsForLabel.get(params.id) as { count: number };
    return { count: result?.count || 0 };
  })

  .post("/", async ({ body }) => {
    const { accountId, name, color } = body as {
      accountId: string;
      name: string;
      color?: string;
    };

    if (!accountId || !name) {
      return { success: false, error: "accountId and name are required" };
    }

    try {
      const id = crypto.randomUUID();
      labelQueries.insert.run(
        id,
        accountId,
        name,
        color || "#6366f1",
        "user",
        null
      );

      return { success: true, id };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint failed")) {
        return { success: false, error: "Label already exists" };
      }
      return { success: false, error: e.message || String(e) };
    }
  })

  .put("/:id", async ({ params, body }) => {
    const { name, color } = body as {
      name?: string;
      color?: string;
    };

    const label = labelQueries.getById.get(params.id) as any;
    if (!label) {
      return { success: false, error: "Label not found" };
    }

    try {
      labelQueries.update.run(
        name || label.name,
        color || label.color,
        params.id
      );
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .delete("/:id", async ({ params }) => {
    const label = labelQueries.getById.get(params.id) as any;
    if (!label) {
      return { success: false, error: "Label not found" };
    }

    try {
      labelQueries.delete.run(params.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .post("/:labelId/emails/:emailId", async ({ params }) => {
    const { labelId, emailId } = params;

    try {
      emailLabelQueries.addLabelToEmail.run(emailId, labelId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .delete("/:labelId/emails/:emailId", async ({ params }) => {
    const { labelId, emailId } = params;

    try {
      emailLabelQueries.removeLabelFromEmail.run(emailId, labelId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  })

  .get("/email/:emailId", ({ params }) => {
    return emailLabelQueries.getLabelsForEmail.all(params.emailId);
  });
