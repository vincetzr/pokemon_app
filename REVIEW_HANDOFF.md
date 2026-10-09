# Pokémon app review — continuation checkpoint

Updated: 2026-10-09. User: continue the previous review, especially correct card
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

## Current status

All reviewed source files are now saved on GitHub. The large generated scanner
and daily price snapshot were regenerated directly on the review branch by
GitHub Actions, avoiding a stalled multi-megabyte connector upload.

- Generated checkpoint: `c98cfe5408e7accf45858966d559685e3803650d`.
- Successful workflow: https://github.com/vincetzr/pokemon_app/actions/runs/37961922683
- That workflow passed fixture download, all 130 tests, TypeScript, the Next.js
  production build, browser installation and the real Chromium UI regression.
- Additional review fixes require a matching set hint even when the denominator
  matches, retain collector OCR confidence, and exclude suspected foreign
  printings and graded holders from automatic bulk subtotals.
- Latest local test run after the set/collector fixes: 132 passed; typecheck passed.
- Price snapshot: TCGCSV export dated 2026-10-08; 5,197 verified catalogue identities
  out of 5,577, with 380 unavailable. Missing mappings are not guessed.

## Continue here

1. Check current GitHub review-branch head and any open PR; do not overwrite a
   newer commit. Local changes may await the final source checkpoint.
2. Save the additional fixes, let `review-checks.yml` regenerate the scanner and
   verify the resulting commit, and confirm the run succeeds.
3. Open a reviewable pull request to `claude/pokemon-card-auth-pricing-rpx6ib`.
   Do not merge or deploy without a subsequent instruction.
4. Record the final PR URL and validation result here, then report them to the user.

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
