import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useFlywheelEngine } from './hooks/useBurnEngine';
import { PONS_V2_CONFIG } from './contracts';
import { sounds } from './utils/audio';
import { Volume2, VolumeX, Copy, Check } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { BurnLedgerDrawer } from './components/BurnLedgerDrawer';
import { PackHero } from './components/munch/PackHero';
import { LcdMenu } from './components/munch/LcdMenu';
import { LifeCycle } from './components/munch/LifeCycle';
import { Feeding } from './components/munch/Feeding';
import { MealLog } from './components/munch/MealLog';
import { PetStatus } from './components/munch/PetStatus';
import { BoxBack } from './components/munch/BoxBack';
import { Finale } from './components/munch/Finale';
import { MealAlert } from './components/munch/MealAlert';
import { STAGES, crackLevel, stageIndexFor } from './components/munch/stages';
import { COLOR, MUNCHLET, PixelArt } from './components/munch/sprites';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** The operator panel: only the /memex route needs it, so visitors never download it. */
const MemexAdmin = lazy(() => import('./components/MemexAdmin'));

/** What MUNCH says when you feed it by hand. */
const MUNCH_SAYS = ['nom.', 'crunchy.', 'more.', 'burp.', 'tastes like supply.', 'odd feedings: me. even: the jar.', 'no refunds.', 'keep trading, keeper.', 'that one was fat.'];

/** The project's X account. */
const X_URL = 'https://x.com/munch_rh';
const X_HANDLE = '@munch_rh';
const EXPLORER_URL = 'https://explorer.mainnet.chain.robinhood.com';
/** Where to trade and where to watch, once the CA is known. */
const buyUrl = (ca: string) => (ca ? `https://ponsfamily.com/launchpad/${ca}` : EXPLORER_URL);
const chartUrl = (ca: string) => (ca ? `https://dexscreener.com/robinhood/${ca}` : EXPLORER_URL);

