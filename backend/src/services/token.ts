import { accountQueries } from "../db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";

export interface TokenResult {
  accessToken: string | null;
  error?: string;
  needsReauth?: boolean;
}

/**
 * Get a valid access token for an account, refreshing if needed.
 * Returns null if the account doesn't exist or refresh fails.
 */
export async function getValidAccessToken(accountId: string): Promise<TokenResult> {
  const account = accountQueries.getById.get(accountId) as any;

  if (!account) {
    return { accessToken: null, error: "Account not found" };
  }

  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300; // 5 minute buffer

  // Check if token is still valid
  if (account.token_expires_at && account.token_expires_at > now + bufferSeconds) {
    return { accessToken: account.access_token };
  }

  // Token expired or expiring soon - refresh it
  console.log(`🔄 Refreshing token for ${account.email}`);

  if (!account.refresh_token) {
    return {
      accessToken: null,
      error: "No refresh token available",
      needsReauth: true,
    };
  }

  try {
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
      console.error(`❌ Token refresh failed: ${tokens.error_description}`);

      // If refresh token is invalid, user needs to re-authenticate
      if (
        tokens.error === "invalid_grant" ||
        tokens.error === "invalid_token"
      ) {
        return {
          accessToken: null,
          error: "Session expired. Please re-authenticate.",
          needsReauth: true,
        };
      }

      return {
        accessToken: null,
        error: tokens.error_description || "Token refresh failed",
      };
    }

    // Update stored tokens
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

    accountQueries.upsert.run(
      account.id,
      account.email,
      account.name,
      tokens.access_token,
      account.refresh_token, // Keep existing refresh token
      expiresAt
    );

    console.log(`✅ Token refreshed for ${account.email}`);

    return { accessToken: tokens.access_token || null };
  } catch (err) {
    console.error("Token refresh error:", err);
    return {
      accessToken: null,
      error: "Network error during token refresh",
    };
  }
}

/**
 * Check if an account's token needs refresh (for frontend status)
 */
export function tokenNeedsRefresh(accountId: string): boolean {
  const account = accountQueries.getById.get(accountId) as any;
  if (!account) return false;

  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300;

  return !account.token_expires_at || account.token_expires_at <= now + bufferSeconds;
}

/**
 * Get a valid access token for a Microsoft account, refreshing if needed.
 * Returns null if the account doesn't exist or refresh fails.
 */
export async function getMicrosoftAccessToken(accountId: string): Promise<TokenResult> {
  const account = accountQueries.getById.get(accountId) as any;

  if (!account) {
    return { accessToken: null, error: "Account not found" };
  }

  if (account.provider_type !== "microsoft") {
    return { accessToken: null, error: "Not a Microsoft account" };
  }

  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300; // 5 minute buffer

  // Check if token is still valid
  if (account.token_expires_at && account.token_expires_at > now + bufferSeconds) {
    return { accessToken: account.access_token };
  }

  // Token expired or expiring soon - refresh it
  console.log(`🔄 Refreshing Microsoft token for ${account.email}`);

  if (!account.refresh_token) {
    return {
      accessToken: null,
      error: "No refresh token available",
      needsReauth: true,
    };
  }

  try {
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        refresh_token: account.refresh_token,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access",
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
      console.error(`❌ Microsoft token refresh failed: ${tokens.error_description}`);

      // If refresh token is invalid, user needs to re-authenticate
      if (
        tokens.error === "invalid_grant" ||
        tokens.error === "invalid_token"
      ) {
        return {
          accessToken: null,
          error: "Session expired. Please re-authenticate.",
          needsReauth: true,
        };
      }

      return {
        accessToken: null,
        error: tokens.error_description || "Token refresh failed",
      };
    }

    // Update stored tokens
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);

    // Microsoft returns a new refresh token, so we should update it
    accountQueries.upsert.run(
      account.id,
      account.email,
      account.name,
      tokens.access_token,
      tokens.refresh_token || account.refresh_token,
      expiresAt
    );

    console.log(`✅ Microsoft token refreshed for ${account.email}`);

    return { accessToken: tokens.access_token || null };
  } catch (err) {
    console.error("Microsoft token refresh error:", err);
    return {
      accessToken: null,
      error: "Network error during token refresh",
    };
  }
}
