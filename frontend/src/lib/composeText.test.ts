import { describe, it, expect } from "vitest";
import { htmlToText, quoteText, plainTextToHtml } from "./composeText";

describe("composeText", () => {
  it("converts HTML to plain text", () => {
    expect(htmlToText("<p>Hi&nbsp;there</p><p>a<br>b</p><style>x{}</style>")).toBe("Hi there\na\nb");
  });

  it("quotes lines, nesting existing quotes", () => {
    expect(quoteText("a\n> b")).toBe("> a\n>> b");
  });

  it("renders plain text with escaped HTML and line breaks", () => {
    expect(plainTextToHtml("a <b>\nc")).toBe("<div>a &lt;b&gt;<br>c</div>");
  });

  it("renders quoted lines as nested blockquotes", () => {
    const html = plainTextToHtml("reply\n> one\n>> two");
    expect(html).toMatch(/^<div>reply<blockquote[^>]*>one<blockquote[^>]*>two<\/blockquote><\/blockquote><\/div>$/);
  });
});
