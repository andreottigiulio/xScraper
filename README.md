# xScraper

Salva tweet da X in file HTML **autonomi** che mantengono l'aspetto originale: tema scuro/chiaro, tipografia, spaziature, immagini incorporate. Funziona dalla console DevTools del browser, quindi usa la tua sessione già autenticata: niente estensioni, niente driver di automazione, niente API key.

![nessuna dipendenza](https://img.shields.io/badge/dipendenze-nessuna-00ba7c)

## Cosa fa

- **Tweet singoli** con un click.
- **Ricerche e hashtag**: scorre i risultati, cattura i tweet man mano che X li carica nel DOM (la timeline è virtualizzata), deduplica e si ferma da solo.
- **Tre formati di salvataggio**: un file per tweet + indice impaginato, un file unico, un file unico impaginato.
- **Immagini incorporate** in base64 (avatar, foto, emoji): il file si apre anche offline.
- **Metadati** in `<meta>` e in un JSON separato (autore, handle, data, testo, metriche, URL).
- **Tema ereditato** da X: se usi "Lights out" il file è nero, se usi "Dim" è blu scuro, se usi il tema chiaro è bianco.

## Requisiti

Un browser basato su Chromium (Chrome, Edge). Nient'altro: lo script è un singolo file JavaScript.

## Avvio rapido

1. Apri [x.com](https://x.com) e accedi con il tuo account.
2. Apri la console: `F12` → tab **Console**.
3. Se il browser blocca l'incolla (protezione anti self-XSS), digita `allow pasting` e premi Invio.
4. Apri [`x-tweet-save.js`](x-tweet-save.js), copia tutto il contenuto e incollalo nella console, poi Invio.
5. Clicca i tweet da salvare. `ESC` per terminare.

Ogni tweet scarica `x-<handle>-<id>.html`.

## Salvare tutti i risultati di una ricerca

Apri la ricerca (es. `#tekken6`), scegli la tab **Ultimi** — con "Top" ottieni solo i tweet che X decide di mostrare — poi in console:

```js
await tweetSaver.saveAll({ mode: 'single' })              // un solo file con tutti i tweet
await tweetSaver.saveAll({ mode: 'pager', perPage: 20 })  // un file unico, impaginato
await tweetSaver.saveAll({ mode: 'files' })               // un file per tweet + indice + json
```

| `mode` | Cosa scarica |
| --- | --- |
| `single` | `tekken6-312tweet.html` — tutti i tweet in sequenza |
| `pager` | `tekken6-312tweet.html` — tutti i tweet con pager (10/20/50/100 per pagina) |
| `files` | `0001-x-player-<id>.html` … `0312-…`, più `indice-tekken6.html` (elenco impaginato con link ai file) e `dati-tekken6.json` |

### Opzioni

| Opzione | Default | Significato |
| --- | --- | --- |
| `max` | `200` | Numero massimo di tweet da raccogliere |
| `perPage` | `20` | Tweet per pagina in `pager` e nell'indice di `files` |
| `json` | `true` | Scarica anche il file `dati-<query>.json` |
| `download` | `true` | Se `false` restituisce i file senza scaricarli |
| `skipAds` | `true` | Esclude i tweet sponsorizzati |

Durante la raccolta:

- `ESC` interrompe lo scroll e salva quello che ha già raccolto.
- La console mostra il conteggio aggiornato dei tweet raccolti.
- Se X va in rate limit e non arrivano più tweet, il ciclo si ferma da solo dopo qualche tentativo.

> **Nota sui download multipli.** In modalità `files` il browser scarica molti file: Chrome/Edge chiederanno una volta *"consentire il download di più file?"* — accetta, altrimenti salva solo il primo. I link dell'indice sono relativi, quindi tieni tutti i file nella stessa cartella.

## Tema dello sfondo

Lo sfondo segue automaticamente il tema attivo su X. Per forzarlo:

```js
tweetSaver.setTheme('#000000')  // nero
tweetSaver.setTheme('#15202b')  // dim
tweetSaver.setTheme(null)       // torna al rilevamento automatico
```

Per un singolo salvataggio: `tweetSaver.save(el, { bg: '#000000' })`.

## API

Tutto vive in `window.tweetSaver`:

| Comando | Descrizione |
| --- | --- |
| `save(article, opts)` | Salva un singolo tweet (elemento `<article data-testid="tweet">`) |
| `saveVisible()` | Salva i tweet attualmente nel DOM, ognuno in un file |
| `collect(opts)` | Scorre e raccoglie i tweet, restituisce l'array senza scrivere file |
| `saveAll(opts)` | Raccolta + export nella modalità scelta |
| `setTheme(color)` | Forza il colore di sfondo degli export |
| `stop()` / `start()` | Attiva/disattiva la modalità "clicca per salvare" |

## Come funziona

Per ogni tweet lo script clona il nodo DOM, copia su ogni elemento gli stili *calcolati* (`getComputedStyle`) come stile inline, ricostruisce i pseudo-elementi `::before`/`::after`, converte le immagini in data URL e raccoglie i metadati. Il risultato non dipende più dai CSS di X: un singolo file HTML che si apre offline e resta identico anche quando il sito cambia.

Per le ricerche, il punto chiave è che X tiene nel DOM solo una decina di tweet alla volta: lo script scorre, cattura quelli visibili, deduplica per status ID e ripete finché non arrivano più tweet nuovi.

## Limiti

- **Video e GIF**: la sorgente è un `blob:` non recuperabile; viene salvato il poster come immagine.
- **Font Chirp**: è proprietario e servito da una CDN cross-origin, non viene incorporato; si usa lo stack di sistema (resa molto simile, non identica).
- **Tweet lunghi**: nel timeline X tronca il testo nel DOM ("Mostra altro"). Per il testo completo apri la pagina di dettaglio del tweet prima di salvare.
- **Layout congelato**: la larghezza è quella che il tweet aveva al momento del salvataggio.
- **Selettori**: dipendono dal DOM attuale di X; se il sito cambia struttura lo script va aggiornato.
- **Immagini**: se la CDN nega la richiesta, resta l'URL assoluto (il file funziona, ma solo online).

## Uso responsabile

Pensato per archivi personali (tweet che vuoi conservare o citare). Rispetta i termini di servizio di X, non ridistribuire contenuti altrui e non fare richieste massive: la raccolta è volutamente lenta per non sovraccaricare il servizio.

## Struttura del repository

```
x-tweet-save.js          lo script da incollare in console
test/mock-x.html         pagina di prova: un tweet realistico
test/mock-search.html    pagina di prova: ricerca con scroll infinito
```

## Test in locale

Apri `test/mock-search.html` nel browser: simula una ricerca con caricamento progressivo. Apri la console (lo script è già incluso) e prova:

```js
await tweetSaver.saveAll({ mode: 'pager', max: 20, download: false })
```

Restituisce i file generati senza scaricarli, utile per verificare le modifiche.

## Licenza

[PolyForm Noncommercial 1.0.0](LICENSE) © 2026 andreottigiulio

Puoi usare, modificare e condividere il codice per scopi **personali e non commerciali** (archivio privato, studio, ricerca, progetti amatoriali). L'**uso commerciale non è consentito** senza un accordo separato con l'autore: se ti serve, apri una issue sul repository.
