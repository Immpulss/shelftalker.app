/* Book metadata retrieval. Never substitutes a first sentence for a synopsis. */
(function (root) {
  const clean = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : clean(value?.value || '');
  const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleNorm = value => norm(clean(value).replace(/^(?:the|an|a)\s+/i, ''));
  function sameAuthor(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || !left.trim() || !right.trim()) return false;
    const parts = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/);
    const a = parts(left), b = parts(right);
    if (a.join(' ') === b.join(' ')) return true;
    if (a.length < 2 || b.length < 2 || a[0] !== b[0] || a.at(-1) !== b.at(-1)) return false;
    const am = a.slice(1, -1), bm = b.slice(1, -1);
    if (!am.length || !bm.length) return true;
    return am.length === bm.length && am.every((name, i) => name === bm[i] || (name.length === 1 && bm[i].startsWith(name)) || (bm[i].length === 1 && name.startsWith(bm[i])));
  }
  function validISBN(isbn) {
    if (/^\d{13}$/.test(isbn)) return [...isbn].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0;
    return /^\d{9}[\dX]$/.test(isbn) && [...isbn].reduce((n,c,i) => n + (c === 'X' ? 10 : Number(c)) * (10-i), 0) % 11 === 0;
  }
  function createLookup({ fetcher = fetch, apiKey = '', timeout = 8000, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    const cache = new Map();
    return async function lookup(raw) {
      const manual = typeof raw === 'object' && raw !== null;
      const isbn = manual ? '' : raw.replace(/[^0-9Xx]/g, '').toUpperCase();
      const initialTitle = manual ? clean(raw.title) : '';
      const initialAuthor = manual ? clean(raw.author) : '';
      if (manual && (!initialTitle || !initialAuthor)) throw new Error('Enter both the title and author to search.');
      if (!manual && !validISBN(isbn)) throw new Error('Please enter a valid 10- or 13-digit ISBN.');
      const cacheKey = manual ? 'manual:' + norm(initialTitle) + ':' + norm(initialAuthor) : isbn;
      if (cache.has(cacheKey)) return { ...cache.get(cacheKey), warnings: [] };
      const warnings = [];
      async function json(url) {
        for (let attempt=0; attempt<2; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          try {
            const response = await fetcher(url, { signal: controller.signal });
            if (response.status === 404) return null;
            if (!response.ok) {
              if (attempt === 0 && (response.status === 429 || response.status >= 500)) { await delay(350); continue; }
              throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
          } catch (error) {
            if (attempt === 0 && (error.name === 'AbortError' || error instanceof TypeError)) continue;
            warnings.push(`${new URL(url).hostname}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
            return null;
          } finally { clearTimeout(timer); }
        }
      }
      const google = query => json('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(query) + '&maxResults=10' + (apiKey ? '&key=' + encodeURIComponent(apiKey) : ''));
      let book = { isbn, title: initialTitle, author: initialAuthor, description: '', source: '', warnings };
      const matches = (title, authors) => titleNorm(title) === titleNorm(book.title) && authors.some(a => sameAuthor(a, book.author) || book.author.split(', ').some(b => sameAuthor(a, b)));
      function acceptGoogle(item, exact) {
        const v = item.volumeInfo || {};
        if (!v.title || !v.authors?.length) return;
        // ISBN identity is stronger than abbreviated edition titles or contributor lists.
        exact = exact || (v.industryIdentifiers || []).some(id => id.identifier === isbn);
        if (exact) { book.title = v.title; book.author = v.authors.join(', '); }
        if (!exact && !matches(v.title, v.authors)) return;
        if (!book.title) { book.title = v.title; book.author = v.authors.join(', '); }
        if (!matches(v.title, v.authors)) return;
        if (clean(v.description)) { book.description = clean(v.description); book.source = 'Google Books'; }
      }
      // Start independent providers together; a slow Google search must not delay Open Library.
      const editionRequest = manual ? Promise.resolve(null) : json('https://openlibrary.org/isbn/' + isbn + '.json');
      const g = manual ? null : await google('isbn:' + isbn);
      for (const item of g?.items || []) {
        const ids = item.volumeInfo?.industryIdentifiers || [];
        if (ids.some(i => i.identifier === isbn)) acceptGoogle(item, true);
        if (book.description) break;
      }
      if (!book.description) {
        const edition = await editionRequest;
        if (edition) {
          // Editions can omit authors entirely; their linked works contain them.
          const authorCache = new Map();
          async function authorNames(records) {
            const names = [];
            for (const record of records || []) {
              const key = record.author?.key || record.key;
              if (!/^\/authors\/OL\d+A$/.test(key || '')) continue;
              if (!authorCache.has(key)) {
                const data = await json('https://openlibrary.org' + key + '.json');
                authorCache.set(key, data?.name || '');
              }
              if (authorCache.get(key)) names.push(authorCache.get(key));
            }
            return [...new Set(names)];
          }
          let authors = await authorNames(edition.authors);
          const works = [];
          if (!clean(edition.description) || !authors.length) {
            for (const work of edition.works || []) {
              if (!/^\/works\/OL\d+W$/.test(work.key || '')) continue;
              const data = await json('https://openlibrary.org' + work.key + '.json');
              if (!data) continue;
              const workAuthors = await authorNames(data.authors);
              if (workAuthors.length) authors = workAuthors;
              works.push(data);
              if (authors.length && (clean(edition.description) || clean(data.description))) break;
            }
          }
          if (!book.title) book.title = edition.title || '';
          if (norm(edition.title) === norm(book.title)) {
            if (!book.author) book.author = authors.join(', ');
            if (!authors.length || matches(edition.title, authors)) {
              book.description = clean(edition.description);
              if (!book.description) {
                for (const work of works) {
                  if (clean(work.description)) { book.description = clean(work.description); break; }
                }
              }
              if (book.description) book.source = 'Open Library';
            }
          }
        }
      }
      if (!book.description && book.title && book.author) {
        const result = await google('intitle:"' + book.title + '" inauthor:"' + book.author + '"');
        for (const item of result?.items || []) { acceptGoogle(item, false); if (book.description) break; }
        // Google Books field searches sometimes return zero where plain text succeeds.
        // Keep the same title/author identity checks for these broader results.
        if (!book.description) {
          const broad = await google(book.title + ' ' + book.author);
          for (const item of broad?.items || []) { acceptGoogle(item, false); if (book.description) break; }
        }
        // Broader discovery still requires both title and author to match.
        if (!book.description) {
          const primaryAuthor = book.author.split(', ')[0];
          const queries = [...new Set([primaryAuthor, book.title + ' ' + primaryAuthor, book.title, primaryAuthor.split(/\s+/).pop()])];
          for (const query of queries) {
            const result = await google(query);
            const items = [...(result?.items || [])].sort((a, b) => {
              const exact = item => (item.volumeInfo?.industryIdentifiers || []).some(id => id.identifier === isbn);
              return Number(exact(b)) - Number(exact(a));
            });
            for (const item of items) { acceptGoogle(item, false); if (book.description) break; }
            if (book.description) break;
          }
        }
        if (!book.description) {
          const result = await json('https://openlibrary.org/search.json?title=' + encodeURIComponent(book.title) + '&author=' + encodeURIComponent(book.author) + '&limit=5');
          for (const doc of result?.docs || []) {
            if (!matches(doc.title, doc.author_name || []) || !/^\/works\/OL\d+W$/.test(doc.key || '')) continue;
            const work = await json('https://openlibrary.org' + doc.key + '.json');
            if (clean(work?.description)) { book.description = clean(work.description); book.source = 'Open Library'; break; }
          }
        }
      }
      if (book.description && book.title && book.author) cache.set(cacheKey, { ...book });
      return book;
    };
  }
  const api = { createLookup, validISBN, clean, sameAuthor };
  if (typeof module !== 'undefined') module.exports = api;
  else root.BookLookup = api;
})(globalThis);
