import { Elysia } from "elysia";
import { signatureQueries } from "../db";

export const signatureRoutes = new Elysia({ prefix: "/signatures", detail: { tags: ["Signatures"] } })
  .get("/", async ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const signatures = signatureQueries.getByAccount.all(accountId);
    return signatures;
  }, {
    detail: {
      summary: "List signatures",
      description: "Returns all email signatures for the specified account",
      responses: {
        200: {
          description: "List of signatures",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Signature" },
              },
            },
          },
        },
      },
    },
  })

  .get("/:id", ({ params }) => {
    return signatureQueries.getById.get(params.id);
  }, {
    detail: {
      summary: "Get signature by ID",
      description: "Returns a single signature by its ID",
      responses: {
        200: {
          description: "Signature details",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Signature" } } },
        },
      },
    },
  })

  .get("/default/:accountId", ({ params }) => {
    return signatureQueries.getDefault.get(params.accountId) || null;
  }, {
    detail: {
      summary: "Get default signature",
      description: "Returns the default signature for an account, or null if none set",
      responses: {
        200: {
          description: "Default signature or null",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/Signature" },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
    },
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
  }, {
    detail: {
      summary: "Create signature",
      description: "Creates a new email signature. Optionally set as default for the account.",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["accountId", "name", "content"],
              properties: {
                accountId: { type: "string", description: "Account UUID" },
                name: { type: "string", maxLength: 100, description: "Signature name" },
                content: { type: "string", description: "Signature content (plain text or HTML)" },
                isHtml: { type: "boolean", default: false, description: "Whether content is HTML" },
                isDefault: { type: "boolean", default: false, description: "Set as default signature" },
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
                  id: { type: "string", description: "Created signature ID" },
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
  }, {
    detail: {
      summary: "Update signature",
      description: "Updates an existing signature's name, content, or HTML flag",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", maxLength: 100, description: "Signature name" },
                content: { type: "string", description: "Signature content" },
                isHtml: { type: "boolean", description: "Whether content is HTML" },
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
  }, {
    detail: {
      summary: "Set as default signature",
      description: "Sets this signature as the default for its account. Clears any previous default.",
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
  }, {
    detail: {
      summary: "Clear default signature",
      description: "Removes the default signature setting for the account",
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
  }, {
    detail: {
      summary: "Delete signature",
      description: "Permanently deletes a signature",
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
