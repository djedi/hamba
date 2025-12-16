import { Elysia } from "elysia";
import { labelQueries, emailLabelQueries } from "../db";
import { getProvider } from "../services/providers";

export const labelRoutes = new Elysia({ prefix: "/labels", detail: { tags: ["Labels"] } })
  .get("/", async ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const labels = labelQueries.getByAccount.all(accountId);
    return labels;
  }, {
    detail: {
      summary: "List labels",
      description: "Returns all labels (both user-created and system/Gmail labels) for the specified account",
      responses: {
        200: {
          description: "List of labels",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Label" },
              },
            },
          },
        },
      },
    },
  })

  .get("/:id", ({ params }) => {
    return labelQueries.getById.get(params.id);
  }, {
    detail: {
      summary: "Get label by ID",
      description: "Returns a single label by its ID",
      responses: {
        200: {
          description: "Label details",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Label" } } },
        },
      },
    },
  })

  .get("/:id/emails", ({ params, query }) => {
    const { limit = "50", offset = "0" } = query;

    return emailLabelQueries.getEmailsForLabel.all(
      params.id,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  }, {
    detail: {
      summary: "Get emails with label",
      description: "Returns all emails that have the specified label applied",
      responses: {
        200: {
          description: "List of emails with this label",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Email" },
              },
            },
          },
        },
      },
    },
  })

  .get("/:id/count", ({ params }) => {
    const result = emailLabelQueries.countEmailsForLabel.get(params.id) as { count: number };
    return { count: result?.count || 0 };
  }, {
    detail: {
      summary: "Count emails with label",
      description: "Returns the number of emails that have the specified label",
      responses: {
        200: {
          description: "Email count",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  count: { type: "integer", description: "Number of emails with this label" },
                },
              },
            },
          },
        },
      },
    },
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
  }, {
    detail: {
      summary: "Create label",
      description: "Creates a new user label with optional color",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["accountId", "name"],
              properties: {
                accountId: { type: "string", description: "Account UUID" },
                name: { type: "string", description: "Label name" },
                color: { type: "string", default: "#6366f1", description: "Hex color code" },
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
                  id: { type: "string", description: "Created label ID" },
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
  }, {
    detail: {
      summary: "Update label",
      description: "Updates a label's name or color",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Label name" },
                color: { type: "string", description: "Hex color code" },
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
  }, {
    detail: {
      summary: "Delete label",
      description: "Permanently deletes a label (also removes it from all emails)",
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

  .post("/:id/emails/:emailId", async ({ params }) => {
    const { id, emailId } = params;

    try {
      emailLabelQueries.addLabelToEmail.run(emailId, id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }, {
    detail: {
      summary: "Add label to email",
      description: "Applies a label to an email",
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

  .delete("/:id/emails/:emailId", async ({ params }) => {
    const { id, emailId } = params;

    try {
      emailLabelQueries.removeLabelFromEmail.run(emailId, id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }, {
    detail: {
      summary: "Remove label from email",
      description: "Removes a label from an email",
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

  .get("/email/:emailId", ({ params }) => {
    return emailLabelQueries.getLabelsForEmail.all(params.emailId);
  }, {
    detail: {
      summary: "Get labels for email",
      description: "Returns all labels applied to a specific email",
      responses: {
        200: {
          description: "List of labels",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Label" },
              },
            },
          },
        },
      },
    },
  });
