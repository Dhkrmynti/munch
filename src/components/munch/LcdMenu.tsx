import { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ICONS, LCD, LCD_INV, PixelArt } from './sprites';
import { sfx } from './sfx';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const ITEMS: { id: string; icon: keyof typeof ICONS; label: string }[] = [
  { id: 'life', icon: 'life', label: 'life' },
  { id: 'feeding', icon: 'feed', label: 'feeding' },
  { id: 'meals', icon: 'meals', label: 'meals' },
  { id: 'jar', icon: 'jar', label: 'jar' },
  { id: 'status', icon: 'status', label: 'status' },
];

/**
 * The icon strip along the top of a virtual pet's screen, used as the chapter's wayfinding:
 * it sticks while you are inside the screen and lights up the menu you are reading.
 */
export function LcdMenu() {
  const [active, setActive] = useState(0);
  // bumps on every change of menu, after the first: it keys the refresh sweep
  const [sweep, setSweep] = useState(0);
  const activeRef = useRef(0);

  useGSAP(() => {
    ITEMS.forEach((item, i) => {
      ScrollTrigger.create({
        trigger: `#${item.id}`,
        start: 'top 45%',
        end: 'bottom 45%',
        onToggle: (self) => {
          if (!self.isActive) return;
          if (activeRef.current === i) return;
          activeRef.current = i;
          setActive(i);
          setSweep((n) => n + 1);
          sfx.play('blip');
        },
      });
    });
  });

  return (
    <>
      {sweep > 0 ? <span key={sweep} className="lcd-refresh pointer-events-none fixed inset-x-0 top-0 z-[15] h-[100svh]" onAnimationEnd={() => setSweep(0)} aria-hidden="true" /> : null}
      <nav aria-label="Inside the screen" className="lcd sticky top-16 z-20 border-b-4 border-lcd-ink sm:top-[4.5rem]">
        <ol className="mx-auto flex max-w-[84rem] list-none items-stretch justify-between gap-1 px-2 py-1.5 sm:px-10 lg:px-16">
          {ITEMS.map((item, i) => {
            const on = i === active;
            return (
              <li key={item.id} className="flex-1">
                <a
                  href={`#${item.id}`}
                  aria-current={on ? 'location' : undefined}
                  className={`flex items-center justify-center gap-2 px-2 py-1.5 font-lcd text-[0.8rem] uppercase no-underline transition-colors duration-100 sm:text-[0.9rem] ${on ? 'bg-lcd-ink text-lcd' : 'text-lcd-ink hover:bg-lcd-ghost'}`}
                >
                  <PixelArt key={on ? 'on' : 'off'} rows={ICONS[item.icon]} pal={on ? LCD_INV : LCD} className={`h-5 w-5 shrink-0 ${on ? 'reink' : ''}`} />
                  <span className="hidden sm:inline">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
