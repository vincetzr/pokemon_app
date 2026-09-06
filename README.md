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

The report answers two questions — what is it worth, and is it real — and puts
the price, its chart and the authenticity checks first. Everything else (the
capture, the candidate list, the individual signals and their limits) is folded
away behind one disclosure, which opens by itself when the card could not be
identified. The price names the card it is for, with a "not this card?" control
beside it, because a price for the wrong printing is worse than no price.

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

### Matching in the standalone scanner

The single-file scanner has no OCR and no network, so it identifies a card by
correlating it against descriptors for every card baked into the page. Six terms
compare the card as a picture (two difference hashes, a colour signature, and
masked rank correlations over the whole card, the art window and a coarse grid);
three more compare it as a **document** — the name line, the attack block, and
the bottom strip carrying the set symbol, number and rarity.

Those three cost nothing extra: the baked `gr` descriptor is already a 16×22
rank grid over the whole card, so each band is a slice of rows both sides
already have. They matter because averaged into one whole-card correlation the
written bands are a minority of the cells and are outvoted by artwork — which is
exactly backwards for the case that matters most, two printings that share
artwork and differ only in what is printed on them.

Measured over 47 cards under seven degradations — perspective, crop error,
colour cast, gamma, JPEG, blur, and specular glare in four different *places*:

| | right | asserted right | asserted wrong |
|---|---|---|---|
| picture terms only | 278/329 | 82 | 0 |
| with the written bands | **300/329** | **95** | **0** |

All three bands rather than the best one, because a single band wins on paper
only until the lamp lands on it: weighting the attack block alone scored best
while the glare sat over the artwork and began asserting falsehoods as soon as
the glare was moved onto the text. Three bands in different parts of the card
mean a highlight can erase one and the others still speak, which is why the
worst case — a wide lamp across the whole card — improves most, 23/47 to 34/47.

### What the percentage means

The candidate list shows a probability, not a similarity, and the figures sum
to 100% across the list plus whatever mass belongs to cards not on it. They are
a softmax over all 5,577 scores, and its temperature is **fitted, not chosen** —
over 336 readings of known cards, at `MATCH_TEMPERATURE = 0.0035` a stated
confidence of 90% or more is right about 97 times in 100, and 22 of the 29
wrong reads are shown below that bar. It never prints more than 99%.

Expected calibration error alone would pick a much lower temperature, which
displays 100.0% on essentially every scan — ECE is minimised by a degenerate
always-certain predictor whenever accuracy is high, and that is the display
this replaced rather than an improvement on it. 0.0035 stays within 0.006 Brier
of the optimum while still saying when it is unsure.

The same 90% is the bar the rest of the page uses to decide whether to assert a
printing, so the candidate list and the summary cannot contradict each other.

Two thresholds are scaled by `REGION_NORM` because they compare match scores,
which the renormalisation compresses: `CONFIDENT_MATCH_MARGIN`, which decides
whether the match may settle which way up the card is. `LAYOUT_MARGIN` is not,
because it compares inkiness fractions and is on no such scale. Getting that
wrong shows the card upside down: over 48 cards read both ways up, the unscaled
threshold was right 95/96 and the scaled one 96/96, and real photographs
separate less cleanly than fixtures do.

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

## Grading readiness

The app measures two of the four things a grader scores, and refuses to add
them up into a grade.

**Centering** gives a *ceiling*, which is a different and much safer claim than
a prediction. PSA publishes its front tolerances (55/45 for a 10, then 60/40,
65/35, 70/30), so a card measured at 62/38 **cannot** be a 10 no matter what
else is true of it. That is arithmetic on a published rule, and every other
attribute can only pull the grade down from there. The panel says "on centering
alone this card could still be a PSA 9", never "this card will grade 9".

**Edge and corner wear** is measured as ink density lost at the outer border,
referenced against the same border where it meets the artwork. The card is its
own reference, so exposure, white balance and the colour of the border all
cancel. Distance from paper white is the measure — not chroma, because a black
border has none to lose, and not luminance, because a pale border is already
light without being damaged.

Three things can fake it, and each one broke a draft of this before the
measurement was tightened:

| what fakes wear | why | what stops it |
|---|---|---|
| a uniformly pale border | pale ink looks like lost ink | wear is a **gradient**, a pale border is **flat** |
| the rounded corner | the band isn't full width inside the ~3mm die-cut radius | corner scans start 7% along the edge and inherit the band width from the adjacent edge |
| a pale background | cloth carries *less* ink than a yellow border, so leaving the card looks like losing it | the cut edge is a **step** (~30 ink units per pixel); wear is a **slope** (~5) |

Measured over six synthetic cards, the three readings that must stay quiet — a
clean card, a pale-bordered card, and a blurred card — peak at 0.188, while
light wear reads 0.58 and heavy wear 0.82. The reporting threshold sits at 0.30,
in the middle of that gap and nearer the quiet end: a false accusation against
an intact card costs a submission fee, a missed one costs a second look. Before
the fixes above, an intact pale-bordered card read 0.56 at three corners and an
intact Charizard on cloth read 0.48.

### Why it stops there

Not because of resolution, which is the intuitive answer and the wrong one:

| | µm per pixel | px across a card |
|---|---|---|
| TAG (patent US10146841B2, ~1200 ppi) | 21.2 | 2,976 |
| AGS (13,440,000 px per face) | 20.3 | 3,102 |
| a phone, card filling a 4032px frame | 21.8 | 2,887 |

A phone resolves a card as finely as the machines do. What it lacks is
*control of the light*. TAG photographs a card under seven to nine separate
lighting conditions inside a closed housing and reads defects from how light
diffracts off them; AGS scans with a laser for the height of every point on the
surface. Scratches, dents, creases and soft corners are all changes in **shape**,
and one photograph under whatever light was in the room cannot see shape. PSA,
for its part, bought Genamint in 2021 and stated plainly that it was *assisting*
human graders, not replacing them.

Which is why surface, creases and the back of the card are named as unmeasured
rather than estimated, and why nothing here is summed into a number.

## Known limitations

- **A card held too close cannot be detected as too close, only diagnosed
  afterwards.** The live focus gate is relative — it asks whether the reading
  has settled against its own recent best — and a uniformly soft image settles
  perfectly well. Measured on a feed blurred throughout, the gate reported
  "focusing" for four ticks and then locked. So the viewfinder cannot tell
  "soft because the lens is past its near limit" from "soft"; only the
  calibrated sharpness check after rectification can, which is why the warning
  is raised from captures that came back unusable rather than from the frame.
- **Detection loses a card that fills almost the whole frame.** Measured on a
  1080×1440 feed, fill against the guide reads 1.11 at 0.86 of the frame height
  and 1.22 at 0.90, then collapses to 0.48 at 0.93: with no background margin
  the contour search locks onto the art box instead of the card. Anything keyed
  on a high fill therefore stops working in the very regime it is meant to
  catch.
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
