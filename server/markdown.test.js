import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../public/js/markdown.js';

const text = (v) => ({ t: 'text', v });

test('markdown inline: grassetto, corsivo, codice, barrato', () => {
  assert.deepEqual(parseInline('a **b** c'), [
    text('a '),
    { t: 'strong', c: [text('b')] },
    text(' c'),
  ]);
  assert.deepEqual(parseInline('*x* e _y_'), [
    { t: 'em', c: [text('x')] },
    text(' e '),
    { t: 'em', c: [text('y')] },
  ]);
  assert.deepEqual(parseInline('usa `npm test` ora'), [
    text('usa '),
    { t: 'code', v: 'npm test' },
    text(' ora'),
  ]);
  assert.deepEqual(parseInline('~~no~~'), [{ t: 'del', c: [text('no')] }]);
  // dentro al codice il resto non si interpreta; un underscore dentro una parola no
  assert.deepEqual(parseInline('`**x**`'), [{ t: 'code', v: '**x**' }]);
  assert.deepEqual(parseInline('snake_case_name'), [text('snake_case_name')]);
  assert.deepEqual(parseInline('**a *b* c**')[0].c.length, 3);
});

test('markdown: i link solo http(s); niente javascript:', () => {
  assert.deepEqual(parseInline('[sito](https://example.com/a?b=1)'), [
    { t: 'link', href: 'https://example.com/a?b=1', c: [text('sito')] },
  ]);
  assert.deepEqual(parseInline('vai su https://example.com/x, grazie'), [
    text('vai su '),
    { t: 'link', href: 'https://example.com/x', c: [text('https://example.com/x')] },
    text(', grazie'),
  ]);
  for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,<b>)', '[x](//evil.it)']) {
    assert.ok(!parseInline(bad).some((n) => n.t === 'link'), bad);
  }
});

test('markdown blocchi: titoli, elenchi, citazioni, codice, righe orizzontali', () => {
  const blocks = parseMarkdown(
    [
      '# Titolo',
      '',
      'riga 1',
      'riga 2',
      '',
      '- uno',
      '- due',
      '',
      '1. a',
      '2) b',
      '',
      '> cit',
      '> ata',
      '',
      '---',
      '',
      '```',
      '**non** md',
      '```',
    ].join('\n'),
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['heading', 'paragraph', 'list', 'list', 'quote', 'hr', 'code'],
  );
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].inline[0].v, 'riga 1\nriga 2');
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[4].inline[0].v, 'cit\nata');
  assert.equal(blocks[6].text, '**non** md');
});

test('markdown: input strani non rompono nulla', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
  assert.equal(parseMarkdown('```\nmai chiuso')[0].text, 'mai chiuso');
  assert.equal(parseMarkdown('#### troppo profondo')[0].type, 'paragraph');
  assert.equal(
    parseMarkdown('<script>alert(1)</script>')[0].inline[0].v,
    '<script>alert(1)</script>',
  );
  assert.equal(parseMarkdown('a\r\nb')[0].inline[0].v, 'a\nb');
});
