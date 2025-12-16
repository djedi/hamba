import { Elysia, t } from "elysia";
import { accountQueries, db } from "../db";
import { getValidAccessToken, getMicrosoftAccessToken, getYahooAccessToken, tokenNeedsRefresh } from "../services/token";
import { ImapSmtpProvider, MicrosoftProvider } from "../services/providers";
import { startIdle } from "../services/imap-idle";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:3001/auth/callback";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || "http://localhost:3001/auth/microsoft/callback";

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID || "";
const YAHOO_CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET || "";
const YAHOO_REDIRECT_URI = process.env.YAHOO_REDIRECT_URI || "http://localhost:3001/auth/yahoo/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

const MICROSOFT_SCOPES = [
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
].join(" ");

// Yahoo requires openid for user info endpoint, mail-w for read/write access
const YAHOO_SCOPES = [
  "openid",
  "email",
  "profile",
  "mail-w", // mail write includes read
].join(" ");

export const authRoutes = new Elysia({ prefix: "/auth", detail: { tags: ["Auth"] } })
  .get("/login", ({ redirect }) => {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    });

    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }, {
    detail: {
      summary: "Initiate Google OAuth login",
      description: "Redirects user to Google OAuth consent screen for Gmail account authentication",
      responses: {
        302: { description: "Redirect to Google OAuth" },
      },
    },
  })

  .get("/callback", async ({ query, redirect }) => {
    const { code } = query;

    if (!code) {
      return { error: "No authorization code provided" };
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokens.error) {
      return { error: tokens.error_description };
    }

    // Get user info
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const user = await userResponse.json() as { email: string; name: string };

    // Store account
    const id = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

    accountQueries.upsert.run(
      id,
      user.email,
      user.name,
      tokens.access_token || "",
      tokens.refresh_token || "",
      expiresAt
    );

    // Redirect to frontend with success
    return redirect(`http://localhost:5173/?auth=success&email=${encodeURIComponent(user.email)}`);
  }, {
    detail: {
      summary: "Google OAuth callback",
      description: "Handles the OAuth callback from Google, exchanges code for tokens, and creates/updates account",
      responses: {
        302: { description: "Redirect to frontend with success" },
        200: { description: "Error response", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  })

  // Microsoft OAuth routes
  .get("/login/microsoft", ({ redirect }) => {
    if (!MICROSOFT_CLIENT_ID) {
      return { error: "Microsoft OAuth is not configured" };
    }

    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      redirect_uri: MICROSOFT_REDIRECT_URI,
      response_type: "code",
      scope: MICROSOFT_SCOPES,
      response_mode: "query",
    });

    return redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
  }, {
    detail: {
      summary: "Initiate Microsoft OAuth login",
      description: "Redirects user to Microsoft OAuth consent screen for Outlook/Office365 account authentication",
      responses: {
        302: { description: "Redirect to Microsoft OAuth" },
        200: { description: "Error if not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  })

  .get("/microsoft/callback", async ({ query, redirect }) => {
    const { code, error: oauthError, error_description } = query;

    if (oauthError) {
      return { error: error_description || oauthError };
    }

    if (!code) {
      return { error: "No authorization code provided" };
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: MICROSOFT_REDIRECT_URI,
        scope: MICROSOFT_SCOPES,
      }),
    });

    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokens.error || !tokens.access_token) {
      return { error: tokens.error_description || tokens.error || "Failed to get access token" };
    }

    // Get user info from Microsoft Graph
    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const user = await userResponse.json() as {
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
    };

    // Microsoft can return email in different fields
    const email = user.mail || user.userPrincipalName || "";
    if (!email) {
      return { error: "Could not retrieve email address from Microsoft account" };
    }

    // Store account with microsoft provider type
    const id = crypto.randomUUID();
    // Non-null assertion safe here because we returned early if !tokens.access_token
    const accessToken = tokens.access_token!;
    const refreshToken = tokens.refresh_token ?? null;
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

    // Use raw SQL to set provider_type to microsoft
    db.run(`
      INSERT INTO accounts (id, email, name, provider_type, access_token, refresh_token, token_expires_at, updated_at)
      VALUES (?, ?, ?, 'microsoft', ?, ?, ?, unixepoch())
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        provider_type = 'microsoft',
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        updated_at = unixepoch()
    `, [id, email, user.displayName ?? email.split("@")[0] ?? email, accessToken, refreshToken, expiresAt]);

    // Redirect to frontend with success
    return redirect(`http://localhost:5173/?auth=success&email=${encodeURIComponent(email)}`);
  }, {
    detail: {
      summary: "Microsoft OAuth callback",
      description: "Handles the OAuth callback from Microsoft, exchanges code for tokens, and creates/updates account",
      responses: {
        302: { description: "Redirect to frontend with success" },
        200: { description: "Error response", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  })

  // Yahoo OAuth routes
  .get("/login/yahoo", ({ redirect }) => {
    if (!YAHOO_CLIENT_ID) {
      return { error: "Yahoo OAuth is not configured" };
    }

    const params = new URLSearchParams({
      client_id: YAHOO_CLIENT_ID,
      redirect_uri: YAHOO_REDIRECT_URI,
      response_type: "code",
      scope: YAHOO_SCOPES,
    });

    return redirect(`https://api.login.yahoo.com/oauth2/request_auth?${params}`);
  }, {
    detail: {
      summary: "Initiate Yahoo OAuth login",
      description: "Redirects user to Yahoo OAuth consent screen for Yahoo Mail account authentication",
      responses: {
        302: { description: "Redirect to Yahoo OAuth" },
        200: { description: "Error if not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  })

  .get("/yahoo/callback", async ({ query, redirect }) => {
    const { code, error: oauthError, error_description } = query;

    if (oauthError) {
      return { error: error_description || oauthError };
    }

    if (!code) {
      return { error: "No authorization code provided" };
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: YAHOO_REDIRECT_URI,
      }),
    });

    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      xoauth_yahoo_guid?: string;
      error?: string;
      error_description?: string;
    };

    if (tokens.error || !tokens.access_token) {
      return { error: tokens.error_description || tokens.error || "Failed to get access token" };
    }

    // Get user info from Yahoo OpenID Connect userinfo endpoint
    const userResponse = await fetch("https://api.login.yahoo.com/openid/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const user = await userResponse.json() as {
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
      preferred_username?: string;
    };

    const email = user.email || "";
    if (!email) {
      return { error: "Could not retrieve email address from Yahoo account" };
    }

    const displayName = user.name || user.given_name || user.preferred_username || email.split("@")[0] || email;

    // Store account with yahoo provider type
    const id = crypto.randomUUID();
    // Non-null assertion safe here because we returned early if !tokens.access_token
    const accessToken = tokens.access_token!;
    const refreshToken = tokens.refresh_token ?? null;
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

    // Use raw SQL to set provider_type to yahoo
    db.run(`
      INSERT INTO accounts (id, email, name, provider_type, access_token, refresh_token, token_expires_at, updated_at)
      VALUES (?, ?, ?, 'yahoo', ?, ?, ?, unixepoch())
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        provider_type = 'yahoo',
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        updated_at = unixepoch()
    `, [id, email, displayName, accessToken, refreshToken, expiresAt]);

    // Redirect to frontend with success
    return redirect(`http://localhost:5173/?auth=success&email=${encodeURIComponent(email)}`);
  }, {
    detail: {
      summary: "Yahoo OAuth callback",
      description: "Handles the OAuth callback from Yahoo, exchanges code for tokens, and creates/updates account",
      responses: {
        302: { description: "Redirect to frontend with success" },
        200: { description: "Error response", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  })

  .get("/accounts", () => {
    const accounts = accountQueries.getAll.all() as any[];

    // Get unread counts per account
    const unreadCounts = db.prepare(`
      SELECT account_id, COUNT(*) as unread_count
      FROM emails
      WHERE is_read = 0 AND is_trashed = 0 AND is_archived = 0 AND snoozed_until IS NULL
      GROUP BY account_id
    `).all() as { account_id: string; unread_count: number }[];

    const unreadMap = new Map(unreadCounts.map(r => [r.account_id, r.unread_count]));

    // Don't expose tokens or password
    return accounts.map(({
      access_token,
      refresh_token,
      token_expires_at,
      password,
      ...account
    }) => ({
      ...account,
      // Include account settings with defaults
      display_name: account.display_name || null,
      sync_frequency_seconds: account.sync_frequency_seconds ?? 60,
      unread_count: unreadMap.get(account.id) || 0,
      tokenStatus: account.provider_type === "imap"
        ? "valid" // IMAP accounts don't expire like OAuth
        : token_expires_at
          ? token_expires_at > Math.floor(Date.now() / 1000)
            ? "valid"
            : "expired"
          : "unknown",
    }));
  }, {
    detail: {
      summary: "List all accounts",
      description: "Returns all configured email accounts with unread counts and token status. Sensitive credentials are excluded.",
      responses: {
        200: {
          description: "List of accounts",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/Account" },
              },
            },
          },
        },
      },
    },
  })

  .post("/accounts/imap", async ({ body }) => {
    const {
      email,
      name,
      username,
      password,
      imapHost,
      imapPort,
      imapUseTls,
      smtpHost,
      smtpPort,
      smtpUseTls,
    } = body as {
      email: string;
      name?: string;
      username?: string;
      password: string;
      imapHost: string;
      imapPort?: number;
      imapUseTls?: boolean;
      smtpHost: string;
      smtpPort?: number;
      smtpUseTls?: boolean;
    };

    if (!email || !password || !imapHost || !smtpHost) {
      return { error: "Missing required fields (email, password, imapHost, smtpHost)" };
    }

    const id = crypto.randomUUID();

    try {
      // Insert the account
      const displayName = (name ?? email.split("@")[0]) as string;
      db.run(`
        INSERT INTO accounts (
          id, email, name, username, provider_type,
          imap_host, imap_port, imap_use_tls,
          smtp_host, smtp_port, smtp_use_tls,
          password
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        email,
        displayName,
        username || null,  // null means use email as username
        "imap",
        imapHost,
        imapPort || 993,
        imapUseTls !== false ? 1 : 0,
        smtpHost,
        smtpPort || 587,
        smtpUseTls !== false ? 1 : 0,
        password,
      ]);

      // Test the connection
      const provider = new ImapSmtpProvider(id);
      const valid = await provider.validateCredentials();

      if (!valid) {
        // Delete the test account
        accountQueries.delete.run(id);
        return { error: "Invalid IMAP credentials - could not connect to server" };
      }

      // Start IMAP IDLE for real-time notifications
      startIdle(id).catch(console.error);

      return {
        success: true,
        account: {
          id,
          email,
          name: name || email.split("@")[0],
          provider_type: "imap",
        },
      };
    } catch (error: any) {
      // Clean up on error
      try {
        accountQueries.delete.run(id);
      } catch (e) {
        // Ignore cleanup errors
      }

      // Check for duplicate email error
      if (error.message?.includes("UNIQUE constraint")) {
        return { error: "An account with this email already exists" };
      }

      return { error: `Failed to add account: ${error.message || error}` };
    }
  }, {
    detail: {
      summary: "Add IMAP/SMTP account",
      description: "Creates a new IMAP/SMTP email account. Validates credentials before saving.",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password", "imapHost", "smtpHost"],
              properties: {
                email: { type: "string", format: "email", description: "Account email address" },
                name: { type: "string", description: "Display name" },
                username: { type: "string", description: "IMAP/SMTP username (defaults to email)" },
                password: { type: "string", description: "Account password" },
                imapHost: { type: "string", description: "IMAP server hostname" },
                imapPort: { type: "integer", default: 993, description: "IMAP port" },
                imapUseTls: { type: "boolean", default: true, description: "Use TLS for IMAP" },
                smtpHost: { type: "string", description: "SMTP server hostname" },
                smtpPort: { type: "integer", default: 587, description: "SMTP port" },
                smtpUseTls: { type: "boolean", default: true, description: "Use TLS for SMTP" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Account created or error",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      account: { $ref: "#/components/schemas/Account" },
                    },
                  },
                  { $ref: "#/components/schemas/Error" },
                ],
              },
            },
          },
        },
      },
    },
  })

  .get("/accounts/:id/status", async ({ params }) => {
    const result = await getValidAccessToken(params.id);
    return {
      valid: !!result.accessToken,
      needsReauth: result.needsReauth || false,
      error: result.error,
    };
  }, {
    detail: {
      summary: "Check account token status",
      description: "Checks if the account's OAuth token is valid and whether re-authentication is needed",
      responses: {
        200: {
          description: "Token status",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  valid: { type: "boolean", description: "Whether token is valid" },
                  needsReauth: { type: "boolean", description: "Whether re-authentication is required" },
                  error: { type: "string", nullable: true, description: "Error message if any" },
                },
              },
            },
          },
        },
      },
    },
  })

  .get("/accounts/:id", ({ params }) => {
    const account = accountQueries.getById.get(params.id) as any;
    if (!account) {
      return { error: "Account not found" };
    }

    // Don't expose sensitive fields
    const {
      access_token,
      refresh_token,
      token_expires_at,
      password,
      ...safeAccount
    } = account;

    return safeAccount;
  }, {
    detail: {
      summary: "Get account details",
      description: "Returns account details excluding sensitive credentials",
      responses: {
        200: {
          description: "Account details or error",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/Account" },
                  { $ref: "#/components/schemas/Error" },
                ],
              },
            },
          },
        },
      },
    },
  })

  .put("/accounts/:id", async ({ params, body }) => {
    const { displayName, syncFrequencySeconds } = body as {
      displayName?: string;
      syncFrequencySeconds?: number;
    };

    const account = accountQueries.getById.get(params.id) as any;
    if (!account) {
      return { error: "Account not found" };
    }

    // Validate sync frequency (minimum 30 seconds, max 1 hour)
    let syncFreq = syncFrequencySeconds;
    if (syncFreq !== undefined) {
      if (syncFreq < 30) syncFreq = 30;
      if (syncFreq > 3600) syncFreq = 3600;
    }

    accountQueries.updateSettings.run(
      displayName ?? account.display_name ?? null,
      syncFreq ?? account.sync_frequency_seconds ?? 60,
      params.id
    );

    return { success: true };
  }, {
    detail: {
      summary: "Update account settings",
      description: "Updates account display name and sync frequency (30s-3600s range)",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                displayName: { type: "string", description: "Custom display name for account" },
                syncFrequencySeconds: { type: "integer", minimum: 30, maximum: 3600, description: "Email sync interval in seconds" },
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
                oneOf: [
                  { $ref: "#/components/schemas/Success" },
                  { $ref: "#/components/schemas/Error" },
                ],
              },
            },
          },
        },
      },
    },
  })

  .delete("/accounts/:id", ({ params }) => {
    accountQueries.delete.run(params.id);
    return { success: true };
  }, {
    detail: {
      summary: "Delete account",
      description: "Permanently deletes an email account and all associated data",
      responses: {
        200: {
          description: "Success",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
        },
      },
    },
  })

  .post("/refresh/:accountId", async ({ params }) => {
    const account = accountQueries.getById.get(params.accountId) as any;

    if (!account?.refresh_token) {
      return { error: "Account not found or no refresh token" };
    }

    // Handle Microsoft accounts
    if (account.provider_type === "microsoft") {
      const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: MICROSOFT_CLIENT_ID,
          client_secret: MICROSOFT_CLIENT_SECRET,
          refresh_token: account.refresh_token,
          grant_type: "refresh_token",
          scope: MICROSOFT_SCOPES,
        }),
      });

      const tokens = await tokenResponse.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (tokens.error) {
        return { error: tokens.error_description || tokens.error };
      }

      const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

      db.run(`
        UPDATE accounts
        SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = unixepoch()
        WHERE id = ?
      `, [tokens.access_token, tokens.refresh_token || account.refresh_token, expiresAt, account.id]);

      return { success: true };
    }

    // Handle Yahoo accounts
    if (account.provider_type === "yahoo") {
      const tokenResponse = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          refresh_token: account.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      const tokens = await tokenResponse.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (tokens.error) {
        return { error: tokens.error_description || tokens.error };
      }

      const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

      db.run(`
        UPDATE accounts
        SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = unixepoch()
        WHERE id = ?
      `, [tokens.access_token, tokens.refresh_token || account.refresh_token, expiresAt, account.id]);

      return { success: true };
    }

    // Handle Gmail accounts (default)
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: account.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const tokens = await tokenResponse.json() as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokens.error) {
      return { error: tokens.error_description };
    }

    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

    accountQueries.upsert.run(
      account.id,
      account.email,
      account.name,
      tokens.access_token,
      account.refresh_token, // Keep existing refresh token
      expiresAt
    );

    return { success: true };
  }, {
    detail: {
      summary: "Refresh OAuth tokens",
      description: "Refreshes expired OAuth tokens for Gmail, Microsoft, or Yahoo accounts",
      responses: {
        200: {
          description: "Success or error",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/Success" },
                  { $ref: "#/components/schemas/Error" },
                ],
              },
            },
          },
        },
      },
    },
  });
