import { describe, it, expect } from "vitest";
import {
  extractSearchTerms,
  createSearchRegex,
  splitTextForHighlight,
  highlightTextAsHTML,
  highlightHTMLContent,
} from "./search";

describe("extractSearchTerms", () => {
  it("returns empty array for empty query", () => {
    expect(extractSearchTerms("")).toEqual([]);
    expect(extractSearchTerms("a")).toEqual([]);
  });

  it("extracts plain search terms", () => {
    expect(extractSearchTerms("hello world")).toEqual(["hello", "world"]);
  });

  it("filters out short terms", () => {
    expect(extractSearchTerms("a b hello")).toEqual(["hello"]);
  });

  it("removes duplicates", () => {
    expect(extractSearchTerms("hello hello world")).toEqual(["hello", "world"]);
  });

  it("converts terms to lowercase", () => {
    expect(extractSearchTerms("Hello WORLD")).toEqual(["hello", "world"]);
  });

  it("excludes from: operator", () => {
    expect(extractSearchTerms("from:john@example.com hello")).toEqual(["hello"]);
  });

  it("excludes to: operator", () => {
    expect(extractSearchTerms("to:team@company.com hello")).toEqual(["hello"]);
  });

  it("excludes subject: operator with quotes", () => {
    expect(extractSearchTerms('subject:"project update" hello')).toEqual(["hello"]);
  });

  it("excludes subject: operator without quotes", () => {
    expect(extractSearchTerms("subject:meeting hello")).toEqual(["hello"]);
  });

  it("excludes has:attachment operator", () => {
    expect(extractSearchTerms("has:attachment hello")).toEqual(["hello"]);
  });

  it("excludes is: operators", () => {
    expect(extractSearchTerms("is:unread is:starred hello")).toEqual(["hello"]);
  });

  it("excludes date operators", () => {
    expect(extractSearchTerms("before:2024-12-01 after:2024-01-01 hello")).toEqual(["hello"]);
  });

  it("handles mixed operators and terms", () => {
    expect(extractSearchTerms("from:john@example.com project status update is:unread")).toEqual([
      "project",
      "status",
      "update",
    ]);
  });
});

describe("createSearchRegex", () => {
  it("returns null for empty terms", () => {
    expect(createSearchRegex([])).toBeNull();
  });

  it("creates case-insensitive regex", () => {
    const regex = createSearchRegex(["hello"]);
    expect(regex?.flags).toContain("i");
    expect("Hello").toMatch(regex!);
    expect("HELLO").toMatch(regex!);
  });

  it("matches any of multiple terms", () => {
    const regex = createSearchRegex(["hello", "world"]);
    expect("hello").toMatch(regex!);
    expect("world").toMatch(regex!);
    expect("foo").not.toMatch(regex!);
  });

  it("escapes special regex characters", () => {
    const regex = createSearchRegex(["hello+world", "test.com"]);
    expect("hello+world").toMatch(regex!);
    expect("test.com").toMatch(regex!);
  });
});

describe("splitTextForHighlight", () => {
  it("returns single non-highlighted segment for empty terms", () => {
    expect(splitTextForHighlight("hello", [])).toEqual([
      { text: "hello", highlight: false },
    ]);
  });

  it("returns single non-highlighted segment for no matches", () => {
    expect(splitTextForHighlight("hello world", ["foo"])).toEqual([
      { text: "hello world", highlight: false },
    ]);
  });

  it("highlights matching term", () => {
    expect(splitTextForHighlight("hello world", ["hello"])).toEqual([
      { text: "hello", highlight: true },
      { text: " world", highlight: false },
    ]);
  });

  it("highlights multiple occurrences", () => {
    expect(splitTextForHighlight("hello hello", ["hello"])).toEqual([
      { text: "hello", highlight: true },
      { text: " ", highlight: false },
      { text: "hello", highlight: true },
    ]);
  });

  it("highlights multiple different terms", () => {
    expect(splitTextForHighlight("hello world foo", ["hello", "foo"])).toEqual([
      { text: "hello", highlight: true },
      { text: " world ", highlight: false },
      { text: "foo", highlight: true },
    ]);
  });

  it("handles case-insensitive matching", () => {
    expect(splitTextForHighlight("Hello WORLD", ["hello", "world"])).toEqual([
      { text: "Hello", highlight: true },
      { text: " ", highlight: false },
      { text: "WORLD", highlight: true },
    ]);
  });
});

describe("highlightTextAsHTML", () => {
  it("returns original text for empty terms", () => {
    expect(highlightTextAsHTML("hello", [])).toBe("hello");
  });

  it("wraps matches in mark tags", () => {
    expect(highlightTextAsHTML("hello world", ["hello"])).toBe(
      '<mark class="search-highlight">hello</mark> world'
    );
  });

  it("handles multiple matches", () => {
    expect(highlightTextAsHTML("hello hello", ["hello"])).toBe(
      '<mark class="search-highlight">hello</mark> <mark class="search-highlight">hello</mark>'
    );
  });
});

describe("highlightHTMLContent", () => {
  it("returns original HTML for empty terms", () => {
    const html = "<p>hello world</p>";
    expect(highlightHTMLContent(html, [])).toBe(html);
  });

  it("highlights text inside tags", () => {
    const html = "<p>hello world</p>";
    expect(highlightHTMLContent(html, ["hello"])).toBe(
      '<p><mark class="search-highlight">hello</mark> world</p>'
    );
  });

  it("does not modify tag attributes", () => {
    const html = '<a href="hello.com">hello</a>';
    expect(highlightHTMLContent(html, ["hello"])).toBe(
      '<a href="hello.com"><mark class="search-highlight">hello</mark></a>'
    );
  });

  it("handles nested tags", () => {
    const html = "<div><span>hello</span> world</div>";
    expect(highlightHTMLContent(html, ["hello", "world"])).toBe(
      '<div><span><mark class="search-highlight">hello</mark></span> <mark class="search-highlight">world</mark></div>'
    );
  });

  it("handles self-closing tags", () => {
    const html = "hello<br/>world";
    expect(highlightHTMLContent(html, ["hello", "world"])).toBe(
      '<mark class="search-highlight">hello</mark><br/><mark class="search-highlight">world</mark>'
    );
  });
});
