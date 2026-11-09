import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.mjs';

test('model Markdown renders headings, lists and tables and keeps fenced code readable', () => {
  const source = [
    '````markdown', '## Study design', '', '1. **Choose controls**', '   - Randomise pots.', '',
    '| Group | Water |', '| --- | --- |', '| A | Reduced |', '', '```text', 'pot A', '```', '````'
  ].join('\n');
  const html = renderMarkdown(source);
  for (const pattern of [/<h2>Study design<\/h2>/, /<ol>/, /<ul>/, /<strong>Choose controls<\/strong>/, /<table>/, /<pre><code[^>]*>pot A/]) {
    assert.match(html, pattern);
  }
});

test('untrusted response Markdown cannot render active HTML or remote images', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n![tracking](https://example.com/image.png)\n\n[bad](javascript:alert(1))\n\n[safe](https://example.com)');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/example.com\/?" target="_blank" rel="noopener noreferrer">/);
});
