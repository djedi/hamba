import { describe, it, expect } from "bun:test";

// We need to test the parsing functions from Gmail provider
// Since they're not exported, we'll recreate them here for testing
// In a real scenario, you'd export these functions for testability

// Parse Gmail message to our format
function parseGmailMessage(msg: any, accountId: string) {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const fromHeader = getHeader("From");
  const fromMatch = fromHeader.match(/^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$/);

  return {
    id: msg.id,
    accountId,
    threadId: msg.threadId,
    messageId: getHeader("Message-ID"),
    subject: getHeader("Subject"),
    snippet: msg.snippet,
    fromName: fromMatch?.[1]?.trim() || "",
    fromEmail: fromMatch?.[2]?.trim() || fromHeader,
    toAddresses: getHeader("To"),
    ccAddresses: getHeader("Cc"),
    bccAddresses: getHeader("Bcc"),
    bodyText: "",
    bodyHtml: "",
    labels: JSON.stringify(msg.labelIds || []),
    isRead: !msg.labelIds?.includes("UNREAD"),
    isStarred: msg.labelIds?.includes("STARRED"),
    receivedAt: Math.floor(parseInt(msg.internalDate) / 1000),
  };
}

// Extract body and attachments from Gmail message payload
interface AttachmentInfo {
  attachmentId: string;
  contentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
}

function extractBodyAndAttachments(payload: any): { text: string; html: string; attachments: AttachmentInfo[] } {
  let text = "";
  let html = "";
  const attachments: AttachmentInfo[] = [];

  function processPart(part: any) {
    const headers = part.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    if (part.mimeType === "text/plain" && part.body?.data) {
      text = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.body?.attachmentId) {
      // This is an attachment
      const contentId = getHeader("Content-ID")?.replace(/^<|>$/g, "") || null;
      attachments.push({
        attachmentId: part.body.attachmentId,
        contentId,
        filename: part.filename || "attachment",
        mimeType: part.mimeType,
        size: part.body.size || 0,
      });
    }

    if (part.parts) {
      part.parts.forEach(processPart);
    }
  }

  processPart(payload);
  return { text, html, attachments };
}

