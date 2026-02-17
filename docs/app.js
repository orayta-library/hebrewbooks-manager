const $ = (id) => document.getElementById(id);

const state = {
  q: '',
  limit: 50,
  offset: 0,
  total: 0,
  timer: null,
  sortKey: 'id',
  sortDir: 'asc',
  selected: new Set(),
  downloading: false
};

let booksById = new Map();

const HISTORY_KEY = 'hebrwbooksdownload.history.v1';
const HISTORY_MAX = 200;
const SEARCH_KEY = 'hebrwbooksdownload.search.v1';
const SEARCH_MAX = 30;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
}

function addHistory(entry) {
  const items = loadHistory();
  items.unshift(entry);
  saveHistory(items);
}

function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(items) {
  localStorage.setItem(SEARCH_KEY, JSON.stringify(items.slice(0, SEARCH_MAX)));
}

function addSearchHistory(q) {
  if (!q || typeof q !== 'string') return;
  const items = loadSearchHistory();
  const cleaned = q.trim();
  if (!cleaned) return;
  const filtered = items.filter((x) => x !== cleaned);
  filtered.unshift(cleaned);
  saveSearchHistory(filtered);
}

function formatTime(ts) {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function escapeText(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function openHistoryModal() {
  const modal = $('historyModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  renderHistory();
}

function closeHistoryModal() {
  const modal = $('historyModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function renderSearchAutocomplete(query) {
  const container = $('searchAutocomplete');
  const list = $('searchList');
  if (!container || !list) return;
  const items = loadSearchHistory();
  const filtered = query
    ? items.filter((x) => x.toLowerCase().includes(query.toLowerCase()))
    : items.slice(0, 10);
  if (!filtered.length) {
    container.classList.add('hidden');
    return;
  }
  list.innerHTML = filtered
    .slice(0, 10)
    .map((item) => {
      const escaped = escapeText(item);
      return `
        <button type="button" class="searchSuggestion w-full rounded-xl px-4 py-2 text-right text-sm hover:bg-slate-50" data-value="${escaped}">
          ${escaped}
        </button>
      `;
    })
    .join('');
  container.classList.remove('hidden');
  list.querySelectorAll('.searchSuggestion').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-value') || '';
      $('search').value = val;
      state.q = val.trim();
      state.offset = 0;
      container.classList.add('hidden');
      load();
    });
  });
}

function hideSearchAutocomplete() {
  const container = $('searchAutocomplete');
  if (container) container.classList.add('hidden');
}

function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  const items = loadHistory();
  if (!items.length) {
    list.innerHTML = '<div class="py-8 text-center text-sm text-slate-500">אין עדיין הורדות</div>';
    return;
  }

  list.innerHTML = items
    .slice(0, 50)
    .map((it) => {
      if (it.type === 'single') {
        return `
          <div class="flex items-start justify-between gap-4 py-3">
            <div>
              <div class="text-sm font-medium text-slate-900">${escapeText(it.title || it.id || 'הורדה')}</div>
              <div class="mt-0.5 text-xs text-slate-500">ספר בודד | ID: <span class="font-mono">${escapeText(it.id || '')}</span></div>
            </div>
            <div class="text-xs text-slate-500">${escapeText(formatTime(it.ts))}</div>
          </div>
        `;
      }

      return `
        <div class="flex items-start justify-between gap-4 py-3">
          <div>
            <div class="text-sm font-medium text-slate-900">${escapeText(it.filename || 'ZIP')}</div>
            <div class="mt-0.5 text-xs text-slate-500">ZIP | ${escapeText(it.count ?? '')} ספרים</div>
          </div>
          <div class="text-xs text-slate-500">${escapeText(formatTime(it.ts))}</div>
        </div>
      `;
    })
    .join('');
}

