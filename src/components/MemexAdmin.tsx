import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  Key,
  Coins,
  Eye,
  EyeOff,
  Save,
  Check,
  ArrowLeft,
  ShieldAlert,
  Wallet,
  CheckCircle2,
  RefreshCw,
  Landmark,
  RotateCcw,
  Trash2,
  Lock
} from 'lucide-react';
import { COLOR, FEEDER, MUNCHLET, PixelArt } from './munch/sprites';

interface MemexAdminProps {
  onBack?: () => void;
}

export function MemexAdmin({ onBack }: MemexAdminProps) {
  const [privateKey, setPrivateKey] = useState<string>('');
  const [tokenAddress, setTokenAddress] = useState<string>('');
  const [treasuryAddress, setTreasuryAddress] = useState<string>('');
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);
  // The ADMIN_SECRET set on the bot: typed in each visit, never stored in the browser
  const [adminSecret, setAdminSecret] = useState<string>('');
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [derivedWallet, setDerivedWallet] = useState<string | null>(null);
  const [isTokenValid, setIsTokenValid] = useState<boolean>(false);
  const [isTreasuryValid, setIsTreasuryValid] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  // Operator wallet the bot is currently running with (its key never leaves the server)
  const [botWallet, setBotWallet] = useState<string>('');

  // Load the current config from the bot; nothing is kept in browser storage
  useEffect(() => {
    const loadSavedConfig = async () => {
      let loadedToken = '';
      let loadedTreasury = '';

      // 0. Drop values older versions of this page kept in the browser (incl. the private key)
      try {
        ['memex_private_key', 'memex_token_address', 'memex_treasury_address', 'memex_creator_address', 'jollyburn_engine_config'].forEach((k) =>
          localStorage.removeItem(k)
        );
      } catch {}

      // 1. Live bot config (production)
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            if (json.data.tokenAddress) loadedToken = json.data.tokenAddress;
            if (json.data.treasuryAddress) loadedTreasury = json.data.treasuryAddress;
            if (json.data.walletAddress) setBotWallet(json.data.walletAddress);
          }
        }
      } catch {
        // bot might be offline
      }

      // 2. Local dev server (.env / bot-config.json)
      try {
        const res = await fetch('/api/admin/config');
        if (res.ok) {
          const json = await res.json();
          if (json.tokenAddress && !loadedToken) loadedToken = json.tokenAddress;
          if (json.treasuryAddress && !loadedTreasury) loadedTreasury = json.treasuryAddress;
        }
      } catch (e) {
        // server might not be active
      }

      if (loadedToken) setTokenAddress(loadedToken);
      if (loadedTreasury) setTreasuryAddress(loadedTreasury);
    };

    loadSavedConfig();
  }, []);

  // Validate and derive wallet from private key in real-time
  useEffect(() => {
    const trimmed = privateKey.trim();
    if (!trimmed) {
      setDerivedWallet(null);
      return;
    }

    try {
      const formatted = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
      if (formatted.length === 66) {
        const wallet = new ethers.Wallet(formatted);
        setDerivedWallet(wallet.address);
      } else {
        setDerivedWallet(null);
      }
    } catch {
      setDerivedWallet(null);
    }
  }, [privateKey]);

  // Validate token address
  useEffect(() => {
    const trimmed = tokenAddress.trim().toLowerCase();
    const valid = trimmed.startsWith('0x') && trimmed.length === 42 && ethers.isAddress(trimmed);
    setIsTokenValid(valid);
  }, [tokenAddress]);

  // Validate treasury address (optional)
  useEffect(() => {
    const trimmed = treasuryAddress.trim().toLowerCase();
    if (!trimmed) {
      setIsTreasuryValid(true);
      return;
    }
    const valid = trimmed.startsWith('0x') && trimmed.length === 42 && ethers.isAddress(trimmed);
    setIsTreasuryValid(valid);
  }, [treasuryAddress]);

  /**
   * Sends one config change to the local dev server and to the bot, both behind the admin secret.
   * saved: at least one accepted it. denied: the reason a server refused (wrong or missing secret).
   */
  const postAdmin = async (body: string) => {
    let saved = false;
    let denied = '';
    let wallet: string | undefined;
    for (const url of ['/api/admin/save', '/api/config']) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-secret': adminSecret.trim() }, body });
        const json = await res.json().catch(() => null);
        if (res.ok) {
          saved = true;
          if (json?.walletAddress !== undefined) wallet = json.walletAddress || '';
        } else if (res.status === 401 || res.status === 503) {
          denied = json?.error || 'Refused by the server.';
        }
      } catch {
        // that server is not running
      }
    }
    return { saved, denied, wallet };
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    setIsSaving(true);
    setSaveStatus('idle');
    setStatusMessage('');

    const cleanToken = tokenAddress.trim();
    const cleanKey = privateKey.trim();
    const cleanTreasury = treasuryAddress.trim();

    try {
      if (!adminSecret.trim()) throw new Error('enter the admin secret first');
      const cleanCreator = derivedWallet || '';
      // An empty key field means "keep the key the bot already has"
      const payload = JSON.stringify({
        tokenAddress: cleanToken,
        privateKey: cleanKey || undefined,
        treasuryAddress: cleanTreasury,
        creatorAddress: cleanCreator || undefined,
      });

      // The local dev server (.env and bot-config.json) and the bot itself (production)
      const { saved, denied, wallet } = await postAdmin(payload);
      if (wallet !== undefined) setBotWallet(wallet);
      if (!saved) {
        throw new Error(denied || 'the bot is offline, nothing was saved');
      }

      // Every open page re-reads the token from the bot
      window.dispatchEvent(new Event('memex_config_updated'));
      if (cleanKey) setPrivateKey('');

      setSaveStatus('success');
      setStatusMessage('Saved to the bot. Every visitor now sees this token.');

      setTimeout(() => {
        setSaveStatus('idle');
      }, 4000);
    } catch (err: any) {
      setSaveStatus('error');
      setStatusMessage(`Failed to save: ${err.message || 'An error occurred'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetTokenAddress = async () => {
    const { saved, denied } = await postAdmin(JSON.stringify({ tokenAddress: '' }));
    if (!saved) {
      setSaveStatus('error');
      setStatusMessage(`Failed to clear: ${denied || 'the bot is offline'}`);
      return;
    }
    setTokenAddress('');
    window.dispatchEvent(new Event('memex_config_updated'));
    setStatusMessage('Token contract address has been cleared.');
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const handleResetAll = async () => {
    if (!window.confirm('Are you sure you want to reset all addresses and configuration back to blank/defaults?')) {
      return;
    }

    setIsSaving(true);
    setSaveStatus('idle');
    setStatusMessage('');

    try {
      // 1. Clear component state
      setTokenAddress('');
      setPrivateKey('');
      setTreasuryAddress('');
      setDerivedWallet(null);
      setBotWallet('');

      // 2. Remove all storage keys
      try {
        localStorage.removeItem('memex_token_address');
        localStorage.removeItem('memex_private_key');
        localStorage.removeItem('memex_treasury_address');
        localStorage.removeItem('memex_creator_address');
        localStorage.removeItem('jollyburn_engine_config');
        localStorage.removeItem('jollyburn_activity_logs');
        localStorage.removeItem('jollyburn_burn_ledger');
        localStorage.removeItem('museburn_engine_config');
        localStorage.removeItem('museburn_activity_logs');
        localStorage.removeItem('museburn_burn_ledger');
        localStorage.removeItem('incinerator_engine_config');
        localStorage.removeItem('incinerator_activity_logs');
        localStorage.removeItem('incinerator_burn_ledger');
      } catch {}

      // 3. Dispatch real-time sync event
      window.dispatchEvent(new Event('memex_config_updated'));

      // 4. Reset backend .env and bot-config.json, and the bot itself
      const { saved, denied } = await postAdmin(JSON.stringify({ tokenAddress: '', privateKey: '', treasuryAddress: '', creatorAddress: '' }));
      if (!saved) throw new Error(denied || 'the bot is offline, only this browser was cleared');

      setSaveStatus('success');
      setStatusMessage('All addresses and configuration have been reset to blank defaults.');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 4000);
    } catch (err: any) {
      setSaveStatus('error');
      setStatusMessage(`Failed to reset: ${err.message || 'An error occurred'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const navigateToDashboard = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const inputClass =
    'w-full rounded-xl bg-cream-hi px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-soft/70 shadow-[inset_0_0_0_3px_var(--color-ink)] outline-none transition-shadow focus:shadow-[inset_0_0_0_3px_var(--color-ink),0_0_0_4px_var(--color-sun)]';
  const labelClass = 'flex items-center gap-2 font-logo text-[1.15rem] leading-none text-ink';
  const validBadge = 'inline-flex items-center gap-1 bg-lcd-ink px-1.5 py-0.5 font-lcd text-[0.72rem] uppercase text-lcd';
  const hintClass = 'm-0 text-[0.82rem] leading-snug text-ink-soft';
  const warnClass = 'm-0 text-[0.82rem] font-semibold text-bubble-lo';

  return (
    <div className="flex min-h-screen flex-col bg-ink font-body text-cream">
      {/* Header */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-ink px-4 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)] sm:px-8 md:px-12">
        <div className="flex items-center gap-3">
          <button onClick={navigateToDashboard} className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-cream transition-colors hover:text-sun">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to MUNCH</span>
          </button>
          <div className="h-5 w-[2px] bg-ink-soft" />
          <div className="flex items-center gap-2.5">
            <PixelArt rows={MUNCHLET} pal={COLOR} className="h-8 w-9" />
            <span className="font-logo text-[1.55rem] leading-none text-cream">MUNCH</span>
            <span className="lcd px-2 py-0.5 font-lcd text-[0.72rem] uppercase">keeper</span>
          </div>
        </div>
      </header>

      {/* The back of the toy: where the keeper sets up the auto-feeder */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-xl">
          <div className="cardboard relative rounded-[22px] px-4 pb-5 pt-9 sm:px-7 sm:pb-7">
            {/* die-cut hang tab */}
            <span className="absolute left-1/2 top-3 h-[14px] w-24 -translate-x-1/2 rounded-full bg-ink shadow-[inset_0_3px_0_rgba(0,0,0,0.4)]" aria-hidden="true" />

            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <span className="lcd inline-block px-2 py-0.5 font-lcd text-[0.75rem] uppercase">keeper only</span>
                <h1 className="m-0 mt-3 font-logo text-[clamp(2rem,6vw,2.7rem)] leading-[1] text-ink">Auto-feeder settings</h1>
                <p className="m-0 mt-2 max-w-[44ch] text-[0.95rem] font-semibold leading-snug text-ink">
                  The keeper&apos;s key runs the auto-feeder. Set it, and the token MUNCH eats. Every feeding runs from what you save here.
                </p>
              </div>
              <PixelArt rows={FEEDER} pal={COLOR} className="hidden h-20 w-20 shrink-0 sm:block" />
            </div>

            <form onSubmit={handleSave} className="space-y-6 rounded-2xl bg-cream p-5 text-ink shadow-[0_0_0_3px_var(--color-ink)] sm:p-6">
              {/* Field 0: Admin secret, needed for every change */}
              <div className="space-y-2">
                <label className={labelClass}>
                  <Lock className="h-4 w-4" />
                  Admin secret
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={adminSecret}
                    onChange={(e) => setAdminSecret(e.target.value)}
                    placeholder="ADMIN_SECRET from the bot's .env"
                    className={`${inputClass} pr-11`}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer p-1 text-ink-soft transition-colors hover:text-ink"
                    title={showSecret ? 'Hide' : 'Show'}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className={hintClass}>Every change needs it, and the bot refuses a wrong one. It is not stored in this browser.</p>
              </div>

              {/* Field 1: Private Key */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className={labelClass}>
                    <Key className="h-4 w-4" />
                    Keeper key
                  </label>
                  {derivedWallet && (
                    <span className={validBadge}>
                      <CheckCircle2 className="h-3 w-3" />
                      valid key
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input
                    type={showPrivateKey ? 'text' : 'password'}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="Keeper private key (0x…)"
                    className={`${inputClass} pr-11`}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer p-1 text-ink-soft transition-colors hover:text-ink"
                    title={showPrivateKey ? 'Hide' : 'Show'}
                  >
                    {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Derived Wallet Address Display */}
                {derivedWallet ? (
                  <div className="lcd flex items-center gap-2 rounded-lg px-3 py-2 shadow-[inset_0_0_0_3px_var(--color-lcd-ink)]">
                    <Wallet className="h-4 w-4 shrink-0" />
                    <div className="truncate font-mono text-[0.75rem]">
                      <span className="font-lcd uppercase">keeper wallet </span>
                      <span className="font-semibold">{derivedWallet}</span>
                    </div>
                  </div>
                ) : privateKey.trim().length > 0 ? (
                  <p className={warnClass}>Invalid private key format (must be 64 hex characters).</p>
                ) : botWallet ? (
                  <p className={hintClass}>
                    The bot is running with wallet <span className="font-mono text-ink">{botWallet}</span>. Leave blank to keep it.
                  </p>
                ) : (
                  <p className={hintClass}>Sent straight to the bot on the server. It is never stored in this browser.</p>
                )}
              </div>

              {/* Field 2: Token Address */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className={labelClass}>
                    <Coins className="h-4 w-4" />
                    Token address
                  </label>
                  <div className="flex items-center gap-2">
                    {tokenAddress.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={handleResetTokenAddress}
                        className="flex cursor-pointer items-center gap-1 text-[0.78rem] font-semibold text-ink-soft transition-colors hover:text-bubble-lo hover:underline"
                        title="Clear Token Address"
                      >
                        <Trash2 className="h-3 w-3" />
                        clear
                      </button>
                    )}
                    {isTokenValid && (
                      <span className={validBadge}>
                        <CheckCircle2 className="h-3 w-3" />
                        valid
                      </span>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                  placeholder="0x… (token contract address)"
                  className={inputClass}
                  autoComplete="off"
                  spellCheck="false"
                />

                {tokenAddress.trim().length > 0 && !isTokenValid ? (
                  <p className={warnClass}>Must be a valid 42-character EVM address (starting with 0x).</p>
                ) : (
                  <p className={hintClass}>The token the auto-feeder buys back and MUNCH eats at 0x…dEaD.</p>
                )}
              </div>

              {/* Field 3: Treasury Address (Optional for KEEP Cycles) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className={labelClass}>
                    <Landmark className="h-4 w-4" />
                    Snack jar address
                    <span className="font-body text-[0.75rem] font-semibold text-ink-soft">(optional)</span>
                  </label>
                  {treasuryAddress.trim() && isTreasuryValid && (
                    <span className={validBadge}>
                      <CheckCircle2 className="h-3 w-3" />
                      valid
                    </span>
                  )}
                </div>

                <input
                  type="text"
                  value={treasuryAddress}
                  onChange={(e) => setTreasuryAddress(e.target.value)}
                  placeholder="0x… (snack jar wallet)"
                  className={inputClass}
                  autoComplete="off"
                  spellCheck="false"
                />

                {treasuryAddress.trim().length > 0 && !isTreasuryValid ? (
                  <p className={warnClass}>Must be a valid 42-character EVM address (starting with 0x).</p>
                ) : (
                  <p className={hintClass}>Where every other feeding goes (the snack jar). Leave it empty and the ETH stays in the keeper wallet.</p>
                )}
              </div>

              {/* Status Message */}
              {statusMessage && (
                <div
                  className={`flex items-start gap-2 rounded-lg p-3 text-[0.8rem] ${
                    saveStatus === 'success' ? 'lcd font-lcd shadow-[inset_0_0_0_3px_var(--color-lcd-ink)]' : 'bg-cream-hi font-mono text-bubble-lo shadow-[inset_0_0_0_3px_var(--color-bubble-lo)]'
                  }`}
                >
                  {saveStatus === 'success' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>{statusMessage}</span>
                </div>
              )}

              {/* Action Buttons: Save Configuration & Reset All */}
              <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row">
                <button type="submit" disabled={isSaving} className="btn-ink w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1">
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save settings
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResetAll}
                  disabled={isSaving}
                  className="btn-chip w-full cursor-pointer py-3 text-bubble-lo disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  title="Reset all addresses and configuration back to blank defaults"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Reset all</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
export default MemexAdmin;
