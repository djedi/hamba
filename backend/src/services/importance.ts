import { db, emailQueries } from "../db";

interface EmailData {
  id: string;
  account_id: string;
  from_email: string;
  from_name: string;
  subject: string;
  to_addresses: string;
  labels: string;
}

interface SenderStats {
  receivedCount: number;
  repliedCount: number;
  domain: string;
  isPersonalDomain: boolean;
}

// Domains that indicate automated/promotional emails
const AUTOMATED_DOMAINS = new Set([
  "noreply",
  "no-reply",
  "notifications",
  "notify",
  "mailer",
  "newsletter",
  "marketing",
  "promo",
  "info",
  "support",
  "updates",
  "alerts",
  "digest",
  "automated",
  "donotreply",
]);

// Common promotional/newsletter email patterns
const PROMO_PATTERNS = [
  /unsubscribe/i,
  /opt.?out/i,
  /email preferences/i,
  /manage.*subscriptions?/i,
  /\bsale\b/i,
  /\bdeal(s)?\b/i,
  /\boff\b.*\d+%/i,
  /\d+%.*\boff\b/i,
  /limited.?time/i,
  /act now/i,
  /don't miss/i,
  /exclusive offer/i,
  /free shipping/i,
];

// Personal email domain indicators (not company domains)
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "fastmail.com",
  "zoho.com",
  "mail.com",
  "live.com",
  "msn.com",
]);

// Get sender statistics from the database
function getSenderStats(accountId: string, fromEmail: string): SenderStats {
  const email = fromEmail.toLowerCase();
  const domain = email.split("@")[1] || "";
  const localPart = email.split("@")[0] || "";

  // Count emails received from this sender
  const receivedResult = db
    .prepare(
      `SELECT COUNT(*) as count FROM emails
       WHERE account_id = ? AND LOWER(from_email) = ?`
    )
    .get(accountId, email) as { count: number };

  // Count emails we've sent TO this person (indicates relationship)
  const repliedResult = db
    .prepare(
      `SELECT COUNT(*) as count FROM emails
       WHERE account_id = ? AND folder = 'sent' AND LOWER(to_addresses) LIKE ?`
    )
    .get(accountId, `%${email}%`) as { count: number };

  // Check if domain looks like a personal email
  const isPersonalDomain =
    PERSONAL_DOMAINS.has(domain) || !domain.includes(".");

  return {
    receivedCount: receivedResult.count,
    repliedCount: repliedResult.count,
    domain,
    isPersonalDomain,
  };
}

// Check if sender appears to be automated
function isAutomatedSender(fromEmail: string): boolean {
  const localPart = fromEmail.toLowerCase().split("@")[0] || "";

  for (const pattern of AUTOMATED_DOMAINS) {
    if (localPart.includes(pattern)) {
      return true;
    }
  }

  return false;
}

// Check if subject/content looks promotional
function hasPromoPatterns(subject: string): boolean {
  for (const pattern of PROMO_PATTERNS) {
    if (pattern.test(subject)) {
      return true;
    }
  }
  return false;
}

// Main classification function
export function classifyImportance(email: EmailData): boolean {
  const senderStats = getSenderStats(email.account_id, email.from_email);

  // IMPORTANT indicators (weighted scoring)
  let importanceScore = 0;

  // 1. If we've replied to this sender before, they're important (+30)
  if (senderStats.repliedCount > 0) {
    importanceScore += 30;
  }

  // 2. Frequent sender we interact with (+20)
  if (senderStats.receivedCount > 3 && senderStats.repliedCount > 0) {
    importanceScore += 20;
  }

  // 3. Personal domain email (+15)
  if (senderStats.isPersonalDomain) {
    importanceScore += 15;
  }

  // 4. Direct email (we're in To:, not CC/BCC) (+10)
  const toAddresses = email.to_addresses.toLowerCase();
  // Can't easily check this without knowing user's email, but if it's not a list, it's likely direct
  if (
    !toAddresses.includes(",") ||
    toAddresses.split(",").length < 5
  ) {
    importanceScore += 10;
  }

  // 5. Gmail labels - if marked IMPORTANT by Gmail (+20)
  try {
    const labels = JSON.parse(email.labels || "[]");
    if (labels.includes("IMPORTANT")) {
      importanceScore += 20;
    }
    // Category labels are generally less important
    if (
      labels.includes("CATEGORY_PROMOTIONS") ||
      labels.includes("CATEGORY_SOCIAL") ||
      labels.includes("CATEGORY_FORUMS") ||
      labels.includes("CATEGORY_UPDATES")
    ) {
      importanceScore -= 25;
    }
  } catch {
    // Invalid JSON, ignore
  }

  // NOT IMPORTANT indicators (negative scoring)

  // 1. Automated sender (-25)
  if (isAutomatedSender(email.from_email)) {
    importanceScore -= 25;
  }

  // 2. Promotional subject line (-20)
  if (hasPromoPatterns(email.subject)) {
    importanceScore -= 20;
  }

  // 3. Very frequent sender we never reply to (-15)
  if (senderStats.receivedCount > 10 && senderStats.repliedCount === 0) {
    importanceScore -= 15;
  }

  // 4. Common newsletter/bulk domains (-10)
  const domain = senderStats.domain;
  if (
    domain.includes("mailchimp") ||
    domain.includes("sendgrid") ||
    domain.includes("constantcontact") ||
    domain.includes("campaign-archive")
  ) {
    importanceScore -= 10;
  }

  // Threshold: >= 0 is important
  return importanceScore >= 0;
}

// Classify a single email and update database
export function classifyAndUpdateEmail(emailId: string): void {
  const email = emailQueries.getById.get(emailId) as EmailData | null;
  if (!email) return;

  const isImportant = classifyImportance(email);

  if (isImportant) {
    emailQueries.markImportant.run(emailId);
  } else {
    emailQueries.markNotImportant.run(emailId);
  }
}

// Classify all unclassified emails for an account
export function classifyAllEmails(accountId: string): number {
  const emails = db
    .prepare(
      `SELECT id, account_id, from_email, from_name, subject, to_addresses, labels
       FROM emails
       WHERE account_id = ? AND folder = 'inbox' AND is_trashed = 0`
    )
    .all(accountId) as EmailData[];

  let classified = 0;

  for (const email of emails) {
    const isImportant = classifyImportance(email);

    if (isImportant) {
      emailQueries.markImportant.run(email.id);
    } else {
      emailQueries.markNotImportant.run(email.id);
    }

    classified++;
  }

  return classified;
}
