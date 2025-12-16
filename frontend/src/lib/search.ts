/**
 * Search highlighting utilities
 *
 * Extracts plain search terms from a query string (excluding operators)
 * and provides functions to highlight matching text.
 */

// Operators that should be excluded from highlighting
const OPERATOR_PATTERNS = [
  /from:\S+/gi,
  /to:\S+/gi,
  /subject:"[^"]+"/gi,
  /subject:\S+/gi,
  /has:attachment/gi,
  /is:unread/gi,
  /is:read/gi,
  /is:starred/gi,
  /before:\d{4}-\d{2}-\d{2}/gi,
  /after:\d{4}-\d{2}-\d{2}/gi,
];

/**
 * Extract plain search terms from a query string, excluding operators.
 * Returns an array of lowercase search terms.
 */
export function extractSearchTerms(query: string): string[] {
  if (!query || query.length < 2) return [];

  let cleanedQuery = query;

  // Remove all operators from the query
  for (const pattern of OPERATOR_PATTERNS) {
    cleanedQuery = cleanedQuery.replace(pattern, "");
  }

  // Split by whitespace and filter out empty strings
  const terms = cleanedQuery
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2); // Only include terms with 2+ chars

  // Remove duplicates
  return [...new Set(terms)];
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a regex pattern that matches any of the search terms (case-insensitive)
 */
export function createSearchRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;

  const escapedTerms = terms.map(escapeRegex);
  return new RegExp(`(${escapedTerms.join("|")})`, "gi");
}

/**
 * Split text into segments for highlighting.
 * Returns an array of objects with { text: string, highlight: boolean }
 */
export function splitTextForHighlight(
  text: string,
  searchTerms: string[]
): Array<{ text: string; highlight: boolean }> {
  if (!text || searchTerms.length === 0) {
    return [{ text, highlight: false }];
  }

  const regex = createSearchRegex(searchTerms);
  if (!regex) {
    return [{ text, highlight: false }];
  }

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add non-matching text before this match
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        highlight: false,
      });
    }

    // Add the matching text
    segments.push({
      text: match[0],
      highlight: true,
    });

    lastIndex = regex.lastIndex;
  }

  // Add remaining non-matching text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      highlight: false,
    });
  }

  return segments.length > 0 ? segments : [{ text, highlight: false }];
}

/**
 * Generate CSS for highlighting in an iframe document.
 * Uses a class-based approach for better performance.
 */
export function getHighlightCSS(): string {
  return `
    .search-highlight {
      background-color: rgba(250, 204, 21, 0.4);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
  `;
}

/**
 * Wrap matching terms in a text node with highlight spans.
 * Returns HTML string with <mark> tags around matches.
 */
export function highlightTextAsHTML(
  text: string,
  searchTerms: string[]
): string {
  if (!text || searchTerms.length === 0) return text;

  const regex = createSearchRegex(searchTerms);
  if (!regex) return text;

  return text.replace(
    regex,
    '<mark class="search-highlight">$1</mark>'
  );
}

/**
 * Highlight text in an HTML document (for iframe content).
 * This walks the DOM tree and wraps matching text nodes with highlight spans.
 * Returns the modified HTML string.
 */
export function highlightHTMLContent(
  html: string,
  searchTerms: string[]
): string {
  if (!html || searchTerms.length === 0) return html;

  const regex = createSearchRegex(searchTerms);
  if (!regex) return html;

  // We need to only highlight text content, not HTML tags or attributes
  // Use a simple approach: split by tags and only process text parts
  const parts: string[] = [];
  let lastIndex = 0;

  // Match HTML tags (including self-closing)
  const tagPattern = /<[^>]+>/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagPattern.exec(html)) !== null) {
    // Process text before this tag
    if (tagMatch.index > lastIndex) {
      const textPart = html.slice(lastIndex, tagMatch.index);
      parts.push(highlightTextAsHTML(textPart, searchTerms));
    }

    // Keep the tag as-is
    parts.push(tagMatch[0]);
    lastIndex = tagPattern.lastIndex;
  }

  // Process remaining text after the last tag
  if (lastIndex < html.length) {
    const textPart = html.slice(lastIndex);
    parts.push(highlightTextAsHTML(textPart, searchTerms));
  }

  return parts.join("");
}
