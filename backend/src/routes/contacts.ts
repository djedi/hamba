import { Elysia, t } from "elysia";
import { db, contactQueries, emailQueries, accountQueries } from "../db";

interface Contact {
  id: string;
  account_id: string;
  email: string;
  name: string | null;
  last_contacted: number;
  contact_count: number;
  created_at: number;
}

interface Email {
  from_email: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string | null;
  received_at: number;
}

// Parse email addresses from comma-separated string
// Handles formats like: "name@email.com", "Name <name@email.com>"
function parseEmailAddresses(addressString: string | null): Array<{ email: string; name: string | null }> {
  if (!addressString) return [];

  const results: Array<{ email: string; name: string | null }> = [];
  const addresses = addressString.split(",").map((s) => s.trim()).filter(Boolean);

  for (const addr of addresses) {
    // Format: "Name <email@example.com>"
    const match = addr.match(/^(.+?)\s*<([^>]+)>$/);
    if (match) {
      results.push({ email: match[2].toLowerCase(), name: match[1].trim() || null });
    } else {
      // Plain email address
      const email = addr.toLowerCase().trim();
      if (email.includes("@")) {
        results.push({ email, name: null });
      }
    }
  }

  return results;
}

// Populate contacts from existing emails in the database
async function populateContactsFromEmails(accountId: string): Promise<number> {
  // Get all emails for this account
  const emails = db
    .prepare(
      `SELECT from_email, from_name, to_addresses, cc_addresses, received_at
       FROM emails WHERE account_id = ?`
    )
    .all(accountId) as Email[];

  let count = 0;
  const seenEmails = new Set<string>();

  for (const email of emails) {
    // Extract contacts from from, to, and cc addresses
    const contacts: Array<{ email: string; name: string | null; timestamp: number }> = [];

    // From address (received emails)
    if (email.from_email) {
      contacts.push({
        email: email.from_email.toLowerCase(),
        name: email.from_name || null,
        timestamp: email.received_at,
      });
    }

    // To addresses (sent emails or correspondence)
    for (const addr of parseEmailAddresses(email.to_addresses)) {
      contacts.push({ ...addr, timestamp: email.received_at });
    }

    // CC addresses
    for (const addr of parseEmailAddresses(email.cc_addresses)) {
      contacts.push({ ...addr, timestamp: email.received_at });
    }

    // Upsert each contact
    for (const contact of contacts) {
      if (!contact.email || !contact.email.includes("@")) continue;

      // Skip if we've already processed this email in this batch
      const key = `${accountId}:${contact.email}`;
      if (seenEmails.has(key)) continue;
      seenEmails.add(key);

      try {
        contactQueries.upsert.run(
          crypto.randomUUID(),
          accountId,
          contact.email,
          contact.name,
          contact.timestamp
        );
        count++;
      } catch (e) {
        // Ignore duplicates or other errors
      }
    }
  }

  return count;
}

export const contactRoutes = new Elysia({ prefix: "/contacts" })
  // Get all contacts for an account
  .get("/", ({ query }) => {
    const { accountId } = query;
    if (!accountId) {
      return { error: "accountId required" };
    }
    const contacts = contactQueries.getByAccount.all(accountId) as Contact[];
    return contacts;
  }, {
    query: t.Object({
      accountId: t.String(),
    }),
  })

  // Search contacts
  .get("/search", ({ query }) => {
    const { accountId, q, limit = 10 } = query;
    if (!accountId) {
      return { error: "accountId required" };
    }
    if (!q) {
      // Return recent contacts if no query
      const contacts = contactQueries.getByAccount.all(accountId) as Contact[];
      return contacts.slice(0, limit);
    }

    const searchPattern = `%${q}%`;
    const contacts = contactQueries.search.all(accountId, searchPattern, searchPattern, limit) as Contact[];
    return contacts;
  }, {
    query: t.Object({
      accountId: t.String(),
      q: t.Optional(t.String()),
      limit: t.Optional(t.Number()),
    }),
  })

  // Populate contacts from existing emails
  .post("/populate", async ({ query }) => {
    const { accountId } = query;
    if (!accountId) {
      return { success: false, error: "accountId required" };
    }

    // Verify account exists
    const account = accountQueries.getById.get(accountId);
    if (!account) {
      return { success: false, error: "Account not found" };
    }

    try {
      const count = await populateContactsFromEmails(accountId);
      return { success: true, count };
    } catch (error) {
      console.error("Error populating contacts:", error);
      return { success: false, error: "Failed to populate contacts" };
    }
  }, {
    query: t.Object({
      accountId: t.String(),
    }),
  })

  // Add or update a contact manually
  .post("/", ({ body }) => {
    const { accountId, email, name } = body;

    if (!accountId || !email) {
      return { success: false, error: "accountId and email required" };
    }

    try {
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      contactQueries.upsert.run(id, accountId, email.toLowerCase(), name || null, now);
      return { success: true, id };
    } catch (error) {
      console.error("Error adding contact:", error);
      return { success: false, error: "Failed to add contact" };
    }
  }, {
    body: t.Object({
      accountId: t.String(),
      email: t.String(),
      name: t.Optional(t.String()),
    }),
  })

  // Delete a contact
  .delete("/:id", ({ params }) => {
    const { id } = params;

    try {
      contactQueries.delete.run(id);
      return { success: true };
    } catch (error) {
      console.error("Error deleting contact:", error);
      return { success: false, error: "Failed to delete contact" };
    }
  });

// Export function to add contact when sending email
export function addContactFromSend(
  accountId: string,
  toAddresses: string,
  ccAddresses?: string,
  bccAddresses?: string
) {
  const now = Math.floor(Date.now() / 1000);

  for (const addr of parseEmailAddresses(toAddresses)) {
    try {
      contactQueries.upsert.run(crypto.randomUUID(), accountId, addr.email, addr.name, now);
    } catch (e) {
      // Ignore errors
    }
  }

  if (ccAddresses) {
    for (const addr of parseEmailAddresses(ccAddresses)) {
      try {
        contactQueries.upsert.run(crypto.randomUUID(), accountId, addr.email, addr.name, now);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  if (bccAddresses) {
    for (const addr of parseEmailAddresses(bccAddresses)) {
      try {
        contactQueries.upsert.run(crypto.randomUUID(), accountId, addr.email, addr.name, now);
      } catch (e) {
        // Ignore errors
      }
    }
  }
}

// Export function to add contact when receiving email
export function addContactFromReceive(
  accountId: string,
  fromEmail: string,
  fromName: string | null,
  receivedAt: number
) {
  if (!fromEmail || !fromEmail.includes("@")) return;

  try {
    contactQueries.upsert.run(
      crypto.randomUUID(),
      accountId,
      fromEmail.toLowerCase(),
      fromName,
      receivedAt
    );
  } catch (e) {
    // Ignore errors
  }
}
