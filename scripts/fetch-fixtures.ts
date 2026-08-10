/**
 * Download official card images used as test fixtures.
 *
 * These are not committed — they are ~5MB of third-party artwork, and the tests
 * that need them skip cleanly when they are absent. Run `npx tsx
 * scripts/fetch-fixtures.ts` to populate `test-fixtures/cards/`.
 *
 * The set spans eras and layouts on purpose: WOTC-era holo and non-holo, a
 * modern V with a full-art frame, a rainbow rare, and a Scarlet & Violet card.
 * Several authenticity signals behave very differently across these, and a
 * fixture set that only covered one era would hide that.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_IDS = [
  'base1-2',    // Blastoise      - WOTC holo, classic yellow border
  'base1-4',    // Charizard      - WOTC holo, the most counterfeited card there is
  'base1-58',   // Pikachu        - WOTC common, non-holo baseline
  'xy7-54',     // XY-era         - mid-generation layout
  'sm12-241',   // SM secret rare - gold/textured
  'swsh45-18',  // Cinderace V    - modern full-art frame, no yellow border
  'swsh4-188',  // Pikachu VMAX   - rainbow rare, textured
  'sv3pt5-6',   // SV 151         - current-era layout and silver border
] as const;

const OUT_DIR = join(process.cwd(), 'test-fixtures', 'cards');

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const id of FIXTURE_IDS) {
    const dest = join(OUT_DIR, `${id}.png`);
    if (existsSync(dest)) {
      console.log(`  skip  ${id} (already present)`);
      continue;
    }

    try {
      const metaRes = await fetch(`https://api.pokemontcg.io/v2/cards/${id}`, {
        headers: process.env.POKEMONTCG_API_KEY
          ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY }
          : {},
      });
      if (!metaRes.ok) throw new Error(`API ${metaRes.status}`);

      const { data } = (await metaRes.json()) as { data: { images: { large: string }; name: string } };
      const imgRes = await fetch(data.images.large);
      if (!imgRes.ok) throw new Error(`image ${imgRes.status}`);

      writeFileSync(dest, Buffer.from(await imgRes.arrayBuffer()));
      console.log(`  ok    ${id.padEnd(12)} ${data.name}`);
    } catch (err) {
      console.error(`  FAIL  ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nFixtures in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
