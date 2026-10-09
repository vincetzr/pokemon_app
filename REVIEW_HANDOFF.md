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
