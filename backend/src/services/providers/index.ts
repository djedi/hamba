import type { EmailProvider } from "./types";
import { GmailProvider } from "./gmail";
import { ImapSmtpProvider } from "./imap-smtp";
import { accountQueries } from "../../db";

export function getProvider(accountId: string): EmailProvider {
  const account = accountQueries.getById.get(accountId) as any;

  if (!account) {
    throw new Error("Account not found");
  }

  if (account.provider_type === "imap") {
    return new ImapSmtpProvider(accountId);
  }

  // Default to Gmail
  return new GmailProvider(accountId);
}

export * from "./types";
export { GmailProvider } from "./gmail";
export { ImapSmtpProvider } from "./imap-smtp";
