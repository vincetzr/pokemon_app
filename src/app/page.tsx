import Link from 'next/link';
import { visionAvailable } from '@/lib/vision/client';

export default function HomePage() {
  const vision = visionAvailable();
  const hasTcgKey = Boolean(process.env.POKEMONTCG_API_KEY);

  return (
    <div className="px-4 pt-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Pokémon Card Scanner</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-300">
          Point your camera at a card to identify it, see what it&rsquo;s worth by condition, and
          check it against a set of authenticity signals.
        </p>
      </header>

      <div className="grid gap-3">
        <Action
          href="/scan"
          title="Scan a card"
          body="Identify one card, price it, and run the authenticity checks."
          accent
        />
        <Action
          href="/bulk"
          title="Bulk scan"
          body="Work through a pile and rank it by value, so you know what's worth a closer look."
        />
        <Action
          href="/collection"
          title="Collection"
          body="Cards you've saved, with prices that keep updating."
        />
      </div>

      <section className="mt-10 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
        <h2 className="text-sm font-semibold text-ink-100">What this can and can&rsquo;t tell you</h2>
        <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-ink-300">
          <li className="flex gap-2.5">
            <Dot tone="good" />
            <span>
              <strong className="font-medium text-ink-200">Identification and pricing are solid.</strong>{' '}
              Prices come from TCGplayer and Cardmarket, and are labelled with where each figure came
              from and when.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Dot tone="warn" />
            <span>
              <strong className="font-medium text-ink-200">Authenticity checks are indicative, not proof.</strong>{' '}
              A photo cannot establish that a card is genuine. The checks flag things worth a closer
              look and say plainly what they could not determine.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Dot tone="bad" />
            <span>
              <strong className="font-medium text-ink-200">Never used to declare a card fake.</strong>{' '}
              The decisive tests need the card in hand. For anything valuable, use a professional
              grading service.
            </span>
          </li>
        </ul>
      </section>

      {(!vision || !hasTcgKey) && (
        <section className="mt-4 rounded-xl border border-ink-800 bg-ink-900/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Running with reduced capability
          </h2>
          <ul className="mt-2.5 space-y-1.5 text-[13px] text-ink-300">
            {!vision && (
              <li>
                No <code className="font-mono text-[12px] text-ink-200">ANTHROPIC_API_KEY</code> —
                identification uses on-device text recognition only, and the vision authenticity
                signal is unavailable.
              </li>
            )}
            {!hasTcgKey && (
              <li>
                No <code className="font-mono text-[12px] text-ink-200">POKEMONTCG_API_KEY</code> —
                card lookups are rate limited, which mainly affects bulk scanning.
              </li>
            )}
          </ul>
          <p className="mt-2.5 text-xs text-ink-400">
            Everything still works; see <code className="font-mono">.env.example</code>.
          </p>
        </section>
      )}
    </div>
  );
}

function Action({
  href,
  title,
  body,
  accent,
}: {
  href: string;
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-4 transition-colors ${
        accent
          ? 'border-bolt-500/40 bg-bolt-500/10 hover:bg-bolt-500/15'
          : 'border-ink-800 bg-ink-900/60 hover:bg-ink-850'
      }`}
    >
      <div className={`text-[15px] font-semibold ${accent ? 'text-bolt-400' : 'text-ink-100'}`}>
        {title}
      </div>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-300">{body}</div>
    </Link>
  );
}

function Dot({ tone }: { tone: 'good' | 'warn' | 'bad' }) {
  const color =
    tone === 'good' ? 'bg-good-500' : tone === 'warn' ? 'bg-warn-500' : 'bg-bad-500';
  return <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color}`} aria-hidden />;
}
