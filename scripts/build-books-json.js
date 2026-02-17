import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.join(process.cwd(), 'hebrew_books.csv');
const OUT_PATH = path.join(process.cwd(), 'docs', 'books.json');

if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found at', CSV_PATH);
  process.exit(1);
}

const raw = fs.readFileSync(CSV_PATH, 'utf8');
const records = parse(raw, {
  columns: true,
  bom: true,
  relax_quotes: true,
  relax_column_count: true,
  skip_empty_lines: true
});

const items = records.map((row) => {
  const id = String(row['ID Book'] ?? row['ID'] ?? row['id'] ?? '').trim();
  if (!id) return null;
  return {
    id,
    title: String(row['Title'] ?? '').trim(),
    author: String(row['Author'] ?? '').trim(),
    printingPlace: String(row['Printing Place'] ?? '').trim(),
    printingYear: String(row['Printing Year'] ?? '').trim(),
    pages: String(row['Pages'] ?? '').trim(),
    tags: String(row['Tags'] ?? '').trim()
  };
}).filter(Boolean);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(items, null, 2), 'utf8');
console.log('Wrote', items.length, 'items to', OUT_PATH);
