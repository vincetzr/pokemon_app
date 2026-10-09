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

## Continue here

1. Read this file, `git status`, recent commits, and current branch/PR state.
2. Run `npm test`, `npm run typecheck`, `npm run build`, and
   `npm run test:scanner:browser`; record actual outcomes below.
3. Audit recognition acceptance through scan/bulk/manual correction and pricing
   selection through snapshots/listings/history/collection. Add focused
   regressions for substantive defects, then fix them.
4. Edit scanner sources under `scripts/`; regenerate with
   `npm run build:scanner:reuse`. Do not rebake or recompress the corpus casually.
5. Update this handoff with defects, tests, limitations and next actions; commit
   and push the review branch before ending. A clean local commit alone is not
   durable enough. Verify the remote head through GitHub.

## Validation log

- Initial recovery: remote branch still at `6004218`, default still `03e5b29`.
- Local verification completed: 130 tests passed (including all downloaded image fixtures), typecheck passed, Next.js production build passed.
- Browser checks remain pending: Playwright browser download returned a truncated/invalid archive; no browser executable is installed.
- Two connector attempts to upload the 9 MB generated scanner ended without confirmation. Source files are being checkpointed first; `review-checks.yml` regenerates the large files on the review branch and then runs full verification on that generated commit.
- GitHub upload is not yet confirmed beyond `6004218`; verify the remote head rather than assuming local commits are pushed.
- Camera accuracy, condition-specific live prices and freshness must not be
  claimed solely on the basis of mock tests or catalogue-image fixtures.

## Open limitations

- The initial conversation-history lookup failed. Recovered the actual checkout
  and compared its branch against GitHub instead.
- Hosted default-branch code has not received the review changes yet.
- Any external network or provider failure must be recorded, not presented as a
  successful live-data validation.