function setStatus() {
  const start = Math.min(state.total, state.offset + 1);
  const end = Math.min(state.total, state.offset + state.limit);
  $('status').textContent = state.total
    ? `מציג ${start}-${end} מתוך ${state.total}`
    : 'אין תוצאות';

  $('prev').disabled = state.offset <= 0;
  $('next').disabled = state.offset + state.limit >= state.total;

  $('prev').classList.toggle('opacity-50', $('prev').disabled);
  $('next').classList.toggle('opacity-50', $('next').disabled);
}

function updateBulkBar() {
  const count = state.selected.size;
  $('selectedCount').textContent = String(count);
  $('bulkBar').classList.toggle('hidden', count === 0);
  $('bulkBar').classList.toggle('flex', count !== 0);
  $('downloadSelected').disabled = count === 0 || state.downloading;
  $('downloadSelected').classList.toggle('opacity-50', $('downloadSelected').disabled);
  $('exportSelected').disabled = count === 0;
  $('exportSelected').classList.toggle('opacity-50', $('exportSelected').disabled);
}

function showNetworkError(message) {
  const errorDiv = $('networkError');
  const messageDiv = $('networkErrorMessage');
  if (!errorDiv || !messageDiv) return;
  
  messageDiv.textContent = message;
  errorDiv.classList.remove('hidden');
  errorDiv.classList.add('flex');
  
  setTimeout(() => {
    errorDiv.classList.add('hidden');
    errorDiv.classList.remove('flex');
  }, 5000);
}

function hideNetworkError() {
  const errorDiv = $('networkError');
  if (errorDiv) {
    errorDiv.classList.add('hidden');
    errorDiv.classList.remove('flex');
  }
}

