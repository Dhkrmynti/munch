import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ExternalLink, X } from 'lucide-react';
import type { BurnLedgerEntry } from '../../types';
import { sfx } from './sfx';
import { Pet } from './Pet';
import type { StageKey } from './stages';

gsap.registerPlugin(useGSAP);

interface MealAlertProps {
  burnLedger: BurnLedgerEntry[];
  tokenSymbol: string;
  explorerUrl: string;
  stage: StageKey;
  crack: number;
  /** true while the alert is up, so the pet on the pack chews along */
  onNom: (on: boolean) => void;
}

interface Meal {
  id: string;
  amount: number;
  tx: string;
}

/** A meal only counts as news if it happened in the last few minutes; older ones are history. */
const RECENT_MS = 15 * 60 * 1000;
const SHOW_MS = 9000;
const eaten = (e: BurnLedgerEntry) => e.burnedJollyburn || e.burnedMuseburn || e.burnedIncinerator || 0;
const msOf = (e: BurnLedgerEntry) => (e.timestamp && e.timestamp < 1e12 ? e.timestamp * 1000 : e.timestamp || 0);
const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2, roundingMode: 'floor' } as Intl.NumberFormatOptions).format(n);
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(n));

/** The "!" a virtual pet flashes when it needs you, drawn on the pixel grid. */
function Attention() {
  return (
    <svg viewBox="0 0 5 9" className="nom-blink h-7 w-4 shrink-0" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="1" y="0" width="3" height="5" fill="currentColor" />
      <rect x="2" y="5" width="1" height="1" fill="currentColor" />
      <rect x="1" y="7" width="3" height="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The attention call. When the auto-feeder lands a real meal while the page is open, the
 * handheld beeps and the screen says so, with the amount and the transaction. It also
 * goes crk when the egg cracks a step further while the page is open.
 * Add ?nom (or ?nom=1234567) to the URL to play one for a recording.
 */
export function MealAlert({ burnLedger, tokenSymbol, explorerUrl, stage, crack, onNom }: MealAlertProps) {
  const [meal, setMeal] = useState<Meal | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastCrack = useRef<number | null>(null);

  // the egg cracked a step further while you watched
  useEffect(() => {
    if (lastCrack.current !== null && crack > lastCrack.current) sfx.play('crack');
    lastCrack.current = crack;
  }, [crack]);

  // a new meal: one not on the screen before, written in the last few minutes
  useEffect(() => {
    const meals = burnLedger.filter((e) => e.cycleType !== 'keep' && eaten(e) > 0);
    if (!seen.current) {
      seen.current = new Set(meals.map((e) => e.id));
      return;
    }
    const known = seen.current;
    const fresh = meals.filter((e) => !known.has(e.id));
    fresh.forEach((e) => known.add(e.id));
    const news = fresh.filter((e) => Date.now() - msOf(e) < RECENT_MS).sort((a, b) => msOf(b) - msOf(a))[0];
    if (news) setMeal({ id: news.id, amount: eaten(news), tx: news.burnTx || news.buyTx || '' });
  }, [burnLedger]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has('nom')) return;
    const id = window.setTimeout(() => setMeal({ id: 'demo', amount: Number(q.get('nom')) || 1234567, tx: '' }), 2500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!meal) return;
    onNom(true);
    sfx.play('nom');
    const id = window.setTimeout(() => setMeal(null), SHOW_MS);
    return () => {
      window.clearTimeout(id);
      onNom(false);
    };
  }, [meal, onNom]);

  useGSAP(
    () => {
      if (!meal || !boxRef.current) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(boxRef.current, { yPercent: 140, duration: 0.4, ease: 'steps(5)' });
      });
      return () => mm.revert();
    },
    { dependencies: [meal?.id] },
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6" role="status" aria-live="polite">
      {meal ? (
        <div ref={boxRef} key={meal.id} className="pointer-events-auto w-full max-w-[25rem] rounded-[20px] bg-shell p-2.5 shadow-[0_0_0_4px_var(--color-ink),0_18px_34px_-14px_color-mix(in_srgb,var(--color-ink)_80%,transparent)]">
          <div className="lcd relative flex items-center gap-3 rounded-[10px] px-3 py-3 shadow-[inset_3px_3px_0_color-mix(in_srgb,var(--color-lcd-ink)_28%,transparent)]">
            <Attention />
            <Pet stage={stage} crack={crack} chewing className="h-14 w-14 shrink-0" />
            <div className="min-w-0 flex-1 font-lcd leading-tight text-lcd-ink">
              <div className="text-[1.7rem] leading-none">NOM!</div>
              <div className="mt-1 text-[0.95rem]" title={`${fmt(meal.amount)} ${tokenSymbol}`}>
                MUNCH ate {compact(meal.amount)} {tokenSymbol}
              </div>
              {meal.tx.startsWith('0x') ? (
                <a href={`${explorerUrl}/tx/${meal.tx}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-[0.78rem] text-lcd-ink underline decoration-lcd-ink/40">
                  see the meal on chain
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <div className="mt-1 text-[0.78rem] uppercase text-lcd-soft">gone for good · 0x…dEaD</div>
              )}
            </div>
            <button type="button" onClick={() => setMeal(null)} className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center text-lcd-ink hover:bg-lcd-ink hover:text-lcd" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
