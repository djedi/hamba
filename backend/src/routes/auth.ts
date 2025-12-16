import { Elysia, t } from "elysia";
import { accountQueries, db } from "../db";
import { getValidAccessToken, getMicrosoftAccessToken, tokenNeedsRefresh } from "../services/token";
import { ImapSmtpProvider, MicrosoftProvider } from "../services/providers";
import { startIdle } from "../services/imap-idle";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:3001/auth/callback";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || "http://localhost:3001/auth/microsoft/callback";

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

export const authRoutes = new Elysia({ prefix: "/auth" })
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

    if (tokens.error) {
      return { error: tokens.error_description || tokens.error };
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
    `, [id, email, user.displayName || email.split("@")[0], tokens.access_token, tokens.refresh_token, expiresAt]);

    // Redirect to frontend with success
    return redirect(`http://localhost:5173/?auth=success&email=${encodeURIComponent(email)}`);
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
  })

  .get("/accounts/:id/status", async ({ params }) => {
    const result = await getValidAccessToken(params.id);
    return {
      valid: !!result.accessToken,
      needsReauth: result.needsReauth || false,
      error: result.error,
    };
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
  })

  .delete("/accounts/:id", ({ params }) => {
    accountQueries.delete.run(params.id);
    return { success: true };
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
  });
