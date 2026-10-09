# Condition, slab and barcode scanning

Scan the front, confirm its exact catalogue identity, add a clear back photo,
then review corners, edges, surface and creases on both sides. The browser screens
back-border whitening; the Next server can also inspect both photos when
`ANTHROPIC_API_KEY` is configured. Observations require user review. Blur, glare,
darkness, insufficient source resolution or a holder block automatic condition
pricing. Never estimate a bare-card condition through slab plastic.

Numeric ranges are broad **screening estimates**, not official grades or
calibrated predictions of PSA, Beckett, CGC or PCG submissions. Hidden dents,
restoration and graders’ judgment can change a result. Gem Mint 10, Pristine and
Black Label are not predicted from phone photos. Centering can restrict a
screening range but never changes a raw marketplace condition or its price.

## Slabs and codes

Choose Graded slab and include the whole holder and label. For small or reverse
codes, use Scan label / barcode with a close photo. QR, Code 128, Code 39, ITF,
Data Matrix and PDF417 are decoded from actual pixels; native BarcodeDetector
is used when available. QR/jsQR and ZXing decoding are bundled. Label OCR needs
Tesseract language assets and has a timeout, with manual entry when unavailable.
The original photograph is kept for the label; the inner card is cropped for
identity, and proportions/print checks hidden by plastic abstain.

Review the company, overall grade, designation and certificate. Subgrades and
autograph grades are excluded; leading zeroes are preserved. A numeric code does
not establish a company; UPC/EAN retail codes are not certificates. Conflicting
reads are shown. Only official certificate URLs are used; arbitrary QR links
are not opened or fetched. A decoded code or matching record does **not**
authenticate a holder. Compare the card, label, grade and official holder images.

- [PSA lookup](https://www.psacard.com/cert) and
  [standards](https://www.psacard.com/gradingstandards). Half grades through 8.5
  are supported; PSA does not use 9.5.
- [Beckett lookup](https://www.beckett.com/grading/card-lookup) and
  [scale](https://www.beckett.com/grading/scale). Online lookup was in maintenance
  at the October 2026 review; the app does not bypass the outage.
- [CGC lookup](https://www.cgccards.com/certlookup/) and
  [scale](https://www.cgccards.com/card-grading/grading-scale/). Gem Mint and
  Pristine are distinct designations.
- [PCG Cert Lookup & Pop Search](https://pcgpopreport.com/) and
  [standards](https://premiercardgrading.com/pages/grading-standards). The app
  uses the verified `/report/{cert}` route for nine-digit certificates, including
  leading zeroes. Other certificate formats link to the search form.

## Prices

Raw offers must match card, printing, English language and reviewed condition.
Returned rows are filtered, the even median is averaged correctly, and samples
older than 24 hours are excluded. Missing or failed condition offers stay
unavailable. No market aggregate or arbitrary multiplier is substituted. Asking
amounts exclude shipping/tax and are not completed sales. The static browser
tries the public TCGplayer endpoint; CORS or service changes can block it.

The Next server has an optional official eBay Browse adapter. Set an application
token as `EBAY_APP_TOKEN` on the server, never in the preview. It requires
seller-provided card/set/number/language/printing aspects and structured company
and grade descriptors, preserves designations/qualifiers, excludes mismatches,
and reports a bounded active USD fixed-price sample with offer links. Missing
metadata excludes an offer. Provider filtering is tested with shaped fixtures;
live authenticated validation requires a configured token. Browse offers are
active asks, not sold prices. Both apps provide graded sold-comparable links for
manual review. Without an exact graded feed, no slab dollar value is shown.
Photo screening ranges are never passed off as certified grades in this feed.

[eBay Browse](https://www.developer.ebay.com/develop/api/buy/browse_api) requires
an application token. The
[getItem contract](https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem)
describes item aspects and grading descriptors.

## Portable preview

Run `npm run build:scanner:reuse`, then `npm run build:preview` to produce a
single HTML file with every shipped card and the dated market snapshot.
Barcode readers and image measurements are bundled. OCR language assets,
official/reference links, optional AI and live offers need internet. Camera
access depends on secure-context and embedding permissions; upload works when
the camera is denied. Synthetic code fixtures and catalogue references are
not a benchmark of real camera photos or professional grading accuracy.
