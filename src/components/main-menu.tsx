"use client";

import Link from 'next/link';
import { LEVELS } from '@/lib/levels';

export function MainMenu() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Ambient backdrop: radial neon glow + faint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 600px at 70% -10%, hsl(328 100% 69% / 0.18), transparent 60%), radial-gradient(900px 500px at 10% 110%, hsl(276 100% 70% / 0.20), transparent 55%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(0 0% 100%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-16">
        <header className="mb-14">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.45em] text-accent">
            Stellar Simulations
          </p>
          <h1 className="text-6xl font-black leading-none tracking-tight sm:text-7xl">
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              SPACE RACE
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">
            Pick a circuit, then tune your machine in the hangar. Aftertouch arcade racing
            across procedural worlds.
          </p>
        </header>

        <section aria-labelledby="tracks-heading" className="mb-12">
          <h2
            id="tracks-heading"
            className="mb-5 font-mono text-xs uppercase tracking-[0.35em] text-muted-foreground"
          >
            Select a track
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {LEVELS.map((lvl) => (
              <Link
                key={lvl.id}
                href={`/levels/${lvl.id}`}
                className={`group relative overflow-hidden rounded-xl border border-border bg-gradient-to-br ${lvl.accent} p-5 transition hover:border-accent hover:shadow-[0_0_30px_-8px_hsl(328_100%_69%/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent/80">
                  Circuit
                </span>
                <h3 className="mt-1 text-xl font-bold">{lvl.name}</h3>
                <p className="mt-2 text-xs leading-relaxed text-foreground/70">{lvl.tagline}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">
                  Race ›
                </span>
              </Link>
            ))}
          </div>
        </section>

        <nav className="mt-auto flex flex-wrap gap-4">
          <Link
            href="/hangar"
            className="rounded-lg border border-primary/60 bg-primary/10 px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/20 hover:shadow-[0_0_24px_-6px_hsl(276_100%_70%/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ⚙ Enter the Hangar
          </Link>
        </nav>
      </div>
    </main>
  );
}
