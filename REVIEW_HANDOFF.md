# Pokémon app review — continuation checkpoint

Updated: 2026-10-10 (Asia/Shanghai). User: continue the previous review, especially correct card
recognition and pricing, and save all progress before session limits.

## Repository and branch

- Repository: `vincetzr/pokemon_app`.
- Working branch: `codex/recognition-pricing-correctness`.
- Base/default branch: `claude/pokemon-card-auth-pricing-rpx6ib` (`03e5b29`).
- Previously pushed checkpoint: `6004218450133a9b729a9d4386c643eec119e24d`.
- Local checkout recovered at `/workspace/scratch/23ed2e24a9fc/pokemon_app`.
- No pull request existed when this session began. Do not merge or deploy as
  part of checkpointing. Preserve unrelated changes if the checkout changes.

## Recovered work (initial checkpoint; verification in progress)

The prior session left substantial uncommitted work. This checkpoint preserves
that work before further review; it is not a declaration that all checks pass.

- Require stronger identity evidence and confirmation; distinguish competing
  printings and languages; avoid guessing a headline from the most expensive quote.
- Verified dated TCGCSV market snapshots with exact catalogue mapping, separate
  printing quotes, and explicit unspecified condition. Snapshot refresh workflow.
- Filter live listing samples by printing, language and condition; correct median
  for even samples; exclude stale/mismatched quotes from collection subtotals.
- Standalone scanner rules/pricing extracted for regression testing; preserve
  shipped descriptors when regenerating `docs/index.html` with `--reuse-corpus`.
- Recovered unit tests, five catalogue-image fixtures (downloaded, gitignored),
  browser regression script and documentation. Fixtures are reference images,
  not an independent camera-photo accuracy benchmark.

## Completed review

- Pull request: https://github.com/vincetzr/pokemon_app/pull/1
- Status: open, ready for review, mergeable; not merged or deployed.
- Verified generated code commit: `329cba3cc5fc63776f62541ef8e083009e9424f1`.
- Final successful workflow: https://github.com/vincetzr/pokemon_app/actions/runs/37962502421
- GitHub validation: all 132 tests passed with all five reference-image fixtures
  downloaded; TypeScript, Next.js production build and real Chromium UI tests passed.
- Browser checks cover printing selection, hiding unverified legacy prices, missing
  quotes, asynchronous selection races, summary wording and mobile overflow.
- The final fixes also reject conflicting set hints and weak collector-number
  readings, and exclude suspected foreign printings and graded holders from bulk totals.
- Price snapshot: TCGCSV export dated 2026-10-08; 5,197 verified catalogue identities
  out of 5,577, with 380 unavailable. Missing mappings are not guessed.

## Saving and continuing

All source and generated assets are saved on the GitHub review branch. Two large
connector uploads previously ended without confirmation. Smaller source checkpoints
succeeded, and `review-checks.yml` regenerated the 9 MB scanner and price snapshot
inside GitHub before testing the resulting commit. This avoids relying on one large
connector upload. The final follow-up commit changes this handoff only.

For subsequent work, read this file, current git status, the remote branch head and
PR state. Preserve any newer user changes. Do not restart the completed review or
claim a universal recognition accuracy from the five image fixtures. Merge or deploy
only when the user requests it. For a source edit, update scanner sources under
`scripts/`, run the focused tests and `npm run build:scanner:reuse`, checkpoint the
source branch, and verify the automated generated commit and CI before finishing.

## Important limits

- Catalogue image fixtures are not a camera-photo accuracy benchmark. The scanner
  cannot guarantee correct identification of every unknown card or printing.
- The standalone UI requires confirmation of card identity and printing before
  its price summary. Aggregate quotes have unspecified condition, not Near Mint.
- The reviewed UI tests use local captured catalogue data. Availability of the
  unofficial live listing endpoint is separate; a failed or mismatched listing
  request leaves condition prices unavailable.
- Local Chromium download failed with an invalid archive; GitHub's Chromium
  validation succeeded. Do not confuse the failed local attempt with a UI failure.
- Hosted default-branch code has not received the review changes yet. Daily price
  refresh becomes scheduled on the default branch after merging; independently
  deployed server copies must receive the updated snapshot file.


## Completed condition / slab extension (2026-10-09 UTC)

User asked for a preview artifact, condition screening similar to PSA/PCG/Beckett,
condition-specific values, slab detection, official verification links and barcode scans.
The implementation and preview are complete on the same review branch. Do not merge
or deploy unless requested.

- Final verified implementation commit: `62beb57d9aca7d1e1b34738901a1ffb61f9398c3`.
- Successful workflow: https://github.com/vincetzr/pokemon_app/actions/runs/37972902505
- All 165 unit/image tests passed on GitHub, including actual QR, Code128, Code39,
  ITF, DataMatrix and PDF417 image decoding. TypeScript and production build passed.
- Both Chromium suites passed: standalone printing/condition prices, price invalidation,
  QR/Code128/PCG links and mobile layout; production scan upload, back review, exact
  raw condition pricing, PSA certificate links and graded/raw price separation.
- GitHub artifact `pokemon-scanner-preview` (ID 11637856520) contains the portable
  HTML and UI screenshots. It is downloadable from the successful workflow run.
  A durable HTML copy was also delivered in the ChatGPT conversation.
- Preview filename: `pokemon-scanner-preview.html`. It embeds all 5,577 cards,
  the dated market snapshot, and bundled barcode readers. OCR assets and live
  offers need internet; camera access depends on browser permissions.
- Shared grading rules are in `src/lib/grading/`; both apps use the same rules.
  The production app has optional two-photo server vision and a back-whitening
  heuristic. The preview screens the back photo and requires review of all attributes.
- Raw price eligibility requires usable front/back photos, reviewed corners/edges,
  surface and creases, and user confirmation. Changes invalidate the previous quote.
- PSA, BGS, CGC and PCG slab labels/certificates support leading zeroes, valid grade
  steps and separate designations. Conflicting companies/certificates/grades require
  correction before a lookup link is shown. Beckett BVG/BCCG are not treated as BGS.
- PCG's current direct route is https://pcgpopreport.com/report/{nine-digit-certificate};
  other formats link to the official report homepage for manual review.
- Matching fresh raw offers are asking-price samples. An optional server-only
  `EBAY_APP_TOKEN` adapter filters graded asks by exact card/printing/language,
  grader, grade and designation. No token was configured here; authenticated live
  graded values were tested with fixtures rather than live requests. Standalone
  graded prices provide a sold-listings search for manual review.
- Phone estimates are broad screening ranges, not calibrated professional grades.
  No raw-price multipliers are used for graded values. Missing or mismatched data
  stays unavailable. A label read and matching certificate do not authenticate a slab.
- Setup, supported formats and limitations: `docs/GRADING.md`.
- The initial artifact upload rejected a parent-directory path after all functional
  checks passed. The workflow now creates the preview inside its workspace; artifact
  upload and the full workflow both pass.
- Final handoff-only commit is excluded from the workflow trigger. No further
  application changes are pending, and the PR remains open, not merged or deployed.

For later edits, preserve newer changes and continue from the current remote branch.
Rebuild generated scanner sources through the existing workflow rather than uploading
the 9 MB generated HTML through one connector request. Use `npm run build:preview`
to recreate the standalone deliverable; `PREVIEW_OUT` selects the output path.
