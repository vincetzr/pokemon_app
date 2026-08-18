# Pokémon Card Scanner

Point a phone camera at a Pokémon card to identify it, see what it is worth by
condition, and check it against a set of authenticity signals. Mobile-first web
app, installable to the home screen.

```bash
npm install
npm run dev          # then open http://localhost:3000
```

**To use it on your phone** (which is where the camera matters):

```bash
npm run dev:phone    # serves HTTPS on your LAN
```

Then open `https://<your-computer's-LAN-IP>:3000` on your phone and accept the
self-signed certificate warning. The HTTPS is not optional — browsers refuse
camera access on a plain-HTTP origin that isn't localhost. If you'd rather not
bother, the **Photo** button next to the shutter opens your phone's own camera
app and works over plain HTTP.

**For the authenticity checks to be worth much, set an Anthropic API key:**

```bash
cp .env.example .env.local
# add ANTHROPIC_API_KEY=sk-ant-...
```

Without it the app still identifies and prices cards, but the visual inspection
signal cannot run, and the report will say so and lower its own confidence.

---

## What it does

**Scan** — capture a card, and the app locates it in the photo, corrects the
perspective, reads its name and collector number, and resolves it to a specific
printing.

**Price by condition** — real per-condition prices read from live TCGplayer
listings: cheapest and typical asking price for Near Mint through Damaged, with
the number of listings behind each figure. Plus current market price, history
charted over time, and the listing spread.

**Check authenticity** — a set of signals scored individually, combined into a
verdict that is explicit about its own confidence and about what it could not
determine.

**Bulk scan** — work through a pile; cards are ranked by value so you can see
what deserves a closer look.

**Collection** — save cards with their condition. The collection page prices
everything each time it loads, which is also how the app accrues real price
history for the cards you care about.

---

## Two things worth understanding before you rely on it

### Authenticity checks are indicative, not proof

**This app will never tell you a card is fake, and it cannot tell you a card is
genuine.** A photograph does not carry the information needed to settle the
question. The tests that actually decide it — card thickness, the opaque core
layer visible when backlit, how the card bends and feels — all require the card
in hand.

What it does instead is run a set of measurable checks and report each one
honestly, including the ones that could not run:

| Verdict | Means |
|---|---|
| Consistent with genuine | Nothing in this photo contradicts a real card. Not proof. |
| Inconclusive | Too little could be determined. Usually the photo, not the card. |
| Red flags | Something looked wrong. A prompt to inspect closely, not a conclusion. |

The design property that matters most is **abstention**. A check that cannot run
properly — insufficient resolution, glare, a card type the check does not apply
to — contributes nothing to the verdict and is reported as "not run". It is
never silently scored as a pass or a fail. Scoring checks that the input could
not support is exactly how automated authenticators end up accusing genuine
cards, and a false accusation is a much worse failure here than an inconclusive
result: it can cost a real sale or a trade, and the user has no way to argue
with it.

Coverage is reported separately from agreement, because two checks passing
while three abstained is not the same as five passing. The agreement figure is
labelled "not a percentage genuine" in the UI for the same reason.

Some calibration examples from building this, to make the point concrete:

- The print-pattern check needs roughly 5000 pixels across the card to resolve
  the halftone screen that offset printing leaves. An earlier 1400 was derived
  from the bare Nyquist limit and was wrong in practice: measured with the app's
  own FFT on a clean synthetic screen, the energy ratio at 1400 is 1.00–1.07
  against a threshold of 1.2, so the check could not have fired on a perfect
  input. With realistic sensor grain it first clears at every ruling around
  5000. Since every photo is worked on at 4032 px on its long edge, a card
  filling the frame reaches about 2870 — so this check cannot fire on a
  whole-card photograph on any device, and says so rather than asking the user
  to move closer. Reaching it needs a close-up of part of a card, which this
  build does not take yet.
- An early blur threshold flagged the official Base Set Charizard reference
  image as "too blurry". Vintage scans are legitimately softer than modern ones
  (measured Laplacian variance 45 versus 210). The threshold was recalibrated
  against real fixtures across eras, and a regression test now guards it.

### Every price says where it came from

Each figure carries a provenance, and the UI is required to render them
differently:

| Provenance | Meaning | On a chart |
|---|---|---|
| `observed` | A marketplace reported this price | solid line |
| `recorded` | This app captured that price at a known time | solid line |
| `backfilled` | Real history from a paid third party | dashed line |
| `modeled` | Computed by us, e.g. a condition adjustment | shaded band, labelled |

A modeled figure is never drawn as a line and never becomes the headline number.
The snapshot store refuses to persist modeled values at all, so an estimate
cannot leak into the history and later be mistaken for an observation.

Currencies are never mixed. TCGplayer reports USD and Cardmarket reports EUR;
they are shown separately and never averaged or converted, because the exchange
rate would make any combined figure wrong.

---

## Configuration

All optional. See `.env.example`.

