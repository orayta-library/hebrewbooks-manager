import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 5177;
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, 'hebrew_books.csv');
const HEBREWBOOKS_BASE = 'https://download.hebrewbooks.org/downloadhandler.ashx';

const SORT_KEYS = new Set(['id', 'title', 'author', 'printingPlace', 'printingYear', 'pages']);
const collator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });

function sanitizeFilename(name) {
  const trimmed = String(name || '').trim();
  const withoutIllegal = trimmed.replace(/[\\/\n\r\t\0\f\v:*?"<>|]+/g, ' ');
  const withoutMultipleSpaces = withoutIllegal.replace(/\s+/g, ' ').trim();
  return withoutMultipleSpaces || 'book';
}

function buildContentDisposition(filename) {
  const safe = sanitizeFilename(filename);
  const encoded = encodeURIComponent(safe);
  return `attachment; filename*=UTF-8''${encoded}`;
}

async function loadBooksFromCsv(csvPath) {
  return await new Promise((resolve, reject) => {
    const books = [];
    fs.createReadStream(csvPath)
      .pipe(
        parse({
          columns: true,
          bom: true,
          relax_quotes: true,
          relax_column_count: true,
          skip_empty_lines: true
        })
      )
      .on('data', (row) => {
        const id = String(row['ID Book'] ?? row['ID'] ?? row['id'] ?? '').trim();
        if (!id) return;

        const title = String(row['Title'] ?? '').trim();
        const author = String(row['Author'] ?? '').trim();
        const printingPlace = String(row['Printing Place'] ?? '').trim();
        const printingYear = String(row['Printing Year'] ?? '').trim();
        const pages = String(row['Pages'] ?? '').trim();
        const tags = String(row['Tags'] ?? '').trim();

        books.push({
          id,
          title,
          author,
          printingPlace,
          printingYear,
          pages,
          tags
        });
      })
      .on('error', reject)
      .on('end', () => resolve(books));
  });
}

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

let books = [];
let booksById = new Map();

async function refreshBooks() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at: ${CSV_PATH}`);
  }
  const loaded = await loadBooksFromCsv(CSV_PATH);
  books = loaded;
  booksById = new Map(loaded.map((b) => [b.id, b]));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, count: books.length });
});

app.get('/api/export/:ids', (req, res) => {
  try {
    const ids = req.params.ids.split(',').map(id => id.trim()).filter(Boolean);
    const selectedBooks = ids.map(id => {
      const book = booksById.get(id);
      return book ? {
        id: book.id,
        title: book.title,
        author: book.author,
        printingPlace: book.printingPlace,
        printingYear: book.printingYear,
        pages: book.pages,
        tags: book.tags
      } : null;
    }).filter(Boolean);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="hebrewbooks-selection-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(selectedBooks);
  } catch (error) {
    res.status(500).json({ error: 'Export failed', message: error.message });
  }
});

app.get('/api/books', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const sortKeyRaw = String(req.query.sortKey || '').trim();
    const sortDirRaw = String(req.query.sortDir || '').trim().toLowerCase();
    const sortKey = SORT_KEYS.has(sortKeyRaw) ? sortKeyRaw : '';
    const sortDir = sortDirRaw === 'desc' ? 'desc' : 'asc';

    let filtered = books;
    if (q) {
      filtered = books.filter((b) => {
        return (
          (b.title && b.title.toLowerCase().includes(q)) ||
          (b.author && b.author.toLowerCase().includes(q)) ||
          (b.id && b.id.toLowerCase().includes(q)) ||
          (b.tags && b.tags.toLowerCase().includes(q))
        );
      });
    }

    if (sortKey) {
      filtered = [...filtered].sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        const cmp = collator.compare(String(av), String(bv));
        return sortDir === 'desc' ? -cmp : cmp;
      });
    }

    const total = filtered.length;
    const slice = filtered.slice(offset, offset + limit);

    res.json({
      total,
      offset,
      limit,
      items: slice
    });
  } catch (err) {
    console.error('Error in /api/books:', err);
    res.status(500).json({ error: 'Internal server error', message: 'לא ניתן לטעון את רשימת הספרים' });
  }
});

app.get('/api/books/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const book = booksById.get(id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

app.get('/download/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const book = booksById.get(id);

  const url = new URL(HEBREWBOOKS_BASE);
  url.searchParams.set('req', id);

  const title = book?.title || `hebrewbooks_${id}`;
  const filenameBase = sanitizeFilename(title);
  const filename = `${filenameBase}.pdf`;

  const upstreamReq = https.get(
    url,
    {
      headers: {
        'User-Agent': 'hebrewbooks-manager/1.0'
      }
    },
    (upstreamRes) => {
      const statusCode = upstreamRes.statusCode || 502;
      if (statusCode >= 300 && statusCode < 400 && upstreamRes.headers.location) {
        res.redirect(upstreamRes.headers.location);
        upstreamRes.resume();
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        const reason = statusCode === 404 ? 'הספר לא נמצא ב־HebrewBooks' :
                     statusCode === 403 ? 'הגישה לספר נחסמה' :
                     statusCode === 500 ? 'שגיאת שרת זמנית ב־HebrewBooks' :
                     `שגיאה מ־HebrewBooks (${statusCode})`;
        res.status(502).send(`לא ניתן להוריד את הספר ${id}: ${reason}`);
        upstreamRes.resume();
        return;
      }

      res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'application/octet-stream');
      res.setHeader('Content-Disposition', buildContentDisposition(filename));

      if (upstreamRes.headers['content-length']) {
        res.setHeader('Content-Length', upstreamRes.headers['content-length']);
      }

      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', () => {
    res.status(502).send(`לא ניתן להוריד את הספר ${id}: שגית תקשורת עם HebrewBooks`);
  });
});

function uniqueFilename(baseName, used) {
  let name = baseName;
  let i = 2;
  while (used.has(name)) {
    name = baseName.replace(/\.pdf$/i, '');
    name = `${name} (${i}).pdf`;
    i += 1;
  }
  used.add(name);
  return name;
}

app.post('/download-zip', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'No ids provided' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', buildContentDisposition('hebrwbooksdownload.zip'));

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', () => {});
  archive.on('error', () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });

  archive.pipe(res);

  const usedNames = new Set();

  for (const id of ids) {
    const book = booksById.get(id);
    const title = book?.title || `hebrewbooks_${id}`;
    const filenameBase = sanitizeFilename(title);
    const fileName = uniqueFilename(`${filenameBase}.pdf`, usedNames);

    const url = new URL(HEBREWBOOKS_BASE);
    url.searchParams.set('req', id);

    await new Promise((resolve) => {
      const upstreamReq = https.get(
        url,
        {
          headers: {
            'User-Agent': 'hebrewbooks-manager/1.0'
          }
        },
        (upstreamRes) => {
          const statusCode = upstreamRes.statusCode || 502;
          if (statusCode >= 300 && statusCode < 400 && upstreamRes.headers.location) {
            https.get(upstreamRes.headers.location, (r2) => {
              if ((r2.statusCode || 502) >= 200 && (r2.statusCode || 502) < 300) {
                archive.append(r2, { name: fileName });
              } else {
                r2.resume();
              }
              resolve();
            }).on('error', resolve);
            upstreamRes.resume();
            return;
          }

          if (statusCode >= 200 && statusCode < 300) {
            archive.append(upstreamRes, { name: fileName });
            upstreamRes.on('end', resolve);
            upstreamRes.on('error', resolve);
            return;
          }

          upstreamRes.resume();
          resolve();
        }
      );

      upstreamReq.on('error', resolve);
    });
  }

  archive.finalize();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// replace startup refresh with safe wrapper
try {
  await refreshBooks();
} catch (err) {
  console.error('Failed to load CSV at startup:', err);
  books = [];
  booksById = new Map();
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`hebrewbooks-manager running on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`CSV_PATH=${CSV_PATH}`);
});