function exportSelectedBooks() {
  const selectedIds = Array.from(state.selected);
  if (!selectedIds.length) return;
  
  try {
    const selectedBooks = selectedIds.map(id => {
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
    
    const dataStr = JSON.stringify(selectedBooks, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `hebrewbooks-selection-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  } catch (error) {
    showNetworkError('אירעה שגיאה בייצוא הרשימה: ' + error.message);
  }
}

function importSelectedBooks(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedBooks = JSON.parse(e.target.result);
      if (!Array.isArray(importedBooks)) {
        throw new Error('הקובץ אינו בפורמט תקין');
      }
      
      let importedCount = 0;
      importedBooks.forEach(book => {
        if (book && book.id && booksById.has(book.id)) {
          state.selected.add(book.id);
          importedCount++;
        }
      });
      
      updateBulkBar();
      updateRowCheckboxes();
      syncSelectAllCheckbox();
      
      if (importedCount > 0) {
        showNetworkError(`יובאו בהצלחה ${importedCount} ספרים לרשימה הנבחרת`);
      } else {
        showNetworkError('לא נמצאו ספרים תואמים בקובץ המיובא');
      }
    } catch (error) {
      showNetworkError('שגיאה בייבוא הקובץ: ' + error.message);
    }
  };
  
  reader.readAsText(file);
  event.target.value = '';
}

function updateRowCheckboxes() {
  document.querySelectorAll('input.rowSelect').forEach(cb => {
    const id = cb.dataset.id;
    cb.checked = state.selected.has(id);
  });
}

function setProgress(doneCount, totalCount, bytesDone, bytesTotal) {
  if (!state.downloading) {
    $('progressText').textContent = '';
    $('progressBar').style.width = '0%';
    $('progressBar').classList.remove('animate-pulse');
    return;
  }

  let pct = 0;
  if (bytesTotal > 0) {
    pct = Math.floor((bytesDone / bytesTotal) * 100);
  } else if (totalCount > 0) {
    pct = Math.floor((doneCount / totalCount) * 100);
  }

  const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)}MB`;

  if (bytesTotal > 0) {
    $('progressText').textContent = `מוריד ${mb(bytesDone)} / ${mb(bytesTotal)}`;
    $('progressBar').classList.remove('animate-pulse');
    $('progressBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return;
  }

  if (bytesDone > 0 && doneCount === 0 && totalCount === 1) {
    $('progressText').textContent = `מוריד ZIP... ${mb(bytesDone)}`;
    $('progressBar').classList.add('animate-pulse');
    $('progressBar').style.width = '100%';
    return;
  }

  $('progressText').textContent = totalCount
    ? `מוריד ${doneCount}/${totalCount}`
    : '';
  $('progressBar').classList.remove('animate-pulse');
  $('progressBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function updateSortIcons() {
  document.querySelectorAll('button.sort').forEach((btn) => {
    const key = btn.dataset.sort;
    const icon = btn.querySelector('.sortIcon');
    if (!icon) return;
    if (key !== state.sortKey) {
      icon.textContent = '';
      return;
    }
    icon.textContent = state.sortDir === 'asc' ? '▲' : '▼';
  });
}

function scrollToListTop() {
  const el = document.getElementById('listTop');
  if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
  else window.scrollTo({ top: 0, behavior: 'auto' });
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.limit));
}

function currentPage() {
  return Math.floor(state.offset / state.limit) + 1;
}

function renderPagination() {
  const pagesCount = totalPages();
  const pageNow = currentPage();

  const container = $('pageItems');
  if (!container) return;

  const pagePrev = $('pagePrev');
  const pageNext = $('pageNext');
  if (pagePrev) {
    pagePrev.disabled = pageNow <= 1;
    pagePrev.classList.toggle('opacity-50', pagePrev.disabled);
  }
  if (pageNext) {
    pageNext.disabled = pageNow >= pagesCount;
    pageNext.classList.toggle('opacity-50', pageNext.disabled);
  }

  const mkBtn = (page, label, active = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'pageBtn rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50';
    if (active) {
      btn.classList.add('bg-slate-100');
      btn.classList.add('border-slate-300');
      btn.classList.add('text-slate-900');
    }
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.offset = (page - 1) * state.limit;
      load().then(scrollToListTop);
    });
    return btn;
  };

  const mkEllipsis = () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'pageBtn rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm hover:bg-slate-50';
    btn.textContent = '...';
    btn.title = 'מעבר לעמוד';
    btn.addEventListener('click', openPageModal);
    return btn;
  };

  container.innerHTML = '';

  if (pagesCount <= 1) return;

  const pages = new Set([1, pagesCount, pageNow - 1, pageNow, pageNow + 1]);
  for (let i = 1; i <= pagesCount; i += 1) {
    if (i <= 2 || i >= pagesCount - 1) pages.add(i);
  }

  const ordered = Array.from(pages)
    .filter((p) => p >= 1 && p <= pagesCount)
    .sort((a, b) => a - b);

  let last = 0;
  for (const p of ordered) {
    if (last && p - last > 1) container.appendChild(mkEllipsis());
    container.appendChild(mkBtn(p, String(p), p === pageNow));
    last = p;
  }
}

function renderRows(items) {
  const tbody = $('rows');
  tbody.innerHTML = items
    .map((b) => {
      const title = escapeHtml(b.title);
      const author = escapeHtml(b.author);
      const printingPlace = escapeHtml(b.printingPlace);
      const printingYear = escapeHtml(b.printingYear);
      const pages = escapeHtml(b.pages);
      const id = escapeHtml(b.id);
      const checked = state.selected.has(b.id) ? 'checked' : '';

      return `
        <tr class="hover:bg-slate-50" data-preview-id="${id}">
          <td class="px-4 py-3">
            <input data-id="${id}" type="checkbox" ${checked} class="rowSelect h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-200" />
          </td>
          <td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">${id}</td>
          <td class="px-4 py-3 font-medium"><span class="previewTarget">${title}</span></td>
          <td class="px-4 py-3 text-slate-700">${author}</td>
          <td class="px-4 py-3 text-slate-700">${printingPlace}</td>
          <td class="px-4 py-3 text-slate-700">${printingYear}</td>
          <td class="px-4 py-3 text-slate-700">${pages}</td>
          <td class="px-4 py-3">
            <a
              data-download-id="${escapeHtml(b.id)}"
              data-download-title="${escapeHtml(b.title)}"
              class="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              href="/download/${encodeURIComponent(b.id)}"
            >
              הורד
            </a>
          </td>
        </tr>
      `;
    })
    .join('');

  // attach event handlers (selection, download listeners exist elsewhere)

  // Preview tooltip: show image preview from beta.hebrewbooks.org/pagepngs/{id}_1_600_0 on hover with small delay
  const createPreviewTooltip = () => {
    let t = document.getElementById('previewTooltip');
    if (t) return t;
    t = document.createElement('div');
    t.id = 'previewTooltip';
    Object.assign(t.style, {
      position: 'fixed',
      width: '360px',
      height: '480px',
      background: 'white',
      border: '1px solid rgba(0,0,0,0.12)',
      boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
      zIndex: 99999,
      display: 'none',
      overflow: 'hidden',
      borderRadius: '8px'
    });

    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.background = '#fff';
    img.alt = 'תצוגה מקדימה';
    img.setAttribute('loading', 'lazy');

    const fallback = document.createElement('div');
    fallback.className = 'previewFallback';
    Object.assign(fallback.style, {
      display: 'none',
      padding: '12px',
      fontSize: '13px'
    });

    const link = document.createElement('a');
    link.href = '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'פתח תצוגה בחלון חדש';
    link.style.color = '#111827';

    fallback.appendChild(document.createTextNode('תצוגה מקדימה לא זמינה — '));
    fallback.appendChild(link);

    t.appendChild(img);
    t.appendChild(fallback);
    document.body.appendChild(t);
    return t;
  };

  const showPreviewForId = (id, anchorRect) => {
    const t = createPreviewTooltip();
    const img = t.querySelector('img');
    const fallback = t.querySelector('.previewFallback');
    const url = `https://hebrewbooks.org/${encodeURIComponent(id)}`;
    const imgUrl = `https://beta.hebrewbooks.org/pagepngs/${encodeURIComponent(id)}_1_600_0.png`;

    const padding = 8;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const tooltipW = 360;
    const tooltipH = 480;

    // Center the tooltip horizontally under the hovered row
    let left = Math.round(anchorRect.left + (anchorRect.width - tooltipW) / 2);
    // Clamp to viewport
    left = Math.max(padding, Math.min(left, vw - tooltipW - padding));

    // Prefer placing immediately below the row
    let top = anchorRect.bottom + padding;
    // If not enough space below, place above the row
    if (top + tooltipH > vh) {
      top = anchorRect.top - tooltipH - padding;
    }
    // Clamp top into viewport
    top = Math.max(padding, Math.min(top, Math.max(padding, vh - tooltipH - padding)));

    t.style.left = `${left}px`;
    t.style.top = `${top}px`;

    // set fallback link
    const link = t.querySelector('.previewFallback a');
    link.href = url;

    // try load image
    img.style.display = '';
    fallback.style.display = 'none';
    t.style.display = 'block';
    img.src = imgUrl;

    // if image fails to load within X seconds, show fallback
    const onFail = () => {
      img.style.display = 'none';
      fallback.style.display = '';
    };

    const failTimer = setTimeout(onFail, 2000);
    img.onload = () => { clearTimeout(failTimer); };
    img.onerror = () => { clearTimeout(failTimer); onFail(); };
  };

  const hidePreview = () => {
    const t = document.getElementById('previewTooltip');
    if (!t) return;
    const img = t.querySelector('img');
    img.src = '';
    t.style.display = 'none';
  };

  // Attach hover handlers with small delay to rows
  tbody.querySelectorAll('[data-preview-id]').forEach((row) => {
    let timer = null;
    row.addEventListener('mouseenter', (e) => {
      const id = row.getAttribute('data-preview-id');
      if (!id) return;
      const rect = row.getBoundingClientRect();
      timer = setTimeout(() => showPreviewForId(id, rect), 350);
    });
    row.addEventListener('mouseleave', () => {
      if (timer) { clearTimeout(timer); timer = null; }
      hidePreview();
    });
    // hide on scroll or click outside
  });

  document.addEventListener('scroll', hidePreview, true);
}

function syncSelectAllCheckbox() {
  const boxes = Array.from(document.querySelectorAll('input.rowSelect'));
  if (!boxes.length) {
    $('selectAll').checked = false;
    $('selectAll').indeterminate = false;
    return;
  }

  const checkedCount = boxes.filter((b) => b.checked).length;
  $('selectAll').checked = checkedCount === boxes.length;
  $('selectAll').indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

async function load() {
  $('status').textContent = 'טוען...';

  // Try API first; if it 404s (static environment like GitHub Pages), fall back to static `books.json`.
  const url = new URL('/api/books', window.location.origin);
  if (state.q) url.searchParams.set('q', state.q);
  url.searchParams.set('limit', String(state.limit));
  url.searchParams.set('offset', String(state.offset));
  if (state.sortKey) url.searchParams.set('sortKey', state.sortKey);
  if (state.sortDir) url.searchParams.set('sortDir', state.sortDir);

  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      state.total = data.total;
      booksById.clear();
      (data.items || []).forEach(book => booksById.set(book.id, book));
      renderRows(data.items || []);
      setStatus();
      updateBulkBar();
      updateSortIcons();
      renderPagination();
      return;
    }

    // If API is not OK (404, 418, blocked, etc.), attempt static fallback
    if (!res.ok) {
      // fetch static JSON
      try {
        const sres = await fetch('books.json');
        if (!sres.ok) throw new Error('static not found');
        const items = await sres.json();
        // keep full set for client-side filtering/pagination
        const allItems = Array.isArray(items) ? items : [];
        state.total = allItems.length;
        // index all books
        booksById.clear();
        allItems.forEach(b => booksById.set(b.id, b));

        // local filtering / sorting / pagination
        let filtered = allItems;
        if (state.q) {
          const ql = state.q.toLowerCase();
          filtered = filtered.filter((b) => {
            return (
              (b.title && b.title.toLowerCase().includes(ql)) ||
              (b.author && b.author.toLowerCase().includes(ql)) ||
              (b.id && b.id.toLowerCase().includes(ql)) ||
              (b.tags && b.tags.toLowerCase().includes(ql))
            );
          });
        }

        if (state.sortKey) {
          const key = state.sortKey;
          const dir = state.sortDir === 'desc' ? -1 : 1;
          const coll = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });
          filtered = [...filtered].sort((a, b) => coll.compare(String(a[key] ?? ''), String(b[key] ?? '')) * dir);
        }

        state.total = filtered.length;
        const slice = filtered.slice(state.offset, state.offset + state.limit);
        // re-index only visible items for rendering convenience
        booksById.clear();
        (slice || []).forEach(book => booksById.set(book.id, book));

        renderRows(slice || []);
        setStatus();
        updateBulkBar();
        updateSortIcons();
        renderPagination();
        return;
      } catch (e) {
        // Try loading books.js (JS wrapper) as NetFree may block .json files.
        const loadBooksJs = () => new Promise((resolve, reject) => {
          if (window.__BOOKS && Array.isArray(window.__BOOKS)) return resolve(window.__BOOKS);
          const s = document.createElement('script');
          s.src = 'books.js';
          s.async = true;
          s.onload = () => {
            if (window.__BOOKS && Array.isArray(window.__BOOKS)) return resolve(window.__BOOKS);
            return reject(new Error('books.js loaded but no data'));
          };
          s.onerror = () => reject(new Error('failed to load books.js'));
          // timeout in case the script is blocked
          const t = setTimeout(() => reject(new Error('books.js load timeout')), 8000);
          s.onload = () => { clearTimeout(t); if (window.__BOOKS && Array.isArray(window.__BOOKS)) return resolve(window.__BOOKS); return reject(new Error('books.js loaded but no data')); };
          s.onerror = () => { clearTimeout(t); reject(new Error('failed to load books.js')); };
          document.head.appendChild(s);
        });

        try {
          const items = await loadBooksJs();
          const allItems = Array.isArray(items) ? items : [];
          state.total = allItems.length;
          booksById.clear();
          allItems.forEach(b => booksById.set(b.id, b));

          // local filtering / sorting / pagination (same as JSON path)
          let filtered = allItems;
          if (state.q) {
            const ql = state.q.toLowerCase();
            filtered = filtered.filter((b) => {
              return (
                (b.title && b.title.toLowerCase().includes(ql)) ||
                (b.author && b.author.toLowerCase().includes(ql)) ||
                (b.id && b.id.toLowerCase().includes(ql)) ||
                (b.tags && b.tags.toLowerCase().includes(ql))
              );
            });
          }

          if (state.sortKey) {
            const key = state.sortKey;
            const dir = state.sortDir === 'desc' ? -1 : 1;
            const coll = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });
            filtered = [...filtered].sort((a, b) => coll.compare(String(a[key] ?? ''), String(b[key] ?? '')) * dir);
          }

          state.total = filtered.length;
          const slice = filtered.slice(state.offset, state.offset + state.limit);
          booksById.clear();
          (slice || []).forEach(book => booksById.set(book.id, book));
          renderRows(slice || []);
          setStatus();
          updateBulkBar();
          updateSortIcons();
          renderPagination();
          return;
        } catch (err) {
          // fallback failed — show error based on original response
          if (res.status === 0 || !navigator.onLine) {
            showNetworkError('אין חיבור לרשת. אנא בדוק את חיבור האינטרנט שלך.');
          } else {
            showNetworkError(`שגיאת שרת: ${res.status} - לא ניתן לטעון את רשימת הספרים`);
          }
          $('status').textContent = 'שגיאה בטעינה';
          $('rows').innerHTML = '';
          return;
        }
      }
    }
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      showNetworkError('אין חיבור לרשת. אנא בדוק את חיבור האינטרנט שלך.');
    } else {
      showNetworkError('אירעה שגיאה בטעינת הנתונים: ' + error.message);
    }
    $('status').textContent = 'שגיאה בטעינה';
    $('rows').innerHTML = '';
  }
}