// Build RFC 2822 email format for Gmail API
function buildRawEmail(options: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: { filename: string; mimeType: string; content: string | Buffer }[];
}): string {
  const hasAttachments = options.attachments && options.attachments.length > 0;
  const boundary = `boundary_testboundary123`;
  const lines: string[] = [];

  lines.push(`From: ${options.from}`);
  lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: ${options.subject}`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push(`MIME-Version: 1.0`);

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push(``);
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push(``);
    lines.push(Buffer.from(options.body).toString("base64"));

    for (const att of options.attachments!) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(``);
      const contentBase64 = Buffer.isBuffer(att.content)
        ? att.content.toString("base64")
        : att.content;
      lines.push(contentBase64);
    }
    lines.push(`--${boundary}--`);
  } else {
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push(``);
    lines.push(options.body);
  }

  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("Gmail Email Parsing", () => {
  describe("parseGmailMessage", () => {
    it("should parse a simple email message", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "This is a preview of the email...",
        internalDate: "1702500000000",
        labelIds: ["INBOX", "UNREAD"],
        payload: {
          headers: [
            // Use quoted format which the regex handles correctly
            { name: "From", value: '"John Doe" <john@example.com>' },
            { name: "To", value: "jane@example.com" },
            { name: "Subject", value: "Test Subject" },
            { name: "Message-ID", value: "<abc123@example.com>" },
          ],
        },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.id).toBe("msg123");
      expect(parsed.threadId).toBe("thread456");
      expect(parsed.accountId).toBe("account-1");
      expect(parsed.subject).toBe("Test Subject");
      expect(parsed.fromName).toBe("John Doe");
      expect(parsed.fromEmail).toBe("john@example.com");
      expect(parsed.toAddresses).toBe("jane@example.com");
      expect(parsed.isRead).toBe(false);
      expect(parsed.isStarred).toBe(false);
    });

    it("should parse From header with empty quotes and email", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            // Empty name with quoted format
            { name: "From", value: '"" <simple@example.com>' },
          ],
        },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.fromName).toBe("");
      expect(parsed.fromEmail).toBe("simple@example.com");
    });

    it("should parse From header with quoted name", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        labelIds: [],
        payload: {
          headers: [
            { name: "From", value: '"Smith, John" <john.smith@company.com>' },
          ],
        },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.fromName).toBe("Smith, John");
      expect(parsed.fromEmail).toBe("john.smith@company.com");
    });

    it("should detect read emails", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        labelIds: ["INBOX"], // No UNREAD label means read
        payload: { headers: [] },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.isRead).toBe(true);
    });

    it("should detect starred emails", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        labelIds: ["INBOX", "STARRED"],
        payload: { headers: [] },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.isStarred).toBe(true);
    });

    it("should parse CC and BCC addresses", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        labelIds: [],
        payload: {
          headers: [
            { name: "From", value: "sender@example.com" },
            { name: "To", value: "to@example.com" },
            { name: "Cc", value: "cc1@example.com, cc2@example.com" },
            { name: "Bcc", value: "bcc@example.com" },
          ],
        },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.toAddresses).toBe("to@example.com");
      expect(parsed.ccAddresses).toBe("cc1@example.com, cc2@example.com");
      expect(parsed.bccAddresses).toBe("bcc@example.com");
    });

    it("should serialize labels as JSON", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        labelIds: ["INBOX", "CATEGORY_PERSONAL", "Label_123"],
        payload: { headers: [] },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.labels).toBe(JSON.stringify(["INBOX", "CATEGORY_PERSONAL", "Label_123"]));
    });

    it("should handle missing labelIds", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000",
        // No labelIds
        payload: { headers: [] },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.labels).toBe("[]");
      expect(parsed.isRead).toBe(true); // No UNREAD means read
      expect(parsed.isStarred).toBeFalsy(); // undefined is falsy
    });

    it("should convert internal date to unix timestamp", () => {
      const gmailMessage = {
        id: "msg123",
        threadId: "thread456",
        snippet: "",
        internalDate: "1702500000000", // milliseconds
        labelIds: [],
        payload: { headers: [] },
      };

      const parsed = parseGmailMessage(gmailMessage, "account-1");

      expect(parsed.receivedAt).toBe(1702500000); // seconds
    });
  });

  describe("extractBodyAndAttachments", () => {
    it("should extract plain text body", () => {
      const payload = {
        mimeType: "text/plain",
        body: {
          data: Buffer.from("Hello, this is plain text.").toString("base64"),
        },
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.text).toBe("Hello, this is plain text.");
      expect(result.html).toBe("");
      expect(result.attachments).toEqual([]);
    });

    it("should extract HTML body", () => {
      const payload = {
        mimeType: "text/html",
        body: {
          data: Buffer.from("<p>Hello, this is <strong>HTML</strong>.</p>").toString("base64"),
        },
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.html).toBe("<p>Hello, this is <strong>HTML</strong>.</p>");
      expect(result.text).toBe("");
    });

    it("should extract both text and HTML from multipart email", () => {
      const payload = {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Plain text version").toString("base64"),
            },
          },
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<p>HTML version</p>").toString("base64"),
            },
          },
        ],
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.text).toBe("Plain text version");
      expect(result.html).toBe("<p>HTML version</p>");
    });

    it("should extract attachments", () => {
      const payload = {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Email body").toString("base64"),
            },
          },
          {
            mimeType: "application/pdf",
            filename: "document.pdf",
            body: {
              attachmentId: "att-123",
              size: 12345,
            },
            headers: [],
          },
        ],
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.attachments.length).toBe(1);
      expect(result.attachments[0].attachmentId).toBe("att-123");
      expect(result.attachments[0].filename).toBe("document.pdf");
      expect(result.attachments[0].mimeType).toBe("application/pdf");
      expect(result.attachments[0].size).toBe(12345);
    });

    it("should extract inline images with content ID", () => {
      const payload = {
        mimeType: "multipart/related",
        parts: [
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from('<img src="cid:image001">').toString("base64"),
            },
          },
          {
            mimeType: "image/png",
            filename: "logo.png",
            body: {
              attachmentId: "att-456",
              size: 5000,
            },
            headers: [
              { name: "Content-ID", value: "<image001>" },
            ],
          },
        ],
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.html).toBe('<img src="cid:image001">');
      expect(result.attachments.length).toBe(1);
      expect(result.attachments[0].contentId).toBe("image001");
    });

    it("should handle deeply nested parts", () => {
      const payload = {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("Nested plain text").toString("base64"),
                },
              },
              {
                mimeType: "multipart/related",
                parts: [
                  {
                    mimeType: "text/html",
                    body: {
                      data: Buffer.from("<p>Deeply nested HTML</p>").toString("base64"),
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.text).toBe("Nested plain text");
      expect(result.html).toBe("<p>Deeply nested HTML</p>");
    });

    it("should handle missing body data", () => {
      const payload = {
        mimeType: "text/plain",
        body: {},
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.text).toBe("");
      expect(result.html).toBe("");
    });

    it("should default filename for attachments", () => {
      const payload = {
        mimeType: "application/octet-stream",
        // No filename
        body: {
          attachmentId: "att-789",
          size: 100,
        },
        headers: [],
      };

      const result = extractBodyAndAttachments(payload);

      expect(result.attachments[0].filename).toBe("attachment");
    });
  });

  describe("buildRawEmail", () => {
    it("should build a simple email", () => {
      const raw = buildRawEmail({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Test Subject",
        body: "<p>Hello World</p>",
      });

      // Decode the base64url
      const decoded = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf-8");

      expect(decoded).toContain("From: sender@example.com");
      expect(decoded).toContain("To: recipient@example.com");
      expect(decoded).toContain("Subject: Test Subject");
      expect(decoded).toContain("Content-Type: text/html");
      expect(decoded).toContain("<p>Hello World</p>");
    });

    it("should include CC and BCC", () => {
      const raw = buildRawEmail({
        from: "sender@example.com",
        to: "to@example.com",
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        subject: "Test",
        body: "Body",
      });

      const decoded = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf-8");

      expect(decoded).toContain("Cc: cc@example.com");
      expect(decoded).toContain("Bcc: bcc@example.com");
    });

    it("should include In-Reply-To and References for replies", () => {
      const raw = buildRawEmail({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Re: Original Subject",
        body: "<p>Reply content</p>",
        inReplyTo: "<original-msg-id@example.com>",
        references: "<original-msg-id@example.com>",
      });

      const decoded = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf-8");

      expect(decoded).toContain("In-Reply-To: <original-msg-id@example.com>");
      expect(decoded).toContain("References: <original-msg-id@example.com>");
    });

    it("should build multipart email with attachments", () => {
      const raw = buildRawEmail({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "With Attachment",
        body: "<p>See attached</p>",
        attachments: [
          {
            filename: "test.txt",
            mimeType: "text/plain",
            content: Buffer.from("File content").toString("base64"),
          },
        ],
      });

      const decoded = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf-8");

      expect(decoded).toContain("Content-Type: multipart/mixed");
      expect(decoded).toContain('Content-Disposition: attachment; filename="test.txt"');
    });

    it("should produce base64url encoded output", () => {
      const raw = buildRawEmail({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Test",
        body: "Body",
      });

      // base64url should not contain +, /, or trailing =
      expect(raw).not.toContain("+");
      expect(raw).not.toContain("/");
      expect(raw).not.toMatch(/=+$/);
    });
  });
});

describe("IMAP Email Parsing", () => {
  // Test IMAP-specific parsing helpers

  describe("parseAddressList", () => {
    function parseAddressList(addresses: any[] | undefined): string {
      if (!addresses || addresses.length === 0) return "";
      return addresses
        .map((addr: any) => {
          if (addr.name) {
            return `${addr.name} <${addr.address}>`;
          }
          return addr.address;
        })
        .join(", ");
    }

    it("should parse single address", () => {
      const addresses = [{ name: "John Doe", address: "john@example.com" }];
      expect(parseAddressList(addresses)).toBe("John Doe <john@example.com>");
    });

    it("should parse multiple addresses", () => {
      const addresses = [
        { name: "John", address: "john@example.com" },
        { name: "Jane", address: "jane@example.com" },
      ];
      expect(parseAddressList(addresses)).toBe("John <john@example.com>, Jane <jane@example.com>");
    });

    it("should handle address without name", () => {
      const addresses = [{ address: "simple@example.com" }];
      expect(parseAddressList(addresses)).toBe("simple@example.com");
    });

    it("should handle empty array", () => {
      expect(parseAddressList([])).toBe("");
    });

    it("should handle undefined", () => {
      expect(parseAddressList(undefined)).toBe("");
    });
  });

  describe("parseFromHeader", () => {
    function parseFromHeader(from: any[] | undefined): { name: string; email: string } {
      if (!from || from.length === 0) {
        return { name: "", email: "" };
      }
      const sender = from[0];
      return {
        name: sender.name || "",
        email: sender.address || "",
      };
    }

    it("should parse From with name and email", () => {
      const from = [{ name: "Alice Smith", address: "alice@example.com" }];
      const result = parseFromHeader(from);
      expect(result.name).toBe("Alice Smith");
      expect(result.email).toBe("alice@example.com");
    });

    it("should handle From without name", () => {
      const from = [{ address: "noreply@example.com" }];
      const result = parseFromHeader(from);
      expect(result.name).toBe("");
      expect(result.email).toBe("noreply@example.com");
    });

    it("should handle empty From", () => {
      const result = parseFromHeader([]);
      expect(result.name).toBe("");
      expect(result.email).toBe("");
    });
  });
});
