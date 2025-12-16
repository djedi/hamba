import { Elysia } from "elysia";
import { snippetQueries } from "../db";

export const snippetRoutes = new Elysia({ prefix: "/snippets", detail: { tags: ["Snippets"] } })
  .get("/", async ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const snippets = snippetQueries.getByAccount.all(accountId);
    return snippets;
  }, {
    detail: {
      summary: "List snippets",
      description: "Returns all snippets for the specified account",
      responses: {
        200: {
          description: "List of snippets",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Snippet" },
              },
            },
          },
        },
      },
    },
  })

  .get("/:id", ({ params }) => {
    return snippetQueries.getById.get(params.id);
  }, {
    detail: {
      summary: "Get snippet by ID",
      description: "Returns a single snippet by its ID",
      responses: {
        200: {
          description: "Snippet details",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Snippet" } } },
        },
      },
    },
  })

  .get("/by-shortcut/:shortcut", ({ params, query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return snippetQueries.getByShortcut.get(accountId, params.shortcut);
  }, {
    detail: {
      summary: "Get snippet by shortcut",
      description: "Finds a snippet by its shortcut trigger (e.g., 'thanks' for ';thanks')",
      responses: {
        200: {
          description: "Snippet details or null if not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Snippet" } } },
        },
      },
    },
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
  }, {
    detail: {
      summary: "Create snippet",
      description: "Creates a new text snippet with a shortcut trigger. Type ;shortcut in compose to expand.",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["accountId", "name", "shortcut", "content"],
              properties: {
                accountId: { type: "string", description: "Account UUID" },
                name: { type: "string", description: "Snippet name" },
                shortcut: { type: "string", description: "Trigger shortcut (alphanumeric, max 50 chars)" },
                content: { type: "string", description: "Snippet content to expand" },
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
                  id: { type: "string", description: "Created snippet ID" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
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
  }, {
    detail: {
      summary: "Update snippet",
      description: "Updates an existing snippet's name, shortcut, or content",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Snippet name" },
                shortcut: { type: "string", description: "Trigger shortcut" },
                content: { type: "string", description: "Snippet content" },
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
  }, {
    detail: {
      summary: "Delete snippet",
      description: "Permanently deletes a snippet",
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
  });
