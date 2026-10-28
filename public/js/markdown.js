// Markdown minimo e sicuro per le descrizioni. Prima un albero (funzione pura, testabile),
// poi i nodi DOM: il testo dell'utente non diventa mai HTML.

const INLINE =
  /`([^`\n]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*(?!\s)([^*\n]+?)\*|(?<!\w)_(?!\s)([^_\n]+?)_(?!\w)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

export function parseInline(text) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) nodes.push({ t: 'text', v: text.slice(last, m.index) });
    const [, code, strong, del, em, em2, label, href, bare] = m;
    if (code != null) nodes.push({ t: 'code', v: code });
    else if (strong != null) nodes.push({ t: 'strong', c: parseInline(strong) });
    else if (del != null) nodes.push({ t: 'del', c: parseInline(del) });
    else if (em != null || em2 != null) nodes.push({ t: 'em', c: parseInline(em ?? em2) });
    else if (label != null) nodes.push({ t: 'link', href, c: parseInline(label) });
    else nodes.push({ t: 'link', href: bare, c: [{ t: 'text', v: bare }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ t: 'text', v: text.slice(last) });
  return nodes;
}

const FENCE = /^```/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const HR = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const NUMBER = /^\s*\d+[.)]\s+(.+)$/;

export function parseMarkdown(source) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks = [];
  let paragraph = [];
  let i = 0;

  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (FENCE.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++; // la chiusura (se manca, il blocco arriva fino alla fine)
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
    } else if ((m = HEADING.exec(line))) {
      flush();
      blocks.push({ type: 'heading', level: m[1].length, inline: parseInline(m[2]) });
      i++;
    } else if (HR.test(line)) {
      flush();
      blocks.push({ type: 'hr' });
      i++;
    } else if (QUOTE.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) {
        quoted.push(m[1]);
        i++;
      }
      blocks.push({ type: 'quote', inline: parseInline(quoted.join('\n')) });
    } else if (BULLET.test(line) || NUMBER.test(line)) {
      flush();
      const ordered = NUMBER.test(line);
      const pattern = ordered ? NUMBER : BULLET;
      const items = [];
      while (i < lines.length && (m = pattern.exec(lines[i]))) {
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
    } else {
      paragraph.push(line);
      i++;
    }
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// Albero → DOM
// ---------------------------------------------------------------------------

function appendInline(parent, nodes) {
  for (const n of nodes) {
    if (n.t === 'text') {
      // a capo dentro un paragrafo = <br>
      n.v.split('\n').forEach((part, i) => {
        if (i > 0) parent.append(document.createElement('br'));
        if (part) parent.append(part);
      });
    } else if (n.t === 'code') {
      const c = document.createElement('code');
      c.textContent = n.v;
      parent.append(c);
    } else if (n.t === 'link') {
      const a = document.createElement('a');
      a.href = n.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      appendInline(a, n.c);
      parent.append(a);
    } else {
      const tag = { strong: 'strong', em: 'em', del: 'del' }[n.t];
      const node = document.createElement(tag);
      appendInline(node, n.c);
      parent.append(node);
    }
  }
}

export function renderMarkdown(source) {
  const root = document.createElement('div');
  root.className = 'markdown';
  for (const b of parseMarkdown(source)) {
    let node;
    if (b.type === 'heading') {
      // i titoli della descrizione restano più piccoli di quello della finestra
      node = document.createElement(`h${b.level + 3}`);
      appendInline(node, b.inline);
    } else if (b.type === 'paragraph') {
      node = document.createElement('p');
      appendInline(node, b.inline);
    } else if (b.type === 'quote') {
      node = document.createElement('blockquote');
      appendInline(node, b.inline);
    } else if (b.type === 'code') {
      node = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = b.text;
      node.append(code);
    } else if (b.type === 'hr') {
      node = document.createElement('hr');
    } else {
      node = document.createElement(b.ordered ? 'ol' : 'ul');
      for (const item of b.items) {
        const li = document.createElement('li');
        appendInline(li, item);
        node.append(li);
      }
    }
    root.append(node);
  }
  return root;
}

// @username dentro a un testo semplice (commenti): nodi di testo e <span class="mention">
export function renderWithMentions(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(/(?<![\w@])@([A-Za-z0-9_]{3,30})/g)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const span = document.createElement('span');
    span.className = 'mention';
    span.textContent = m[0];
    frag.append(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}
