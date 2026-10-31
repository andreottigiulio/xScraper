/* x-tweet-save.js
 * Incolla tutto il file nella console DevTools di x.com (F12 -> Console), Invio.
 *
 * Tweet singoli: clicca i tweet da salvare, ESC per terminare.
 *
 * Ricerca / hashtag (tutti i risultati):
 *   await tweetSaver.saveAll({ mode: 'single' })              // un solo file con tutti i tweet
 *   await tweetSaver.saveAll({ mode: 'pager', perPage: 20 })  // file unico impaginato
 *   await tweetSaver.saveAll({ mode: 'files' })               // un file per tweet + indice impaginato + json
 *   opzioni: max (default 200), json (default true), download (default true)
 *   ESC durante la raccolta interrompe lo scroll e salva quello che ha gia' raccolto.
 *
 * Altri comandi: tweetSaver.collect() · tweetSaver.saveVisible() · tweetSaver.setTheme('#000000')
 *                tweetSaver.stop()
 */
(() => {
  /* ---------------------------- helpers ---------------------------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const luminance = css => {
    const s = String(css || '').trim();
    let r, g, b;
    if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3) h = h.replace(/./g, c => c + c);
      if (h.length < 6) return 1;
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      const m = s.match(/-?[\d.]+/g);
      if (!m || m.length < 3) return 1;
      [r, g, b] = m.map(Number);
    }
    if ([r, g, b].some(Number.isNaN)) return 1;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const slugify = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('it-IT');
  };

  const excerpt = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };

  const METRIC_LABELS = { reply: 'risposte', retweet: 'repost', like: 'like', bookmark: 'salvataggi' };

  const metricsLine = metrics => Object.entries(metrics || {}).map(([k, v]) => {
    const num = (String(v).match(/\d+([.,]\d+)?/) || [String(v)])[0];
    return `${num} ${METRIC_LABELS[k] || k}`;
  }).join(' · ');

  let forcedBg = null;
  let capSeq = 0;
  const imgCache = new Map();

  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function fetchDataURL(url) {
    if (imgCache.has(url)) return imgCache.get(url);
    let out = null;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (res.ok) out = await blobToDataURL(await res.blob());
    } catch { }
    imgCache.set(url, out);
    return out;
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }

  function pageBackground(el) {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = (c || '').match(/-?[\d.]+/g);
      if (!m || m.length < 3) continue;
      const alpha = m.length > 3 ? Number(m[3]) : 1;
      if (alpha < 0.95) continue;
      return c;
    }
    return '#ffffff';
  }

  function searchQuery() {
    try {
      const q = new URL(location.href).searchParams.get('q');
      if (q) return q;
    } catch { }
    const tag = (location.pathname.match(/^\/hashtag\/([^/?#]+)/) || [])[1];
    if (tag) {
      try { return '#' + decodeURIComponent(tag); } catch { return '#' + tag; }
    }
    return (document.title || '').replace(/\s*[/|]\s*X$/, '').trim();
  }

  /* ---------------------------- capture ---------------------------- */

  const PROPS = `display position top right bottom left z-index float clear
box-sizing width height min-width min-height max-width max-height
margin-top margin-right margin-bottom margin-left
padding-top padding-right padding-bottom padding-left
flex flex-direction flex-wrap flex-grow flex-shrink flex-basis order
align-items align-self align-content justify-content justify-items justify-self
gap row-gap column-gap grid-template-columns grid-template-rows grid-auto-flow grid-column grid-row grid-area
overflow overflow-x overflow-y object-fit object-position
font-family font-size font-weight font-style line-height letter-spacing word-spacing
text-align text-decoration-line text-decoration-color text-transform text-indent text-shadow
white-space word-break overflow-wrap vertical-align direction
color background-color background-image background-position background-size background-repeat background-clip
border-top-width border-right-width border-bottom-width border-left-width
border-top-style border-right-style border-bottom-style border-left-style
border-top-color border-right-color border-bottom-color border-left-color
border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius
box-shadow opacity transform transform-origin filter mix-blend-mode isolation
list-style-type -webkit-line-clamp -webkit-box-orient -webkit-text-fill-color -webkit-text-stroke
fill stroke stroke-width`.split(/\s+/).filter(Boolean);

  const PSEUDO_PROPS = ['content', 'display', 'position', 'top', 'right', 'bottom', 'left',
    'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'color',
    'background', 'width', 'height', 'margin', 'padding', 'border', 'border-radius',
    'transform', 'vertical-align'];

  function buildDoc({ title, bg, fg, rules = [], css = '', head = '', body }) {
    const dark = luminance(bg) <= 0.5;
    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${head}
<style>
  *{box-sizing:border-box}
  html{color-scheme:${dark ? 'dark' : 'light'}}
  html,body{margin:0;padding:0}
  body{background:${bg};color:${fg};padding:24px 16px;display:flex;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{width:100%;max-width:600px}
  .foot{margin-top:16px;font-size:12px;line-height:1.5;opacity:.6;word-break:break-word}
  .foot a{color:inherit}
${css}
${rules.join('\n')}
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>`;
  }

  async function capture(article, { download: doDownload = true, doc: wantDoc = doDownload, bg = null } = {}) {
    const clone = article.cloneNode(true);
    const rules = [];
    const seq = capSeq++;
    let uid = 0;

    // 1. stili calcolati inline (sovrascrivono qualsiasi CSS esterno)
    (function inline(a, b) {
      const cs = getComputedStyle(a);
      let decl = '';
      for (const p of PROPS) decl += `${p}:${cs.getPropertyValue(p)};`;
      b.setAttribute('style', decl);

      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(a, which);
        const content = ps.getPropertyValue('content');
        if (content && content !== 'none' && content !== 'normal') {
          const attr = which === '::before' ? 'data-b' : 'data-a';
          const key = `p${seq}_${uid++}`;
          b.setAttribute(attr, key);
          let r = `[${attr}="${key}"]${which}{`;
          for (const p of PSEUDO_PROPS) r += `${p}:${ps.getPropertyValue(p)};`;
          rules.push(r + '}');
        }
      }
      for (let i = 0; i < a.children.length; i++) inline(a.children[i], b.children[i]);
    })(article, clone);

    // 2. immagini -> data URL (avatar, foto, emoji); la cache evita di riscaricare lo stesso avatar
    const srcImgs = article.querySelectorAll('img');
    const dstImgs = clone.querySelectorAll('img');
    await Promise.all([...srcImgs].map(async (img, i) => {
      const dst = dstImgs[i];
      if (!dst) return;
      ['srcset', 'crossorigin', 'loading', 'decoding'].forEach(k => dst.removeAttribute(k));
      const raw = img.currentSrc || img.src;
      if (!raw) return;
      if (raw.startsWith('data:')) { dst.setAttribute('src', raw); return; }

      let u;
      try { u = new URL(raw, location.href); } catch { return; }
      const candidates = [];
      const orig = new URL(u.href);
      if (orig.searchParams.has('name')) {
        orig.searchParams.set('name', 'orig');
        candidates.push(orig.href);
      }
      candidates.push(u.href);

      for (const cand of candidates) {
        const data = await fetchDataURL(cand);
        if (data) { dst.setAttribute('src', data); return; }
      }
      dst.setAttribute('src', u.href);
    }));

    // 3. video: il file e' un blob non recuperabile -> uso il poster
    const liveVideos = article.querySelectorAll('video');
    clone.querySelectorAll('video').forEach((v, i) => {
      const poster = liveVideos[i]?.getAttribute('poster') || v.getAttribute('poster');
      const box = document.createElement('div');
      box.setAttribute('style', v.getAttribute('style') || '');
      const img = document.createElement('img');
      img.setAttribute('style', 'display:block;width:100%;height:100%;object-fit:cover;');
      if (poster) {
        img.setAttribute('src', poster);
        fetchDataURL(poster).then(d => { if (d) img.setAttribute('src', d); });
      }
      box.appendChild(img);
      v.replaceWith(box);
    });

    // 4. link assoluti
    clone.querySelectorAll('a[href]').forEach(a => {
      try { a.setAttribute('href', new URL(a.getAttribute('href'), location.href).href); } catch {}
    });

    // 5. metadati
    const timeEl = article.querySelector('time[datetime]');
    const url = timeEl?.closest('a')?.href || location.href;
    const datetime = timeEl?.getAttribute('datetime') || '';
    const nameLines = (article.querySelector('[data-testid="User-Name"]')?.innerText || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    const handle = nameLines.find(s => s.startsWith('@')) || '';
    const name = nameLines.find(s => !s.startsWith('@')) || '';
    const text = article.querySelector('[data-testid="tweetText"]')?.innerText || '';

    const metrics = {};
    for (const k of ['reply', 'retweet', 'like', 'bookmark']) {
      const b = article.querySelector(`[data-testid="${k}"]`);
      if (b) metrics[k] = (b.getAttribute('aria-label') || b.innerText || '').trim();
    }

    const id = (url.match(/status\/(\d+)/) || [])[1] || `tmp-${seq}`;
    const meta = { id, url, author: name, handle, datetime, text, metrics, captured: new Date().toISOString() };
    const fname = `x-${(handle || 'tweet').replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '')}-${id}.html`;
    const result = { meta, bodyHtml: clone.outerHTML, rules, fname };

    if (wantDoc) {
      const background = bg || forcedBg || pageBackground(article);
      const fg = luminance(background) <= 0.5 ? '#e7e9ea' : '#0f1419';
      result.doc = buildDoc({
        title: `${name}${handle ? ' ' + handle : ''}`.trim(),
        bg: background,
        fg,
        rules,
        head: `<meta name="x-source" content="${esc(url)}">
<meta name="x-author" content="${esc(name)}">
<meta name="x-handle" content="${esc(handle)}">
<meta name="x-published" content="${esc(datetime)}">
<meta name="x-captured" content="${meta.captured}">
<meta name="description" content="${esc(text)}">`,
        body: `${clone.outerHTML}
<p class="foot">Sorgente: <a href="${esc(url)}">${esc(url)}</a><br>Salvato il ${esc(fmtDate(meta.captured))}</p>`,
      });
      if (doDownload) downloadFile(fname, result.doc, 'text/html');
    }
    return result;
  }

  /* ---------------------------- raccolta ---------------------------- */

  function tweetKey(article) {
    const t = article.querySelector('time[datetime]');
    const url = t?.closest('a')?.href || '';
    const id = (url.match(/status\/(\d+)/) || [])[1];
    if (id) return id;
    if (url) return url;
    return 'txt:' + (article.innerText || '').slice(0, 120);
  }

  function isPromoted(article) {
    return !!article.querySelector('[data-testid="placementTracking"]');
  }

  async function collect({ max = 200, skipAds = true } = {}) {
    const items = [];
    const seen = new Set();
    const first = document.querySelector('article[data-testid="tweet"]');
    if (!first) {
      console.warn('Nessun tweet in pagina: apri una ricerca o un hashtag con risultati');
      return items;
    }

    let cancelled = false;
    const onEsc = e => { if (e.key === 'Escape') { cancelled = true; } };
    window.addEventListener('keydown', onEsc, true);

    let idle = 0;
    let lastCount = 0;
    let lastHeight = 0;

    try {
      while (!cancelled && items.length < max) {
        for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
          if (items.length >= max || cancelled) break;
          if (skipAds && isPromoted(a)) continue;
          const key = tweetKey(a);
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            items.push(await capture(a, { download: false, doc: false }));
          } catch (err) {
            console.error('tweet saltato', err);
          }
        }

        console.log(`raccolti ${items.length} tweet`);

        const h = document.documentElement.scrollHeight;
        if (items.length === lastCount && h === lastHeight) idle++; else idle = 0;
        lastCount = items.length;
        lastHeight = h;
        if (idle >= 4) break;

        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(900 + Math.random() * 500);
      }
    } finally {
      window.removeEventListener('keydown', onEsc, true);
    }

    if (cancelled) console.log('raccolta interrotta da ESC');
    return items;
  }

  /* ---------------------------- export ---------------------------- */

  function pagerScript(perPage) {
    return `<div id="pager"></div>
<script>
(function () {
  var per = ${perPage};
  var items = [].slice.call(document.querySelectorAll('.pg-item'));
  var pages = Math.max(1, Math.ceil(items.length / per));
  var page = 1;
  var bar = document.getElementById('pager');
  var sizes = [10, 20, 50, 100];
  if (sizes.indexOf(per) < 0) sizes.push(per);
  sizes.sort(function (a, b) { return a - b; });

  function draw() {
    items.forEach(function (el, i) {
      el.hidden = !(i >= (page - 1) * per && i < page * per);
    });
    bar.innerHTML = '';
    if (items.length > per) {
      bar.appendChild(mkbtn('‹', page - 1, page > 1));
      var s = document.createElement('span');
      s.textContent = page + ' / ' + pages;
      bar.appendChild(s);
      bar.appendChild(mkbtn('›', page + 1, page < pages));
    }
    var sel = document.createElement('select');
    sizes.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n + ' per pagina';
      if (n === per) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { per = +sel.value; page = 1; draw(); };
    bar.appendChild(sel);
    var tot = document.createElement('span');
    tot.textContent = items.length + ' tweet';
    bar.appendChild(tot);
  }

  function mkbtn(label, to, on) {
    var b = document.createElement('button');
    b.textContent = label;
    b.disabled = !on;
    b.onclick = function () { page = to; draw(); window.scrollTo(0, 0); };
    return b;
  }

  draw();
})();
</script>`;
  }

  const PAGER_CSS = `#pager{display:flex;gap:8px;align-items:center;justify-content:center;margin:24px 0 8px;font-size:13px;flex-wrap:wrap}
#pager button{background:transparent;border:1px solid currentColor;color:inherit;border-radius:999px;padding:3px 12px;cursor:pointer;font:inherit;opacity:.85}
#pager button:disabled{opacity:.3;cursor:default}
#pager select{background:transparent;color:inherit;border:1px solid currentColor;border-radius:6px;padding:3px 6px;font:inherit}
.hdr{margin:0 0 20px}
.hdr h1{margin:0 0 4px;font-size:20px;line-height:1.25;font-weight:700}
.hdr p{margin:0;font-size:13px;opacity:.65}
.hdr a{color:inherit}`;

  const CATALOG_CSS = `${PAGER_CSS}
.cat-item{display:block;padding:14px 0;border-bottom:1px solid rgba(128,128,128,.35);color:inherit;text-decoration:none}
.cat-item:hover{opacity:.85}
.cat-item:hover .who{text-decoration:underline}
.cat-item .who{font-weight:700;font-size:15px}
.cat-item .who .at{font-weight:400;opacity:.6}
.cat-item .meta{font-size:12px;opacity:.6;margin-top:2px}
.cat-item .txt{margin-top:6px;font-size:14px;line-height:1.45;white-space:pre-wrap}`;

  function headerBlock({ title, count, sourceUrl, extra = '' }) {
    return `<header class="hdr">
  <h1>${esc(title)}</h1>
  <p>${count} tweet · salvati il ${esc(new Date().toLocaleString('it-IT'))}${extra} · <a href="${esc(sourceUrl)}">apri su X</a></p>
</header>`;
  }

  function buildSinglePage(items, { title, bg, fg, sourceUrl }) {
    const body = `${headerBlock({ title, count: items.length, sourceUrl })}
${items.map(it => it.bodyHtml).join('\n')}
<p class="foot">Sorgente: <a href="${esc(sourceUrl)}">${esc(sourceUrl)}</a></p>`;
    return buildDoc({ title: `${title} (${items.length} tweet)`, bg, fg, rules: items.flatMap(i => i.rules), body });
  }

  function buildPagerPage(items, { title, bg, fg, sourceUrl, perPage }) {
    const body = `${headerBlock({ title, count: items.length, sourceUrl })}
${items.map(it => `<div class="pg-item" id="t-${esc(it.meta.id)}">${it.bodyHtml}</div>`).join('\n')}
${pagerScript(perPage)}
<p class="foot">Sorgente: <a href="${esc(sourceUrl)}">${esc(sourceUrl)}</a></p>`;
    return buildDoc({
      title: `${title} (${items.length} tweet)`,
      bg, fg, css: PAGER_CSS,
      rules: items.flatMap(i => i.rules),
      body,
    });
  }

  function buildCatalogPage(items, { title, bg, fg, sourceUrl, perPage, jsonName }) {
    const rows = items.map(it => {
      const m = it.meta;
      return `<a class="cat-item pg-item" href="${esc(it.name || it.fname)}">
  <div class="who">${esc(m.author)} <span class="at">${esc(m.handle)}</span></div>
  <div class="meta">${esc(fmtDate(m.datetime))}${metricsLine(m.metrics) ? ' · ' + esc(metricsLine(m.metrics)) : ''}</div>
  <div class="txt">${esc(excerpt(m.text, 240))}</div>
</a>`;
    }).join('\n');

    const data = JSON.stringify(items.map(i => i.meta)).replace(/</g, '\\u003c');
    const body = `${headerBlock({ title, count: items.length, sourceUrl, extra: ' · clicca un tweet per aprire il file' })}
${rows}
${pagerScript(perPage)}
<p class="foot">Indice di ${items.length} tweet${jsonName ? ` · dati completi in <code>${esc(jsonName)}</code>` : ''}</p>
<script type="application/json" id="x-data">${data}</script>`;
    return buildDoc({ title: `Indice: ${title}`, bg, fg, css: CATALOG_CSS, body });
  }

  async function saveAll({ mode = 'single', perPage = 20, max = 200, json = true, download = true, skipAds = true } = {}) {
    const first = document.querySelector('article[data-testid="tweet"]');
    const bg = forcedBg || pageBackground(first || document.body);
    const fg = luminance(bg) <= 0.5 ? '#e7e9ea' : '#0f1419';
    const query = searchQuery();
    const slug = slugify(query) || 'x';
    const sourceUrl = location.href;

    const items = await collect({ max, skipAds });
    if (!items.length) {
      console.warn('Nessun tweet raccolto: nessun file scritto');
      return { count: 0, files: [] };
    }

    const title = query || 'Tweet salvati';
    const metas = items.map(i => i.meta);
    const jsonName = json ? `dati-${slug}.json` : '';
    const files = [];

    if (mode === 'files') {
      items.forEach((it, i) => { it.name = `${String(i + 1).padStart(4, '0')}-${it.fname}`; });

      for (const it of items) {
        files.push({
          name: it.name,
          type: 'text/html',
          content: buildDoc({
            title: `${it.meta.author} ${it.meta.handle}`.trim(),
            bg, fg, rules: it.rules,
            head: `<meta name="x-source" content="${esc(it.meta.url)}">
<meta name="x-published" content="${esc(it.meta.datetime)}">
<meta name="description" content="${esc(it.meta.text)}">`,
            body: `${it.bodyHtml}
<p class="foot">Sorgente: <a href="${esc(it.meta.url)}">${esc(it.meta.url)}</a><br>Salvato il ${esc(fmtDate(it.meta.captured))}</p>`,
          }),
        });
      }
      files.push({
        name: `indice-${slug}.html`,
        type: 'text/html',
        content: buildCatalogPage(items, { title, bg, fg, sourceUrl, perPage, jsonName }),
      });
    } else {
      const content = mode === 'pager'
        ? buildPagerPage(items, { title, bg, fg, sourceUrl, perPage })
        : buildSinglePage(items, { title, bg, fg, sourceUrl });
      files.push({ name: `${slug}-${items.length}tweet.html`, type: 'text/html', content });
    }

    if (json) {
      files.push({ name: jsonName, type: 'application/json', content: JSON.stringify(metas, null, 2) });
    }

    if (download) {
      const bulk = files.length > 1;
      if (bulk) console.log('Chrome/Edge chiedera\' di consentire piu\' download: accetta una volta sola');
      for (const f of files) {
        downloadFile(f.name, f.content, f.type);
        await sleep(150);
      }
    }

    console.log(`%c${items.length} tweet salvati in ${files.length} file`,
      'background:#00ba7c;color:#000;padding:2px 6px;border-radius:4px;font-weight:600');
    return { count: items.length, files };
  }

  /* ---------------------------- interazione ---------------------------- */

  function articleAt(x, y) {
    let best = null, bestArea = 0;
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const r = a.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const area = r.width * r.height;
        if (area > bestArea) { best = a; bestArea = area; }
      }
    }
    return best;
  }

  let active = false;

  async function onClick(e) {
    if (e.button !== 0) return;
    const art = articleAt(e.clientX, e.clientY);
    if (!art) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    art.style.outline = '2px solid #f59e0b';
    try {
      const { fname, meta } = await capture(art);
      art.style.outline = '2px solid #00ba7c';
      console.log(`%c salvato ${fname}`, 'color:#00ba7c', meta.url);
    } catch (err) {
      art.style.outline = '2px solid #f4212e';
      console.error('salvataggio fallito', err);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
  }

  function start() {
    if (active) return;
    active = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    console.log('%cTweet Saver attivo — clicca i tweet da salvare, ESC per terminare',
      'background:#00ba7c;color:#000;padding:2px 6px;border-radius:4px;font-weight:600');
  }

  function stop() {
    if (!active) return;
    active = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    console.log('Tweet Saver disattivato');
  }

  async function saveVisible() {
    const seen = new Set();
    let n = 0;
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const k = tweetKey(a);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      try { await capture(a); n++; } catch (err) { console.error(err); }
      await sleep(300);
    }
    console.log(`Salvati ${n} tweet visibili`);
  }

  function setTheme(color) {
    forcedBg = color || null;
    console.log(forcedBg ? `Sfondo forzato: ${forcedBg}` : 'Sfondo: rilevato automaticamente dal tema di x.com');
  }

  window.tweetSaver = { save: capture, saveVisible, collect, saveAll, setTheme, start, stop };
  start();
})();
