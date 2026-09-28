/**
 * Tiny, safe markdown renderer for docs and descriptions. All input is HTML-escaped first,
 * so only the markup generated here can reach the DOM; link URLs are allow-listed.
 * Task keys like ECOM-12 become links that open the task drawer.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function safeUrl(url: string) {
  const u = url.trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(u) ? u : '#';
}

function inline(text: string) {
  // text is already escaped
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${esc(safeUrl(url.replace(/&amp;/g, '&')))}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/(^|[\s(])([A-Z][A-Z0-9]{1,9}-\d+)\b/g, '$1<a class="md-task" data-task="$2" href="?task=$2">$2</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function renderMarkdown(src: string): string {
  const lines = esc(src.replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushPara();
      closeList();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      closeList();
      out.push('<hr/>');
    } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul class="md-checklist">');
        list = 'ul';
      }
      const done = m[1].toLowerCase() === 'x';
      out.push(`<li class="${done ? 'done' : ''}"><span class="md-check">${done ? '✓' : ''}</span>${inline(m[2])}</li>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}
