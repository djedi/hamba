import { Elysia } from "elysia";
import { snippetQueries } from "../db";

export const snippetRoutes = new Elysia({ prefix: "/snippets" })
  .get("/", async ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const snippets = snippetQueries.getByAccount.all(accountId);
    return snippets;
  })

  .get("/:id", ({ params }) => {
    return snippetQueries.getById.get(params.id);
  })

  .get("/by-shortcut/:shortcut", ({ params, query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return snippetQueries.getByShortcut.get(accountId, params.shortcut);
  })

  .post("/", async ({ body }) => {
    const { accountId, name, shortcut, content } = body as {
      accountId: string;
      name: string;
      shortcut: string;
      content: string;
    };

    if (!accountId || !name || !shortcut || !content) {
      return { success: false, error: "accountId, name, shortcut, and content are required" };
    }

    // Validate shortcut format: alphanumeric, no spaces, reasonable length
    if (!/^[a-zA-Z0-9_-]+$/.test(shortcut)) {
      return { success: false, error: "Shortcut can only contain letters, numbers, underscores, and hyphens" };
    }

    if (shortcut.length > 50) {
      return { success: false, error: "Shortcut must be 50 characters or less" };
    }

    try {
      const id = crypto.randomUUID();
      snippetQueries.insert.run(id, accountId, name, shortcut, content);

      return { success: true, id };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint failed")) {
        return { success: false, error: "A snippet with this shortcut already exists" };
      }
      return { success: false, error: e.message || String(e) };
    }
  })

  .put("/:id", async ({ params, body }) => {
    const { name, shortcut, content } = body as {
      name?: string;
      shortcut?: string;
      content?: string;
    };

    const snippet = snippetQueries.getById.get(params.id) as any;
    if (!snippet) {
      return { success: false, error: "Snippet not found" };
    }

    // Validate shortcut format if provided
    if (shortcut) {
      if (!/^[a-zA-Z0-9_-]+$/.test(shortcut)) {
        return { success: false, error: "Shortcut can only contain letters, numbers, underscores, and hyphens" };
      }

      if (shortcut.length > 50) {
        return { success: false, error: "Shortcut must be 50 characters or less" };
      }
    }

    try {
      snippetQueries.update.run(
        name || snippet.name,
        shortcut || snippet.shortcut,
        content || snippet.content,
        params.id
      );
      return { success: true };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint failed")) {
        return { success: false, error: "A snippet with this shortcut already exists" };
      }
      return { success: false, error: e.message || String(e) };
    }
  })

  .delete("/:id", async ({ params }) => {
    const snippet = snippetQueries.getById.get(params.id) as any;
    if (!snippet) {
      return { success: false, error: "Snippet not found" };
    }

    try {
      snippetQueries.delete.run(params.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  });
