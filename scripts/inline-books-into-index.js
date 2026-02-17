import fs from 'node:fs';
import path from 'node:path';

const BOOKS_JSON = path.join(process.cwd(), 'docs', 'books.json');
const INDEX_HTML = path.join(process.cwd(), 'docs', 'index.html');

if (!fs.existsSync(BOOKS_JSON)) {
  console.error('books.json not found at', BOOKS_JSON);
  process.exit(1);
}
if (!fs.existsSync(INDEX_HTML)) {
  console.error('index.html not found at', INDEX_HTML);
  process.exit(1);
}

console.log('Reading', BOOKS_JSON);
const raw = fs.readFileSync(BOOKS_JSON, 'utf8');

console.log('Reading', INDEX_HTML);
let html = fs.readFileSync(INDEX_HTML, 'utf8');

const marker = '<script type="module" src="app.js"></script>';
if (!html.includes(marker)) {
  console.error('Could not find app.js script marker in index.html');
  process.exit(1);
}

const injection = `\n    <script>window.__BOOKS = ${raw};</script>\n`;
html = html.replace(marker, injection + '    ' + marker);

fs.writeFileSync(INDEX_HTML, html, 'utf8');
console.log('Injected books into', INDEX_HTML);
