"use client";

import type { ShowcaseCard } from "@albusforge/schema";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PulseDot } from "@/components/ui";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";
import { SchematicChain } from "./SchematicChain";

export type CarouselCard = Omit<ShowcaseCard, "last_reading_at"> & { age: string };

const STEP_PX = 360; // 340px card + 20px gap
const ADVANCE_MS = 3500;
const PADDING_CARDS = 3;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true, // no auto-advance until hydrated
  );
}

export function DeviceCarousel({ cards }: { cards: CarouselCard[] }) {
  const positions = cards.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (paused || reducedMotion || positions < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % positions), ADVANCE_MS);
    return () => clearInterval(timer);
  }, [paused, reducedMotion, positions]);

  if (positions === 0) return null;

  const go = (i: number) => setIndex(((i % positions) + positions) % positions);
  const track = [...cards, ...cards.slice(0, PADDING_CARDS)];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Live devices built by people like you"
      className="mt-16 w-full max-w-[1080px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <div className="flex items-center justify-between gap-5">
        <h2 className="text-left font-mono text-[13px] uppercase tracking-[0.2em] text-muted">
          Live right now — built by people like you
        </h2>
        <div className="flex gap-2">
          <ArrowButton label="Previous device" onClick={() => go(index - 1)}>
            ←
          </ArrowButton>
          <ArrowButton label="Next device" onClick={() => go(index + 1)}>
            →
          </ArrowButton>
        </div>
      </div>

      <div className="mt-[18px] overflow-hidden">
        <div
          className="flex gap-5 transition-transform duration-600 ease-carousel motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * STEP_PX}px)` }}
        >
          {track.map((card, i) => (
            <DeviceCard key={`${card.id}-${i}`} card={card} duplicate={i >= positions} />
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        {cards.map((card, i) => (
          <button
            key={card.id}
            type="button"
            aria-label={`Show ${card.name}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => go(i)}
            className={cx(
              "h-2 rounded-full transition-all duration-300",
              i === index ? "w-[26px] bg-coral" : "w-2 bg-hairline",
            )}
          />
        ))}
      </div>
    </section>
  );
}

function ArrowButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="size-[38px] rounded-full border border-hairline bg-white text-[16px] text-muted hover:border-coral hover:text-coral-deep"
    >
      {children}
    </button>
  );
}

function DeviceCard({ card, duplicate }: { card: CarouselCard; duplicate: boolean }) {
  const { bg, fg } = accentClasses[card.accent];

  return (
    <article
      aria-hidden={duplicate || undefined}
      className="w-[340px] flex-none overflow-hidden rounded-[22px] border border-hairline bg-white text-left"
    >
      <div className={cx("flex items-center justify-between gap-3 px-6 py-5", bg)}>
        <div className="flex items-center gap-2">
          <PulseDot />
          <h3 className={cx("text-[14px] font-semibold", fg)}>{card.name}</h3>
        </div>
        <span className={cx("whitespace-nowrap font-mono text-[18px]", fg)}>{card.reading}</span>
      </div>
      <div className="px-6 pt-5 pb-[22px]">
        <SchematicChain nodes={card.chain} />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13px] font-light text-muted">{card.caption}</span>
          <span className="font-mono text-[12px] text-faint">{card.age}</span>
        </div>
      </div>
    </article>
  );
}
