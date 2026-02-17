import fs from 'node:fs';
import path from 'node:path';

const JSON_PATH = path.join(process.cwd(), 'docs', 'books.json');
const OUT_PATH = path.join(process.cwd(), 'docs', 'books.js');

if (!fs.existsSync(JSON_PATH)) {
  console.error('Source JSON not found at', JSON_PATH);
  process.exit(1);
}

const raw = fs.readFileSync(JSON_PATH, 'utf8');
// Wrap into a JS file that assigns to window.__BOOKS
const out = `window.__BOOKS = ${raw};`;
fs.writeFileSync(OUT_PATH, out, 'utf8');
console.log('Wrote', OUT_PATH);
