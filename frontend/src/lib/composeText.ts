// The compose editor is a plain-text textarea; these convert to and from the HTML we send.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert an HTML fragment to readable plain text (for quoting and signatures). */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prefix every line with "> " for a plain-text reply quote. */
export function quoteText(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith(">") ? `>${line}` : `> ${line}`))
    .join("\n");
}

/** Render the plain-text body as HTML; runs of "> " lines become (nested) blockquotes. */
export function plainTextToHtml(text: string): string {
  const quoteStyle = "border-left: 2px solid #ccc; padding-left: 12px; margin: 0 0 0 4px; color: #666;";
  const render = (lines: string[]): string => {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].startsWith(">")) {
        const quoted: string[] = [];
        while (i < lines.length && lines[i].startsWith(">")) {
          quoted.push(lines[i].replace(/^> ?/, ""));
          i++;
        }
        out.push(`<blockquote style="${quoteStyle}">${render(quoted)}</blockquote>`);
      } else {
        out.push(escapeHtml(lines[i]) + (i < lines.length - 1 && !lines[i + 1].startsWith(">") ? "<br>" : ""));
        i++;
      }
    }
    return out.join("");
  };
  return `<div>${render(text.split("\n"))}</div>`;
}