async function bulkDownload() {
  if (state.downloading) return;
  const ids = Array.from(state.selected);
  if (!ids.length) return;

  state.downloading = true;
  updateBulkBar();

  let bytesDone = 0;
  const bytesTotal = 0;
  setProgress(0, 1, bytesDone, bytesTotal);

  try {
    const res = await fetch('/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });

    if (!res.ok) {
      if (res.status === 0 || !navigator.onLine) {
        showNetworkError('אין חיבור לרשת. לא ניתן להוריד את הספרים.');
      } else {
        showNetworkError(`שגיאת שרת: ${res.status} - לא ניתן להוריד את הספרים`);
      }
      state.downloading = false;
      updateBulkBar();
      setProgress(0, 1, 0, 0);
      return;
    }

    const cd = res.headers.get('content-disposition') || '';
    const match = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
    const filename = match ? decodeURIComponent(match[1].trim()) : 'hebrwbooksdownload.zip';

    const reader = res.body?.getReader();
    if (!reader) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      bytesDone = blob.size;
      setProgress(1, 1, bytesDone, bytesTotal);
      return;
    }

    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytesDone += value.byteLength;
      setProgress(0, 1, bytesDone, bytesTotal);
    }

    const blob = new Blob(chunks, { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setProgress(1, 1, bytesDone, bytesTotal);

    addHistory({
      ts: Date.now(),
      type: 'zip',
      count: ids.length,
      filename
    });
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      showNetworkError('אין חיבור לרשת. לא ניתן להוריד את הספרים.');
    } else {
      showNetworkError('אירעה שגיאה בהורדת הספרים: ' + error.message);
    }
  } finally {
    state.downloading = false;
    updateBulkBar();
    setProgress(0, 0, 0, 0);
  }
}

