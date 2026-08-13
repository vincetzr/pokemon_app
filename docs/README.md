# The standalone scanner

`index.html` is the whole scanner in one file — camera, card detection,
authenticity checks, 2,023 baked cards with prices, and the matcher. No
server, no network at run time.

## Why this exists as a file

The live viewfinder needs `getUserMedia`, and a page only gets a camera if
the page it is embedded in grants one. Embedded in a chat panel or a preview
frame, it never will, and nothing inside the page can change that — the
permission belongs to the outer page. Served as a page in its own right over
HTTPS, the browser asks the user directly and the scanner works: alignment
frame, live coaching, automatic capture when the card sits square and still
inside the frame.

## Serving it

GitHub Pages, from this `docs/` folder — Settings → Pages → Source: *Deploy
from a branch*, then pick the branch and `/docs`. It lands at
`https://<owner>.github.io/pokemon_app/`.

Anything that serves a static file over HTTPS works equally well. HTTPS is
not optional: browsers only expose a camera on a secure origin.

Add it to the Home Screen and it opens without browser chrome, which is how
the viewfinder gets the whole screen.

## The document head

`index.html` is a complete document — doctype, charset, viewport, icon. That
sounds like boilerplate and is not: the page began life as an artifact body,
where the platform supplies all of it at publish time. Served as a file of its
own, nothing does, and a browser with no doctype lays the page out in quirks
mode against a 980px viewport — on a tablet, the whole scanner rendered
shrunk into a corner. `test-served.mjs` measures `document.compatMode` and the
layout width over HTTP rather than trusting the markup.

## Rebuilding it

The file is generated, not hand-edited. Edit `scripts/scanner-template.html`,
which is the page with a `__CORPUS__` placeholder where the data island goes.

    npm run bake            # the Pokemon TCG API      → /tmp/bake/corpus.json
    npm run bake:catalogue  # the TCGplayer catalogue  → /tmp/bake/tcgcsv.json
    npm run build:scanner   # template + corpora       → docs/index.html

Both bakes are slow and resumable, and both write where `BAKE_OUT` points if
you would rather they did not use `/tmp`; `build:scanner` reads from
`BAKE_DIR`. The second bake is not optional in practice — it is the only
source of Japanese printings and of Base Set (Shadowless), which TCGplayer
keeps as its own group with its own product ids and so its own prices. A
build without it is short about a quarter of the cards, and says so.

Given the same two corpora the build is byte-for-byte reproducible.