export function App() {
  const { state, config, setConfig, logs, burnLedger } = useFlywheelEngine();

  const getIsMemex = () => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return path.startsWith('/memex') || hash.startsWith('#memex') || hash.startsWith('#/memex');
  };

  const [isMemexRoute, setIsMemexRoute] = useState(getIsMemex());
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [copiedCA, setCopiedCA] = useState(false);
  const [copiedDead, setCopiedDead] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [fed, setFed] = useState(0);
  const [sayIndex, setSayIndex] = useState(0);
  const [inScreen, setInScreen] = useState(false);
  const [nomming, setNomming] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleLocationChange = () => setIsMemexRoute(getIsMemex());
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Late fonts change line heights; re-measure every trigger once they land
  useEffect(() => {
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, []);

  const feedOne = () => {
    setFed((prev) => prev + 1);
    setSayIndex((prev) => (prev + 1) % MUNCH_SAYS.length);
    sounds.playBuybackSound();
  };

  const navigateToHome = () => {
    window.history.pushState({}, '', '/');
    setIsMemexRoute(false);
  };

  const threshold = state.currentThresholdETH || state.claimThresholdETH || config.claimThresholdETH || 0;
  const escrow = state.currentEscrowBalanceETH || 0;
  const bowlFill = threshold > 0 ? Math.max(0, Math.min(1, escrow / threshold)) : 0;

  useGSAP(
    () => {
      if (isMemexRoute) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        ScrollTrigger.batch('[data-log-row]', {
          start: 'top 92%',
          once: true,
          onEnter: (els) => gsap.fromTo(els, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.3, ease: 'steps(3)', stagger: 0.06 }),
        });
      });
      // Inside the screen, the LCD's own menu is the chapter nav; the header steps back to the wordmark
      ScrollTrigger.create({ trigger: '[data-screen]', start: 'top 80px', endTrigger: '#story', end: 'top 80px', refreshPriority: -1, onToggle: (self) => setInScreen(self.isActive) });
      // Sections build their own triggers (children first); put them back in page order and re-measure
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
      return () => mm.revert();
    },
    { scope: pageRef, dependencies: [isMemexRoute] },
  );

  if (isMemexRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-ink" />}>
        <MemexAdmin onBack={navigateToHome} />
      </Suspense>
    );
  }

  const copyCA = () => {
    if (!config.tokenAddress) return;
    navigator.clipboard.writeText(config.tokenAddress);
    setCopiedCA(true);
    sounds.playClaimSound();
    setTimeout(() => setCopiedCA(false), 2500);
  };

  const copyDead = () => {
    navigator.clipboard.writeText(config.deadAddress || PONS_V2_CONFIG.contracts.deadAddress);
    setCopiedDead(true);
    sounds.playBurnSound();
    setTimeout(() => setCopiedDead(false), 2000);
  };

  const totalTokensBurned =
    state.totalTokensBurned > 0
      ? state.totalTokensBurned
      : burnLedger.reduce((acc, cur) => acc + (cur.burnedJollyburn || cur.burnedMuseburn || cur.burnedIncinerator || 0), 0);

  const burnedPercent =
    state.burnedPercentageOfSupply > 0
      ? state.burnedPercentageOfSupply
      : state.totalSupply > 0
        ? (totalTokensBurned / state.totalSupply) * 100
        : 0;

  const tokenSymbol = '$MUNCH';
  const deadAddress = config.deadAddress || PONS_V2_CONFIG.contracts.deadAddress;
  const isConfigured = Boolean(config.tokenAddress && config.tokenAddress.startsWith('0x') && config.tokenAddress.length === 42);
  const nextCycle = state.nextCycleType || 'burn';
  const routerName = state.swapRouter === 'uniswap' || state.isTokenMigrated ? 'Uniswap v4' : 'the Pons bonding curve';

  return (
    <div ref={pageRef} className="relative min-h-screen overflow-x-clip bg-ink font-body text-ink">
      {/* ───────── The nav ───────── */}
      <header className={`fixed inset-x-0 top-0 z-40 transition-colors duration-200 ${scrolled ? 'bg-ink shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]' : ''}`}>
        <div className="mx-auto flex h-16 max-w-[84rem] items-center justify-between gap-4 px-4 sm:h-[4.5rem] sm:px-10 lg:px-16">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateToHome();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="group flex items-center gap-2.5 text-cream no-underline"
            aria-label="MUNCH home"
          >
            <PixelArt rows={MUNCHLET} pal={COLOR} className="h-8 w-9 transition-transform duration-150 group-hover:-translate-y-1" />
            <span className="font-logo text-[1.55rem] leading-none">MUNCH</span>
          </a>

          <nav className={`hidden items-center gap-6 text-[0.95rem] font-semibold text-cream transition-opacity duration-200 md:flex ${inScreen ? 'pointer-events-none opacity-0' : ''}`} aria-label="Sections" aria-hidden={inScreen || undefined}>
            <a href="#life" className="no-underline hover:text-sun">life</a>
            <a href="#feeding" className="no-underline hover:text-sun">feeding</a>
            <a href="#meals" className="no-underline hover:text-sun">meals</a>
            <a href="#story" className="no-underline hover:text-sun">story</a>
            <button type="button" onClick={() => setIsLogOpen(true)} className="cursor-pointer font-semibold hover:text-sun">
              full log
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfig({ ...config, soundEnabled: !config.soundEnabled })}
              title={config.soundEnabled ? 'Mute MUNCH' : 'Turn the sounds on'}
              aria-label={config.soundEnabled ? 'Mute MUNCH' : 'Turn the sounds on'}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-cream shadow-[inset_0_0_0_2px_var(--color-ink-soft)] transition-colors hover:text-sun hover:shadow-[inset_0_0_0_2px_var(--color-sun)]"
            >
              {config.soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            {X_URL ? (
              <a href={X_URL} target="_blank" rel="noreferrer" title="MUNCH on X" aria-label="MUNCH on X" className="flex h-10 w-10 items-center justify-center rounded-full text-cream shadow-[inset_0_0_0_2px_var(--color-ink-soft)] hover:text-sun">
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.9 2H22l-6.8 7.8L23.2 22H17l-4.9-6.4L6.5 22H3.4l7.2-8.2L2.9 2h6.4l4.4 5.8L18.9 2Zm-1.1 17.8h1.7L8.3 4.1H6.5l11.3 15.7Z" />
                </svg>
              </a>
            ) : null}
            {config.tokenAddress ? (
              <button type="button" onClick={copyCA} className="btn-chip hidden cursor-pointer py-2 text-[0.85rem] lg:inline-flex" title="Copy contract address">
                {copiedCA ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCA ? 'copied' : <>CA <span className="font-mono text-[0.8rem]">{`${config.tokenAddress.slice(0, 6)}…${config.tokenAddress.slice(-4)}`}</span></>}</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative">
        {/* ───────── The pack ───────── */}
        <PackHero
          tokenSymbol={tokenSymbol}
          totalBurned={totalTokensBurned}
          burnedPercent={burnedPercent}
          escrow={escrow}
          threshold={threshold}
          fill={bowlFill}
          nextCycle={nextCycle}
          live={isConfigured}
          running={state.isWheelSpinning || nomming}
          tokenAddress={config.tokenAddress}
          copiedCA={copiedCA}
          onCopyCA={copyCA}
          buyHref={buyUrl(config.tokenAddress)}
          chartHref={chartUrl(config.tokenAddress)}
          onOpenLog={() => setIsLogOpen(true)}
          onFeed={feedOne}
          fed={fed}
          say={`MUNCH: “${MUNCH_SAYS[sayIndex]}”`}
        />

        {/* ───────── Inside the screen ───────── */}
        <div data-screen className="lcd lcd-chapter relative z-0">
          <LcdMenu />
          <LifeCycle burnedPercent={burnedPercent} tokenSymbol={tokenSymbol} />
          <Feeding tokenSymbol={tokenSymbol} escrow={escrow} threshold={threshold} fill={bowlFill} claimedETH={state.totalFeesClaimedETH || 0} routerName={routerName} nextCycle={nextCycle} />
          <MealLog
            burnLedger={burnLedger}
            totalBurned={totalTokensBurned}
            logs={logs}
            tokenSymbol={tokenSymbol}
            deadAddress={deadAddress}
            explorerUrl={EXPLORER_URL}
            copiedDead={copiedDead}
            onCopyDead={copyDead}
            onOpenLog={() => setIsLogOpen(true)}
          />
          <PetStatus state={state} config={config} live={isConfigured} fill={bowlFill} burnedPercent={burnedPercent} totalBurned={totalTokensBurned} onOpenLog={() => setIsLogOpen(true)} />
        </div>

        {/* ───────── The back of the box ───────── */}
        <BoxBack tokenSymbol={tokenSymbol} deadAddress={deadAddress} />

        {/* ───────── MUNCH eats the screen ───────── */}
        <Finale tokenSymbol={tokenSymbol} buyHref={buyUrl(config.tokenAddress)} tokenAddress={config.tokenAddress} copiedCA={copiedCA} onCopyCA={copyCA} xHref={X_URL} xHandle={X_HANDLE} />

        <footer className="relative bg-ink">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-4 px-4 pb-12 pt-8 text-[0.95rem] text-star-dim sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-16">
            <div className="flex items-center gap-2.5">
              <PixelArt rows={MUNCHLET} pal={COLOR} className="h-7 w-8" />
              <span className="font-semibold text-cream">{tokenSymbol} on Robinhood Chain</span>
            </div>
            <p className="m-0 max-w-[52ch]">Meals and snack-jar feedings are done by a bot and every one is on chain. A meme, not financial advice.</p>
            <a href={X_URL} target="_blank" rel="noreferrer" className="font-semibold text-cream no-underline hover:text-sun">
              {X_HANDLE} on X
            </a>
            <div className="font-mono text-[0.8rem]">
              Chain ID 4663 · {!isConfigured ? 'MUNCH is asleep' : state.isWheelSpinning ? 'feeding now' : 'auto-feeder on'}
            </div>
          </div>
        </footer>
      </main>

      <MealAlert
        burnLedger={burnLedger}
        tokenSymbol={tokenSymbol}
        explorerUrl={EXPLORER_URL}
        stage={STAGES[stageIndexFor(burnedPercent)].key}
        crack={crackLevel(burnedPercent)}
        sound={config.soundEnabled}
        onNom={setNomming}
      />

      <BurnLedgerDrawer isOpen={isLogOpen} onClose={() => setIsLogOpen(false)} logs={logs} burnLedger={burnLedger} state={state} config={config} />
    </div>
  );
}

export default App;