$('search').addEventListener('input', (e) => {
  const val = e.target.value;
  state.q = val.trim();
  state.offset = 0;

  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    load();
    addSearchHistory(state.q);
  }, 250);

  renderSearchAutocomplete(state.q);
});

$('search').addEventListener('focus', () => {
  renderSearchAutocomplete(state.q);
});

document.addEventListener('click', (e) => {
  const container = $('searchAutocomplete');
  if (!container || container.contains(e.target) || e.target === $('search')) return;
  hideSearchAutocomplete();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSearchAutocomplete();
});

$('refresh').addEventListener('click', () => {
  load();
});

$('prev').addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  load().then(scrollToListTop);
});

$('next').addEventListener('click', () => {
  state.offset = state.offset + state.limit;
  load().then(scrollToListTop);
});

$('pagePrev')?.addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  load().then(scrollToListTop);
});

$('pageNext')?.addEventListener('click', () => {
  state.offset = state.offset + state.limit;
  load().then(scrollToListTop);
});

function openPageModal() {
  const modal = $('pageModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  const pagesCount = totalPages();
  const pageNow = currentPage();
  $('pageModalHint').textContent = `עמוד נוכחי: ${pageNow} | סה"כ: ${pagesCount}`;
  $('pageModalInput').value = String(pageNow);
  setTimeout(() => $('pageModalInput').focus(), 0);
}

function closePageModal() {
  const modal = $('pageModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function goToPageFromModal() {
  const pagesCount = totalPages();
  const raw = String($('pageModalInput').value || '').trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > pagesCount) {
    $('pageModalHint').textContent = `אנא הזן מספר בין 1 ל-${pagesCount}`;
    return;
  }
  state.offset = (Math.floor(n) - 1) * state.limit;
  closePageModal();
  load().then(scrollToListTop);
}

$('pageModalClose')?.addEventListener('click', closePageModal);
$('pageModalCancel')?.addEventListener('click', closePageModal);
$('pageModal')?.addEventListener('click', (e) => {
  if (e.target === $('pageModal')) closePageModal();
});

$('pageModalGo')?.addEventListener('click', goToPageFromModal);
$('pageModalInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') goToPageFromModal();
  if (e.key === 'Escape') closePageModal();
});

