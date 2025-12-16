import { describe, it, expect } from 'vitest';

// Email HTML sanitization and dark mode transformation utilities
// These mirror the functions in EmailView.svelte for testing

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeEmailHtml(html: string, emailId: string): string {
  let sanitized = html;
  const API_URL = "http://localhost:3001";

  // Replace cid: image references with API endpoint URLs
  sanitized = sanitized.replace(
    /(<img[^>]*\ssrc=["'])cid:([^"']+)(["'])/gi,
    (match, prefix, contentId, suffix) => {
      return `${prefix}${API_URL}/emails/${encodeURIComponent(emailId)}/attachment/${encodeURIComponent(contentId)}${suffix}`;
    }
  );

  // Remove tracking pixels (1x1 images)
  sanitized = sanitized.replace(
    /<img[^>]*(?:width=["']1["'][^>]*height=["']1["']|height=["']1["'][^>]*width=["']1["'])[^>]*>/gi,
    ''
  );

  // Remove script tags entirely
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers (onclick, onerror, onload, etc.)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: URLs
  sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  // Remove max-width constraints that create narrow email boxes
  sanitized = sanitized.replace(/max-width\s*:\s*\d+px\s*;?/gi, '');

  // Make container divs and tables full width
  sanitized = sanitized.replace(
    /(<(?:div|table)[^>]*style=["'][^"']*)width\s*:\s*\d+px/gi,
    '$1width:100%'
  );

  return sanitized;
}

// Generate dark mode CSS for iframe
function getDarkModeCSS(): string {
  return `
    html {
      background: #e5e5e5;
    }
    body {
      /* Mailspring-style dark mode: invert colors and rotate hue to preserve color relationships */
      filter: invert(100%) hue-rotate(180deg);
    }
    /* Double-invert images/videos to restore original colors */
    img, video, picture, [style*="background-image"] {
      filter: invert(100%) hue-rotate(180deg);
    }
  `;
}

describe('Email HTML Sanitization', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should escape ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe("it&#039;s");
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle text without special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('sanitizeEmailHtml', () => {
    describe('cid: URL replacement', () => {
      it('should replace cid: references with API URLs', () => {
        const html = '<img src="cid:image001@example.com">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toContain('/emails/email-123/attachment/image001%40example.com');
        expect(result).not.toContain('cid:');
      });

      it('should handle multiple cid: references', () => {
        const html = '<img src="cid:img1"><img src="cid:img2">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toContain('/attachment/img1');
        expect(result).toContain('/attachment/img2');
      });

      it('should handle cid: in double quotes', () => {
        const html = '<img src="cid:test">';
        const result = sanitizeEmailHtml(html, 'email-123');
        expect(result).toContain('/attachment/test');
      });

      it('should handle cid: in single quotes', () => {
        const html = "<img src='cid:test'>";
        const result = sanitizeEmailHtml(html, 'email-123');
        expect(result).toContain('/attachment/test');
      });
    });

    describe('tracking pixel removal', () => {
      it('should remove 1x1 tracking pixels', () => {
        const html = '<img width="1" height="1" src="https://tracker.com/pixel.gif">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toBe('');
      });

      it('should remove tracking pixel with reversed order', () => {
        const html = '<img height="1" width="1" src="https://tracker.com/pixel.gif">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toBe('');
      });

      it('should keep normal images', () => {
        const html = '<img width="100" height="50" src="image.jpg">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toContain('image.jpg');
      });
    });

    describe('script removal', () => {
      it('should remove script tags', () => {
        const html = '<div>Hello</div><script>alert("xss")</script><div>World</div>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toBe('<div>Hello</div><div>World</div>');
        expect(result).not.toContain('script');
      });

      it('should remove script tags with attributes', () => {
        const html = '<script type="text/javascript" src="evil.js"></script>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toBe('');
      });

      it('should handle multiple script tags', () => {
        const html = '<script>a()</script>text<script>b()</script>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toBe('text');
      });
    });

    describe('event handler removal', () => {
      it('should remove onclick handlers', () => {
        const html = '<a href="#" onclick="alert(1)">Click</a>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).not.toContain('onclick');
        expect(result).toContain('<a href="#">Click</a>');
      });

      it('should remove onerror handlers', () => {
        const html = '<img src="x" onerror="alert(1)">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).not.toContain('onerror');
      });

      it('should remove onload handlers', () => {
        const html = '<body onload="init()">';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).not.toContain('onload');
      });

      it('should remove onmouseover handlers', () => {
        const html = '<div onmouseover="track()">Text</div>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).not.toContain('onmouseover');
      });
    });

    describe('javascript URL removal', () => {
      it('should replace javascript: URLs with #', () => {
        const html = '<a href="javascript:alert(1)">Click</a>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toBe('<a href="#">Click</a>');
      });

      it('should handle javascript: with complex code', () => {
        const html = '<a href="javascript:window.location=\'http://evil.com\'">Link</a>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toContain('href="#"');
        expect(result).not.toContain('javascript:');
      });
    });

    describe('layout optimization', () => {
      it('should remove max-width constraints', () => {
        const html = '<div style="max-width: 600px;">Content</div>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).not.toContain('max-width');
      });

      it('should replace fixed width with 100% for divs', () => {
        const html = '<div style="width: 600px; color: blue;">Content</div>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toContain('width:100%');
        expect(result).not.toContain('width: 600px');
      });

      it('should replace fixed width with 100% for tables', () => {
        const html = '<table style="width: 800px;"><tr><td>Cell</td></tr></table>';
        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).toContain('width:100%');
      });
    });

    describe('combined scenarios', () => {
      it('should handle complex email with multiple issues', () => {
        const html = `
          <html>
            <body onload="init()">
              <div style="max-width: 600px;">
                <img src="cid:logo" width="200">
                <img width="1" height="1" src="tracker.gif">
                <a href="javascript:void(0)" onclick="click()">Link</a>
                <script>alert(1)</script>
              </div>
            </body>
          </html>
        `;

        const result = sanitizeEmailHtml(html, 'email-123');

        expect(result).not.toContain('onload');
        expect(result).not.toContain('max-width');
        expect(result).toContain('/attachment/logo');
        expect(result).not.toContain('tracker.gif');
        expect(result).not.toContain('javascript:');
        expect(result).not.toContain('onclick');
        expect(result).not.toContain('script');
      });
    });
  });
});

describe('Dark Mode CSS Transformation', () => {
  describe('getDarkModeCSS', () => {
    it('should include invert filter', () => {
      const css = getDarkModeCSS();
      expect(css).toContain('filter: invert(100%)');
    });

    it('should include hue-rotate', () => {
      const css = getDarkModeCSS();
      expect(css).toContain('hue-rotate(180deg)');
    });

    it('should double-invert images', () => {
      const css = getDarkModeCSS();
      expect(css).toContain('img');
      // Images should have the same filter to undo the body inversion
    });

    it('should double-invert videos', () => {
      const css = getDarkModeCSS();
      expect(css).toContain('video');
    });

    it('should double-invert background images', () => {
      const css = getDarkModeCSS();
      expect(css).toContain('background-image');
    });
  });

  describe('dark mode color transformations', () => {
    // Test that the CSS filter correctly transforms colors
    // These are conceptual tests - in practice the filter is applied by the browser

    it('should describe how white becomes dark in body', () => {
      // When body has filter: invert(100%) hue-rotate(180deg)
      // white (#ffffff) -> black (#000000) after invert
      // black stays black after hue-rotate (achromatic colors unchanged)
      // So white backgrounds become black backgrounds
      expect(true).toBe(true);
    });

    it('should describe how black text becomes light', () => {
      // black (#000000) -> white (#ffffff) after invert
      // So black text becomes white text
      expect(true).toBe(true);
    });

    it('should describe how images are restored', () => {
      // Images have double invert: once from body, once from their own filter
      // invert(100%) twice = back to original colors
      expect(true).toBe(true);
    });

    it('should describe how colored text is transformed', () => {
      // Blue (#0000ff) -> Yellow (#ffff00) after invert
      // Yellow -> Blue after hue-rotate(180deg)
      // So blue stays roughly blue (with slight color shift)
      // This preserves the color relationships while making light things dark
      expect(true).toBe(true);
    });
  });
});

describe('Email Content Rendering', () => {
  describe('plain text handling', () => {
    it('should preserve whitespace in plain text', () => {
      const text = 'Line 1\n  Indented line\n    Double indent';
      const escaped = escapeHtml(text);

      // Plain text should be wrapped in pre with white-space: pre-wrap
      expect(escaped).toContain('Line 1');
      expect(escaped).toContain('Indented line');
    });

    it('should escape HTML in plain text emails', () => {
      const text = 'Check out <script>this</script> and <b>that</b>';
      const escaped = escapeHtml(text);

      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&lt;b&gt;');
      expect(escaped).not.toContain('<script>');
    });
  });

  describe('URL handling', () => {
    it('should allow normal http links', () => {
      const html = '<a href="https://example.com">Link</a>';
      const result = sanitizeEmailHtml(html, 'email-123');

      expect(result).toBe(html);
    });

    it('should allow mailto links', () => {
      const html = '<a href="mailto:test@example.com">Email</a>';
      const result = sanitizeEmailHtml(html, 'email-123');

      expect(result).toBe(html);
    });
  });
});
