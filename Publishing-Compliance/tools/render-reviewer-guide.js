// Renders REVIEWER_NOTES.md to the PDF attached to App Store Connect →
// App version → App Review Information → Attachment.
//
//   node tools/render-reviewer-guide.js guide.md guide.html
//   chrome --headless --no-pdf-header-footer \
//     --print-to-pdf=<abs>/PriceBack_App_Review_Guide.pdf file://<abs>/guide.html
//
// guide.md is REVIEWER_NOTES.md with two parts stripped: the "copy-paste this
// into" preamble (internal) and the trailing "Short version" section (that one
// already lives in the 4000-char Notes field, so repeating it wastes pages).
//
// A deliberately small Markdown subset — headings, lists, tables, blockquotes,
// inline code/bold/em/links. Enough for this one document; not a general
// converter. Re-run it whenever REVIEWER_NOTES.md changes materially, then
// re-upload: nothing syncs the PDF to its source.

const fs = require('fs');

const src = fs.readFileSync(process.argv[2], 'utf8');
const outPath = process.argv[3];

function inline(s) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

const lines = src.split(/\r?\n/);
const out = [];
let i = 0;
let listStack = []; // 'ul' | 'ol'
let para = [];
let quote = [];

function flushPara() {
  if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
}
function flushQuote() {
  if (quote.length) {
    out.push('<blockquote>' + quote.map(q => '<p>' + inline(q) + '</p>').join('') + '</blockquote>');
    quote = [];
  }
}
function closeLists(toDepth) {
  while (listStack.length > toDepth) out.push('</' + listStack.pop() + '>');
}
function flushAll() { flushPara(); flushQuote(); closeLists(0); }

while (i < lines.length) {
  const raw = lines[i];
  const line = raw.trimEnd();

  if (!line.trim()) { flushPara(); flushQuote(); i++; continue; }

  // horizontal rule
  if (/^---+$/.test(line.trim())) { flushAll(); out.push('<hr>'); i++; continue; }

  // heading
  let h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

  // table
  if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
    flushAll();
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
    let html = '<table><thead><tr>' + cells(line).map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
    i += 2;
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      html += '<tr>' + cells(lines[i]).map(c => `<td>${c}</td>`).join('') + '</tr>';
      i++;
    }
    out.push(html + '</tbody></table>');
    continue;
  }

  // blockquote
  if (/^>\s?/.test(line)) {
    flushPara(); closeLists(0);
    quote.push(line.replace(/^>\s?/, ''));
    i++; continue;
  }

  // list item
  const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
  if (li) {
    flushPara(); flushQuote();
    const depth = Math.floor(li[1].length / 2) + 1;
    const kind = /\d/.test(li[2]) ? 'ol' : 'ul';
    while (listStack.length > depth) out.push('</' + listStack.pop() + '>');
    if (listStack.length < depth) {
      while (listStack.length < depth) { out.push('<' + kind + '>'); listStack.push(kind); }
    } else if (listStack[listStack.length - 1] !== kind) {
      out.push('</' + listStack.pop() + '>');
      out.push('<' + kind + '>'); listStack.push(kind);
    }
    // gather continuation lines
    let text = li[3];
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) &&
           !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1]) && !/^\s*>/.test(lines[i + 1])) {
      text += ' ' + lines[i + 1].trim();
      i++;
    }
    out.push('<li>' + inline(text) + '</li>');
    i++; continue;
  }

  // paragraph text
  if (listStack.length) closeLists(0);
  flushQuote();
  para.push(line.trim());
  i++;
}
flushAll();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PriceBack — App Review Guide</title>
<style>
  @page { size: Letter; margin: 18mm 16mm 16mm; }
  body { font: 10.5pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1c1c1e; }
  h1 { font-size: 20pt; margin: 0 0 2pt; letter-spacing: -0.02em; }
  h2 { font-size: 13pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #d8d8dc;
       page-break-after: avoid; break-after: avoid; }
  h3 { font-size: 11pt; margin: 13pt 0 4pt; page-break-after: avoid; break-after: avoid; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
  li { margin-bottom: 3pt; }
  code { font-family: "SF Mono", Consolas, monospace; font-size: 9pt;
         background: #f2f2f5; padding: 1pt 3pt; border-radius: 3px; }
  a { color: #0b63c5; text-decoration: none; }
  hr { display: none; }
  blockquote { margin: 0 0 8pt; padding: 8pt 12pt; background: #f6f6f8;
               border-left: 3px solid #c8c8cd; border-radius: 0 4px 4px 0; }
  blockquote p:last-child { margin-bottom: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; font-size: 9.5pt;
          page-break-inside: avoid; }
  th, td { border: 1px solid #d8d8dc; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f2f2f5; font-weight: 600; }
  .lede { color: #55555c; font-size: 10pt; margin: 0 0 14pt; }
</style></head><body>
<h1>PriceBack — App Review Guide</h1>
<p class="lede">iOS 2.8.2 &middot; Prosoft Inc &middot; Attachment to App Review Information.
This is the full version of the reviewer notes; the Notes field carries an abridged copy.</p>
${out.join('\n')}
</body></html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('wrote ' + outPath + ' (' + html.length + ' bytes)');