$('history')?.addEventListener('click', openHistoryModal);
$('historyModalClose')?.addEventListener('click', closeHistoryModal);
$('historyModalCancel')?.addEventListener('click', closeHistoryModal);
$('historyModal')?.addEventListener('click', (e) => {
  if (e.target === $('historyModal')) closeHistoryModal();
});

$('historyClear')?.addEventListener('click', () => {
  saveHistory([]);
  renderHistory();
});

$('selectAll').addEventListener('change', (e) => {
  const checked = e.target.checked;
  e.target.indeterminate = false;
  document.querySelectorAll('input.rowSelect').forEach((cb) => {
    cb.checked = checked;
    const id = cb.getAttribute('data-id');
    if (!id) return;
    if (checked) state.selected.add(id);
    else state.selected.delete(id);
  });
  syncSelectAllCheckbox();
  updateBulkBar();
});

$('clearSelection').addEventListener('click', () => {
  state.selected.clear();
  $('selectAll').checked = false;
  $('selectAll').indeterminate = false;
  document.querySelectorAll('input.rowSelect').forEach((cb) => {
    cb.checked = false;
  });
  syncSelectAllCheckbox();
  updateBulkBar();
});

$('downloadSelected').addEventListener('click', () => {
  bulkDownload();
});

$('exportSelected').addEventListener('click', () => {
  exportSelectedBooks();
});

$('importSelected').addEventListener('click', () => {
  $('importFileInput').click();
});

$('importFileInput').addEventListener('change', importSelectedBooks);

$('networkErrorClose').addEventListener('click', hideNetworkError);

document.querySelectorAll('button.sort').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (!key) return;
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else {
      state.sortKey = key;
      state.sortDir = 'asc';
    }
    state.offset = 0;
    updateSortIcons();
    load();
  });
});

load();
