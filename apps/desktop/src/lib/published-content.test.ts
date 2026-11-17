import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedDoc, publishedNotes, publicLink } from './published-content.ts';

// Seam: sharing a page must not disclose unanchored thoughts, local file paths or private targets.
test('published documents contain visible text and only anchored notes', () => {
  const content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Sentence', marks: [{ type: 'note', attrs: { id: 'n1' } }, { type: 'origin', attrs: { author: 'private' } }] }, { type: 'mention', attrs: { id: 'secret-page' } }] },
    { type: 'image', attrs: { src: 'asset://localhost/private/file.png', origin: 'private', drawing: { url: 'private' } } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bad link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
  ] };
  const thoughts = { type: 'doc', content: ['n1', 'orphan'].map((id) => ({ type: 'thought', attrs: { id }, content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] })) };
  assert.deepEqual(publishedNotes(content, thoughts).map((note) => note.id), ['n1']);
  const result = publishedDoc(content, () => 'Visible title');
  assert.match(JSON.stringify(result), /Visible title/);
  assert.doesNotMatch(JSON.stringify(result), /secret-page|asset:|private|javascript:|origin|drawing/);
  const embed = (src: string) => publishedDoc({ type: 'embed', attrs: { src } });
  assert.equal(embed('https://example.com/form').type, 'paragraph');
  assert.equal(embed('https://www.youtube.com/watch?v=dQw4w9WgXcQ').type, 'embed');
  assert.equal(embed('https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ').type, 'paragraph');
  assert.equal(embed('https://www.youtube.com/redirect?q=https://evil.test').type, 'paragraph');
  assert.equal(embed('https://www.youtube.com/watch?v=dQw4w9WgXcQ').attrs?.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(publicLink({ toString: 'invalid attribute' }), false);
});