| Variable | Enables | Without it |
|---|---|---|
| `POKEMONTCG_API_KEY` | Higher rate limits | Works, but bulk scanning throttles |
| `ANTHROPIC_API_KEY` | Claude vision reading and the vision authenticity signal | On-device OCR only; vision signal absent and confidence lowered accordingly |
| `DATABASE_PATH` | Where the local database lives | `./data/prices.db` |

### Building price history

The scanner build ships about two and a half years of real observed prices,
backfilled from the TCGCSV daily archive of TCGplayer's own price endpoint
(`npm run backfill:history` → `scripts/backfill-tcgcsv-history.mjs`). It
matches on `productId`, which is an exact join: 5,519 of 5,521 corpus cards
carry one that the archive knows.

An earlier "history" built by spreading Cardmarket's 1/7/30-day rolling
averages across invented dates has been removed. The figures were real but the
dates were not — a 30-day mean is not an observation from 15 days ago — and it
would have drawn a fabricated three-point line beside a measured two-year one.

Run the snapshot job daily to extend the series past the archive's cutoff:

```
0 6 * * *  cd /path/to/app && npm run snapshot >> snapshot.log 2>&1
```

It is idempotent — snapshots are unique per card, variant, condition, source and
day — and sweeps failures through several passes, because a missed day is a
permanent hole that cannot be backfilled later.

---

## How it works

```
photo
  ↓  detect card quadrilateral      Otsu threshold, largest component,
  ↓                                 corners along the diagonals
  ↓  perspective rectification      homography solve + bilinear resample
  ↓                                 → canonical 1500px card
  ↓  capture quality gate           sharpness, glare, exposure
  ├─→ identify                      OCR + Claude vision, merged per field
  │     ↓  resolve printing         name + collector number + set total
  │     ↓  price                    TCGplayer / Cardmarket, snapshot recorded
  └─→ authenticity signals          each scores or abstains
        ↓  combine                  weighted over signals that ran;
                                    confidence = share of analysis achieved
```

Identification merges OCR and vision **per field** rather than picking a winner
per photo, because each is better at a different part of the card: OCR reads the
large name text reliably and cheaply, while vision handles the small collector
line and stylised full-art fonts. Agreement between them raises confidence above
either alone; disagreement takes the vision reading but caps confidence, so a
conflict never produces a confident answer.

### Layout

```
src/lib/
  types.ts              domain types; provenance is enforced here
  tcg-api.ts            Pokémon TCG API client
  tcg-cache.ts          SQLite cache with stale-fallback during outages
  db.ts                 snapshots, collection, response cache
  card-geometry.ts      physical card specs and resolution tiers
  image/                rectification and capture-quality assessment
  identify/             OCR, vision, candidate resolution, merge pipeline
  auth/                 signal engine and individual signals
  pricing/              quotes, history assembly, ranking
  vision/               Claude client, degrades to null without a key
src/app/                routes and pages
scripts/                fixture download, daily snapshot job
```

### Tests

```bash
npm test          # unit tests
npm run typecheck
```

Tests that need card images skip cleanly when the fixtures are absent. To fetch
them:

```bash
npx tsx scripts/fetch-fixtures.ts
```

The fixture set deliberately spans eras — WOTC-era holo and non-holo, a modern
full-art V, a rainbow rare, and a current Scarlet & Violet card — because
several signals behave very differently across them, and a fixture set covering
one era would hide that.

---

## Known limitations

- **The upstream card API is unreliable.** Measured during a bad spell it
  succeeded on about 3 requests in 10, and `pageSize=250` returns 404 despite
  being the documented maximum. The app retries with jitter, caches every
  success, and serves stale data during an outage rather than reporting that a
  card does not exist.
- **Collector-number OCR is imperfect.** On-device OCR reads the collector line
  correctly on roughly two thirds of cards; it is the smallest text on the card
  and its position moves between eras. Claude vision covers most of the rest,
  and manual search is always available.
- **The local database assumes a persistent filesystem.** On ephemeral
  serverless hosts it resets on cold start — point `DATABASE_PATH` at a mounted
  volume, or run the snapshot job somewhere durable.
- **Price history does not reach a card's release.** The TCGCSV archive begins
  2024-02-08 for English cards and carries no Japanese price rows until
  2025-01-07 — the 2024-09-16 date that circulates for Japanese is when the
  group directories were created and they are empty. No free source goes back
  further, and the chart says where the record starts rather than drawing a line
  to a 1999 release. PriceCharting was evaluated and rejected: its terms forbid
  using price data in any app accessible to third parties, including at the paid
  tier, which grants internal business use only.
- **No graded prices.** PSA's public API is a cert lookup, eBay's sold-listing
  data is a restricted API that forbids redistribution and needs a client secret
  a public page cannot hold, and Beckett has no public API. Every line on the
  chart is an ungraded card and the page says so.
- **Cardmarket figures lag.** Measured on this app's own snapshots, Cardmarket
  data was 40–50 days old while TCGplayer was 2 days old. Both are labelled with
  the date they refer to, and a stale source is called out in the UI.
