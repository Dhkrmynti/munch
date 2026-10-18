import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { COLOR, MUNCH_OPEN, MUNCH_SHUT, PixelArt } from './sprites';

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface FinaleProps {
  tokenSymbol: string;
  buyHref: string;
  tokenAddress: string;
  copiedCA: boolean;
  onCopyCA: () => void;
  /** the project's X account, shown as a follow key next to buy */
  xHref?: string;
  xHandle?: string;
}

/** The inside of MUNCH's open mouth, in the 24 by 22 grid: columns 4–19, rows 11–13. */
const MOUTH = { x: 4 / 24, y: 11 / 22, w: 16 / 24, h: 3 / 22 };

/**
 * The close: MUNCH, full grown on the cardboard, opens its mouth and the dark inside it
 * swallows the screen. The last words are written in there.
 */
export function Finale({ tokenSymbol, buyHref, tokenAddress, copiedCA, onCopyCA, xHref, xHandle }: FinaleProps) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = ref.current;
      if (!section) return;
      const q = gsap.utils.selector(section);
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        section.dataset.mode = 'swallow';
        const mouth = q('[data-mouth]')[0] as HTMLElement;
        const cover = () => {
          const r = mouth.getBoundingClientRect();
          return Math.max(window.innerWidth / r.width, window.innerHeight / r.height) * 2.6;
        };
        const tl = gsap.timeline({ scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 0.5, invalidateOnRefresh: true } });
        tl.fromTo(q('[data-big-munch]'), { scale: 0.7, y: 60 }, { scale: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0)
          .fromTo(q('[data-finale-hello]'), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.12, ease: 'steps(4)' }, 0.08)
          .to(q('[data-finale-hello]'), { autoAlpha: 0, duration: 0.08 }, 0.36)
          .set(q('[data-frame-shut]'), { autoAlpha: 0 }, 0.34)
          .set(q('[data-frame-open]'), { autoAlpha: 1 }, 0.34)
          .set(q('[data-mouth]'), { autoAlpha: 1 }, 0.4)
          .to(q('[data-mouth]'), { scale: () => cover(), duration: 0.25, ease: 'steps(14)' }, 0.4)
          .fromTo(q('[data-finale-copy]'), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.1, ease: 'steps(5)' }, 0.5);
        return () => {
          delete section.dataset.mode;
        };
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <section ref={ref} data-finale aria-labelledby="finale-title" className="group/fin relative bg-ink data-[mode=swallow]:h-[220svh]">
      <div className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4 py-24 group-data-[mode=swallow]/fin:sticky group-data-[mode=swallow]/fin:top-0 group-data-[mode=swallow]/fin:h-[100svh] group-data-[mode=swallow]/fin:py-0">
        {/* the cardboard, and MUNCH on it */}
        <div className="cardboard absolute inset-0 hidden group-data-[mode=swallow]/fin:block" aria-hidden="true" />
        <div className="relative hidden flex-col items-center group-data-[mode=swallow]/fin:flex" aria-hidden="true">
          <p data-finale-hello className="logo-sm m-0 mb-6 text-center text-[clamp(2rem,5vw,3.6rem)]">
            Still hungry.
          </p>
          <div data-big-munch className="relative w-[min(70vw,46svh,26rem)]" style={{ aspectRatio: '24 / 22' }}>
            <div data-frame-shut className="absolute inset-0">
              <PixelArt rows={MUNCH_SHUT} pal={COLOR} className="h-full w-full" />
            </div>
            <div data-frame-open className="invisible absolute inset-0 opacity-0">
              <PixelArt rows={MUNCH_OPEN} pal={COLOR} className="h-full w-full" />
            </div>
            <div
              data-mouth
              className="invisible absolute bg-mouth opacity-0"
              style={{ left: `${MOUTH.x * 100}%`, top: `${MOUTH.y * 100}%`, width: `${MOUTH.w * 100}%`, height: `${MOUTH.h * 100}%` }}
            />
          </div>
        </div>

        {/* written inside the mouth */}
        <div data-finale-copy className="relative z-10 mx-auto max-w-[52rem] text-center group-data-[mode=swallow]/fin:absolute group-data-[mode=swallow]/fin:inset-x-4 group-data-[mode=swallow]/fin:top-1/2 group-data-[mode=swallow]/fin:-translate-y-1/2">
          <h2 id="finale-title" className="logo m-0 text-[clamp(3.2rem,9vw,6rem)]">
            Feed it.
          </h2>
          <p className="mx-auto mt-6 max-w-[42ch] text-[1.15rem] font-medium leading-relaxed text-cream">
            Hold {tokenSymbol}, trade {tokenSymbol}, and watch MUNCH eat the supply one feeding at a time. Nothing it eats comes back out.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <a href={buyHref} target="_blank" rel="noreferrer" className="btn-buy px-8 py-4 text-[1.2rem] no-underline">
              buy {tokenSymbol}
              <ArrowUpRight className="h-5 w-5" />
            </a>
            {tokenAddress ? (
              <button type="button" onClick={onCopyCA} className="btn-chip-dark cursor-pointer">
                {copiedCA ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedCA ? 'copied' : 'copy CA'}
              </button>
            ) : null}
            {xHref ? (
              <a href={xHref} target="_blank" rel="noreferrer" className="btn-chip-dark no-underline" aria-label={`Follow ${xHandle ?? 'MUNCH'} on X`}>
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.9 2H22l-6.8 7.8L23.2 22H17l-4.9-6.4L6.5 22H3.4l7.2-8.2L2.9 2h6.4l4.4 5.8L18.9 2Zm-1.1 17.8h1.7L8.3 4.1H6.5l11.3 15.7Z" />
                </svg>
                follow {xHandle}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
