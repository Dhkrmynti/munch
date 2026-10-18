/**
 * PONS FAMILY V2 - AUTONOMOUS BUYBACK & BURN BOT
 * Network: Robinhood Chain (EVM Chain ID: 4663)
 * Reference: https://docs.ponsfamily.com/v2
 * 
 * Fitur:
 * 1. Menjalankan Autonomous Cycle (Claim Fee -> Buyback -> Burn) 24/7 di PM2.
 * 2. Uniswap v4 Universal Router integration untuk token yang telah graduated.
 * 3. Token CA & Curve Address terkunci permanen ke $BLAZE.
 */

import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { buildUniswapV4Buy, findGraduationPool, type PoolKey } from "./uniswap-v4";

// Native .env parser (tanpa ketergantungan modul eksternal)
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {}

// File konfigurasi persisten
const CONFIG_FILE = path.resolve(process.cwd(), "bot-config.json");

export const OFFICIAL_BLAZE_TOKEN = process.env.TOKEN_ADDRESS || process.env.VITE_TOKEN_ADDRESS || "";
export const OFFICIAL_BLAZE_CURVE = process.env.CURVE_ADDRESS || process.env.VITE_CURVE_ADDRESS || "";

// Default Config (Semua address di-reset dari 0)
let currentConfig = {
  rpcUrl: process.env.RPC_URL || process.env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  privateKey: process.env.CREATOR_PRIVATE_KEY || process.env.PRIVATE_KEY || "",
  treasuryAddress: process.env.TREASURY_ADDRESS || process.env.CREATOR_ADDRESS || process.env.VITE_CREATOR_ADDRESS || "",
  tokenAddress: OFFICIAL_BLAZE_TOKEN,
  curveAddress: OFFICIAL_BLAZE_CURVE,
  claimThresholdETH: process.env.CLAIM_THRESHOLD_ETH || process.env.VITE_CLAIM_THRESHOLD_ETH || "0.01",
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || "10", 10),
  port: parseInt(process.env.PORT || "5015", 10),
  cycleCount: 0
};

// Baca config tersimpan jika ada
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    if (saved.tokenAddress && saved.tokenAddress !== "") currentConfig.tokenAddress = saved.tokenAddress;
    if (saved.curveAddress && saved.curveAddress !== "") currentConfig.curveAddress = saved.curveAddress;
    if (saved.treasuryAddress && saved.treasuryAddress !== "") currentConfig.treasuryAddress = saved.treasuryAddress;
    if (saved.privateKey && saved.privateKey !== "") currentConfig.privateKey = saved.privateKey;
    if (saved.claimThresholdETH) currentConfig.claimThresholdETH = saved.claimThresholdETH;
    if (saved.pollIntervalSeconds) currentConfig.pollIntervalSeconds = saved.pollIntervalSeconds;
    if (typeof saved.cycleCount === "number") currentConfig.cycleCount = saved.cycleCount;
    console.log(`[CONFIG] Konfigurasi dimuat dari bot-config.json (Total Cycles: ${currentConfig.cycleCount})`);
  } catch (e: any) {
    console.error("Gagal membaca bot-config.json, menggunakan environment default:", e.message);
  }
}

// Simpan config ke file
function saveConfigToFile(newCfg: Partial<typeof currentConfig>) {
  if (newCfg.tokenAddress !== undefined) currentConfig.tokenAddress = newCfg.tokenAddress;
  if (newCfg.curveAddress !== undefined) currentConfig.curveAddress = newCfg.curveAddress;
  if (newCfg.treasuryAddress !== undefined) currentConfig.treasuryAddress = newCfg.treasuryAddress;
  if (newCfg.privateKey !== undefined) currentConfig.privateKey = newCfg.privateKey;
  if (newCfg.claimThresholdETH) currentConfig.claimThresholdETH = newCfg.claimThresholdETH;
  if (newCfg.pollIntervalSeconds) currentConfig.pollIntervalSeconds = newCfg.pollIntervalSeconds;
  if (newCfg.cycleCount !== undefined) currentConfig.cycleCount = newCfg.cycleCount;
  try {
    const toSave: any = {
      tokenAddress: currentConfig.tokenAddress,
      curveAddress: currentConfig.curveAddress,
      treasuryAddress: currentConfig.treasuryAddress,
      claimThresholdETH: currentConfig.claimThresholdETH,
      pollIntervalSeconds: currentConfig.pollIntervalSeconds,
      cycleCount: currentConfig.cycleCount !== undefined ? currentConfig.cycleCount : botState.totalCyclesExecuted
    };
    if (currentConfig.privateKey) {
      toSave.privateKey = currentConfig.privateKey;
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (err: any) {
    console.error("Gagal menyimpan bot-config.json:", err.message);
  }
}

// BURN-ONLY mode (set BURN_ONLY=1): the bot never claims fees and never buys back.
// Fees stay in the Pons escrow for the creator to claim manually; any token that lands
// in the operator wallet is burned to the dead address automatically.
const BURN_ONLY = /^(1|true|yes)$/i.test(process.env.BURN_ONLY || "");
let lastBurnOnlyIdleLog = 0;

// Kontrak Resmi Pons v2 (docs.ponsfamily.com/v2)
const PONS_FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const UNISWAP_V4_UNIVERSAL_ROUTER = process.env.UNISWAP_ROUTER_ADDRESS || process.env.VITE_UNISWAP_ROUTER_ADDRESS || "0x8876789976dEcBfCbBbe364623C63652db8C0904";

/** The graduation pool, found once the curve has graduated. */
let v4Pool: PoolKey | null = null;

// ABIs
const ESCROW_ABI = [
  "function balanceOf(address recipient) view returns (uint256)",
  "function claim()"
];
const CURVE_ABI = [
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function sellableTokens() view returns (uint256)",
  "function graduated() view returns (bool)"
];
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function curve() view returns (address)"
];

// Memory state & persistent log file untuk monitoring & API
interface BotMemoryLog {
  timestamp: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
}

const LOGS_FILE = path.resolve(process.cwd(), "bot-logs.json");
let initialLogs: BotMemoryLog[] = [];
if (fs.existsSync(LOGS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
    if (Array.isArray(saved)) initialLogs = saved;
  } catch (e) {}
}

const botState = {
  online: true,
  status: "standby" as "standby" | "active" | "error" | "claiming" | "buyback" | "burning",
  walletAddress: "",
  tokenAddress: currentConfig.tokenAddress,
  curveAddress: currentConfig.curveAddress,
  claimThresholdETH: currentConfig.claimThresholdETH,
  escrowBalanceETH: "0.0",
  totalFeesClaimedETH: "0.0",
  totalFeesRetainedETH: "0.0",
  totalCyclesExecuted: currentConfig.cycleCount,
  lastCycleTime: "",
  logs: initialLogs
};

function addLog(type: "info" | "success" | "warn" | "error", message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const logItem: BotMemoryLog = { timestamp, type, message };
  botState.logs.unshift(logItem);
  if (botState.logs.length > 80) botState.logs.pop();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(botState.logs, null, 2), "utf-8");
  } catch (e) {}
}

// Inisialisasi Wallet Web3
let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;

function initWallet() {
  try {
    if (!currentConfig.privateKey) {
      addLog("error", "CREATOR_PRIVATE_KEY not set in .env!");
      return;
    }
    provider = new ethers.JsonRpcProvider(currentConfig.rpcUrl, undefined, { cacheTimeout: -1 });
    wallet = new ethers.Wallet(currentConfig.privateKey, provider);
    botState.walletAddress = wallet.address;
    addLog("info", `Operator Wallet active: ${wallet.address}`);
  } catch (e: any) {
    addLog("error", `Failed to initialize wallet: ${e.message}`);
  }
}

initWallet();

// Validate whether Token Address is valid
function isValidAddress(addr?: string): boolean {
  if (!addr) return false;
  const c = addr.trim().toLowerCase();
  return c !== "none" && c !== "" && ethers.isAddress(c);
}

// The run in progress, saved after every step so a restart resumes it
const RUN_FILE = path.resolve(process.cwd(), "bot-run.json");
interface PendingRun {
  cycle: number;
  kind: "burn" | "keep";
  claimWei: string;
  tokensBefore: string;
  claimTx?: string;
  claimed?: boolean;
  counted?: boolean;
  buyTx?: string;
  bought?: boolean;
  burnTx?: string;
  burned?: boolean;
  sendTx?: string;
  sent?: boolean;
}
let pending: PendingRun | null = (() => {
  try {
    return fs.existsSync(RUN_FILE) ? (JSON.parse(fs.readFileSync(RUN_FILE, "utf-8")) as PendingRun) : null;
  } catch {
    return null;
  }
})();
function savePending(run: PendingRun | null) {
  pending = run;
  try {
    if (run) fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2), "utf-8");
    else fs.rmSync(RUN_FILE, { force: true });
  } catch (e: any) {
    addLog("error", `Could not save bot-run.json: ${e.message}`);
  }
}
/** Always the chain's next nonce for the operator, never a cached one. */
const nextNonce = () => provider!.getTransactionCount(wallet!.address, "pending");
/** true: mined and succeeded; false: reverted or never made it (safe to send again). */
async function settle(hash: string): Promise<boolean> {
  const rc = await provider!.getTransactionReceipt(hash);
  if (rc) return rc.status === 1;
  const tx = await provider!.getTransaction(hash);
  if (!tx) return false;
  const mined = await tx.wait().catch(() => null);
  return !!mined && mined.status === 1;
}

// Execution Cycle
let isExecuting = false;

async function executeCycle() {
  if (isExecuting) {
    addLog("warn", "Cycle currently executing, skipping this poll tick.");
    return;
  }

  botState.tokenAddress = currentConfig.tokenAddress;
  botState.curveAddress = currentConfig.curveAddress;

  if (!isValidAddress(currentConfig.tokenAddress)) {
    botState.status = "standby";
    addLog("warn", "STANDBY: Token CA is not configured. Waiting for configuration.");
    return;
  }

  if (!wallet || !provider) {
    botState.status = "error";
    addLog("error", "Wallet or RPC Provider not ready.");
    return;
  }

  // Auto-detect Curve from Token CA if not set or different
  try {
    const tokenContract = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet);
    const resolvedCurve = await tokenContract.curve();
    if (resolvedCurve && ethers.isAddress(resolvedCurve) && resolvedCurve !== ethers.ZeroAddress) {
      if (currentConfig.curveAddress.toLowerCase() !== resolvedCurve.toLowerCase()) {
        addLog("info", `[AUTO-SYNC] Connected to detected Pons Curve: ${resolvedCurve}`);
        currentConfig.curveAddress = resolvedCurve;
        botState.curveAddress = resolvedCurve;
        saveConfigToFile({ curveAddress: resolvedCurve });
      }
    }
  } catch (e: any) {
    // Skip if curve query error
  }

  if (!isValidAddress(currentConfig.curveAddress)) {
    botState.status = "standby";
    addLog("warn", "STANDBY: Curve Address is not valid yet.");
    return;
  }

  if (BURN_ONLY) {
    isExecuting = true;
    try {
      const feeEscrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet);
      const token = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet);
      botState.escrowBalanceETH = ethers.formatEther(await feeEscrow.balanceOf(wallet.address));
      botState.lastCycleTime = new Date().toLocaleTimeString();

      const tokenBalance: bigint = await token.balanceOf(wallet.address);
      const tokenSymbol = await token.symbol().catch(() => "TOKEN");
      if (tokenBalance > 0n) {
        botState.status = "burning";
        const formattedBalance = ethers.formatUnits(tokenBalance, 18);
        addLog("info", `[BURN-ONLY] Burning ${formattedBalance} $${tokenSymbol} to DEAD_ADDRESS...`);
        const burnNonce = await provider.getTransactionCount(wallet.address, "latest");
        const burnTx = await token.transfer(DEAD_ADDRESS, tokenBalance, { nonce: burnNonce });
        addLog("info", `Burn Tx broadcasted: ${burnTx.hash}`);
        await burnTx.wait();
        addLog("success", `COMPLETED: ${formattedBalance} $${tokenSymbol} PERMANENTLY INCINERATED!`);
      } else if (Date.now() - lastBurnOnlyIdleLog > 60_000) {
        lastBurnOnlyIdleLog = Date.now();
        addLog("info", `[BURN-ONLY] Claim and buyback are off. Waiting for $${tokenSymbol} in the operator wallet to burn. Escrow (claim manually on Pons): ${botState.escrowBalanceETH} ETH`);
      }
    } catch (err: any) {
      addLog("error", `[BURN-ONLY] ${err.message || err}`);
    } finally {
      isExecuting = false;
      botState.status = "standby";
    }
    return;
  }

  // Alternating cycle calculation
  // Odd cycle (1, 3, 5...): 0.01 ETH -> Claim -> Buyback -> Burn
  // Even cycle (2, 4, 6...): 0.02 ETH -> Claim -> Keep (retained in wallet)
  const currentCycleNum = botState.totalCyclesExecuted + 1;
  const isBurnCycle = currentCycleNum % 2 === 1;
  const cycleType = isBurnCycle ? "BURN" : "KEEP";
  const cycleThresholdETH = isBurnCycle ? "0.01" : "0.02";

  currentConfig.claimThresholdETH = cycleThresholdETH;
  botState.claimThresholdETH = cycleThresholdETH;

  isExecuting = true;
  botState.status = "active";

  try {
    const feeEscrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet);
    const curve = new ethers.Contract(currentConfig.curveAddress, CURVE_ABI, wallet);
    const token = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet);

    // Check Fee Escrow
    const claimableWei: bigint = await feeEscrow.balanceOf(wallet.address);
    const claimableETH = ethers.formatEther(claimableWei);
    botState.escrowBalanceETH = claimableETH;
    botState.lastCycleTime = new Date().toLocaleTimeString();

    if (isBurnCycle) {
      addLog("info", `[Cycle #${currentCycleNum} - BURN] Escrow Fee: ${claimableETH} ETH (Target: ${cycleThresholdETH} ETH)`);
    } else {
      addLog("info", `[Cycle #${currentCycleNum} - KEEP] Escrow Fee: ${claimableETH} ETH (Target: ${cycleThresholdETH} ETH)`);
    }

    const thresholdWei = ethers.parseEther(cycleThresholdETH);
    const gasBuffer = ethers.parseEther("0.0008");

    // FIX: Eksekusi HANYA dipicu saat ada fee di Escrow yang mencapai threshold!
    // Jangan gunakan saldo wallet untuk memicu eksekusi, agar dana KEEP dan cadangan gas tidak terpicu buyback sendiri.
    const shouldExecute = claimableWei >= thresholdWei && claimableWei > 0n;

    // A run is saved after every step (bot-run.json), so a crash or restart picks the same run
    // back up: nothing is claimed or bought twice and claimed ETH is never left behind.
    if (!pending) {
      if (!shouldExecute) return;
      const tokensBefore: bigint = await token.balanceOf(wallet.address);
      savePending({ cycle: currentCycleNum, kind: isBurnCycle ? "burn" : "keep", claimWei: claimableWei.toString(), tokensBefore: tokensBefore.toString() });
      addLog("success", `[Cycle #${currentCycleNum} - ${cycleType}] THRESHOLD REACHED (Claimable: ${claimableETH} ETH, Target: ${cycleThresholdETH} ETH). Executing cycle...`);
    } else if (pending.cycle !== currentCycleNum) {
      addLog("warn", `Dropping a saved run for cycle #${pending.cycle}: the bot is on cycle #${currentCycleNum}.`);
      savePending(null);
      return;
    } else {
      addLog("info", `[Cycle #${currentCycleNum} - ${cycleType}] Resuming the saved run...`);
    }
    const run = pending!;

    // 1. CLAIM (Klaim fee dari Escrow ke operator wallet)
    if (!run.claimed && run.claimTx) {
      const settled = await settle(run.claimTx);
      if (settled) run.claimed = true;
      else delete run.claimTx;
      savePending(run);
    }
    if (!run.claimed) {
      const escrowNow: bigint = await feeEscrow.balanceOf(wallet.address);
      if (escrowNow === 0n) {
        addLog("warn", `[1/3] The escrow is empty (claimed outside the bot?). Run #${run.cycle} dropped.`);
        savePending(null);
        return;
      }
      run.claimWei = escrowNow.toString();
      botState.status = "claiming";
      addLog("info", `[1/3] Claiming ${ethers.formatEther(escrowNow)} ETH from Pons Fee Escrow...`);
      const claimTx = await feeEscrow.claim({ nonce: await nextNonce() });
      run.claimTx = claimTx.hash;
      savePending(run);
      addLog("info", `Claim Tx broadcasted: ${claimTx.hash}`);
      const rc = await claimTx.wait();
      if (!rc || rc.status !== 1) throw new Error(`claim ${claimTx.hash} failed`);
      run.claimed = true;
      savePending(run);
      addLog("success", `Fee ${ethers.formatEther(escrowNow)} ETH successfully claimed to operator wallet!`);
    }
    const claimWei = BigInt(run.claimWei);
    const claimedVal = parseFloat(ethers.formatEther(claimWei)) || 0;
    if (!run.counted) {
      botState.totalFeesClaimedETH = (parseFloat(botState.totalFeesClaimedETH || "0.0") + claimedVal).toFixed(4);
      run.counted = true;
      savePending(run);
    }
    botState.escrowBalanceETH = "0.0";

    if (run.kind === "burn") {
      // ODD CYCLE: Buyback & Burn
      if (!run.bought && run.buyTx) {
        const settled = await settle(run.buyTx);
        if (settled) run.bought = true;
        else delete run.buyTx;
        savePending(run);
      }
      if (!run.bought) {
        botState.status = "buyback";
        const isGraduated = await curve.graduated().catch(() => false);
        const walletBal = await provider.getBalance(wallet.address);
        const maxSpendable = walletBal > gasBuffer ? walletBal - gasBuffer : 0n;
        // Only what this run claimed is spent, never the rest of the wallet
        const buyAmountWei = claimWei < maxSpendable ? claimWei : maxSpendable;
        if (buyAmountWei <= 0n) {
          addLog("warn", "[2/3] Insufficient wallet balance for buyback after gas buffer. Will retry.");
          return;
        }
        let buyTx: ethers.TransactionResponse;
        if (isGraduated && !v4Pool) {
          v4Pool = await findGraduationPool(provider, currentConfig.tokenAddress, currentConfig.curveAddress);
          if (!v4Pool) throw new Error("The curve graduated but its Uniswap v4 pool isn't found yet; retrying.");
          addLog("info", `Uniswap v4 pool found: fee ${v4Pool.fee}, tick spacing ${v4Pool.tickSpacing}, hook ${v4Pool.hooks}`);
        }
        if (isGraduated) {
          addLog("info", `[2/3] Token has graduated! Executing Buyback on Uniswap v4 Router (${ethers.formatEther(buyAmountWei)} ETH)...`);
          buyTx = await wallet.sendTransaction({
            to: UNISWAP_V4_UNIVERSAL_ROUTER,
            value: buyAmountWei,
            data: buildUniswapV4Buy(currentConfig.tokenAddress, buyAmountWei, v4Pool!),
            gasLimit: 400000n,
            nonce: await nextNonce()
          });
        } else {
          addLog("info", `[2/3] Token on Bonding Curve. Executing Buyback on Curve DEX (${ethers.formatEther(buyAmountWei)} ETH)...`);
          buyTx = await curve.buy(buyAmountWei, 0n, wallet.address, { value: buyAmountWei, nonce: await nextNonce() });
        }
        run.buyTx = buyTx.hash;
        savePending(run);
        addLog("info", `Buyback Tx broadcasted: ${buyTx.hash}`);
        const rc = await buyTx.wait();
        if (!rc || rc.status !== 1) throw new Error(`buy ${buyTx.hash} failed`);
        run.bought = true;
        savePending(run);
        addLog("success", `Buyback succeeded (${ethers.formatEther(buyAmountWei)} ETH)!`);
      }

      // 3. BURN exactly what this run bought; whatever was already in the wallet stays
      if (!run.burned && run.burnTx) {
        const settled = await settle(run.burnTx);
        if (settled) run.burned = true;
        else delete run.burnTx;
        savePending(run);
      }
      if (!run.burned) {
        botState.status = "burning";
        const tokenSymbol = await token.symbol().catch(() => "TOKEN");
        const tokenBalance: bigint = await token.balanceOf(wallet.address);
        const before = BigInt(run.tokensBefore);
        const toBurn = tokenBalance > before ? tokenBalance - before : 0n;
        const formatted = ethers.formatUnits(toBurn, 18);
        if (toBurn > 0n) {
          addLog("info", `[3/3] Burning ${formatted} $${tokenSymbol} to DEAD_ADDRESS...`);
          const burnTx = await token.transfer(DEAD_ADDRESS, toBurn, { nonce: await nextNonce() });
          run.burnTx = burnTx.hash;
          savePending(run);
          addLog("info", `Burn Tx broadcasted: ${burnTx.hash}`);
          const rc = await burnTx.wait();
          if (!rc || rc.status !== 1) throw new Error(`burn ${burnTx.hash} failed`);
          addLog("success", `COMPLETED: ${formatted} $${tokenSymbol} PERMANENTLY INCINERATED!`);
        } else {
          addLog("warn", `[3/3] No newly bought $${tokenSymbol} to burn.`);
        }
        run.burned = true;
        savePending(run);
      }
    } else {
      // EVEN CYCLE: KEEP (forwarded to the treasury address, or kept in the operator wallet)
      const toTreasury = isValidAddress(currentConfig.treasuryAddress) && currentConfig.treasuryAddress.toLowerCase() !== wallet.address.toLowerCase();
      if (toTreasury && !run.sent && run.sendTx) {
        const settled = await settle(run.sendTx);
        if (settled) run.sent = true;
        else delete run.sendTx;
        savePending(run);
      }
      if (toTreasury && !run.sent) {
        addLog("info", `[2/2 - KEEP] Forwarding ${ethers.formatEther(claimWei)} ETH to Treasury: ${currentConfig.treasuryAddress}...`);
        const transferGasBuffer = ethers.parseEther("0.0003");
        const currentBal = await provider.getBalance(wallet.address);
        let sendWei = claimWei;
        if (currentBal - sendWei < transferGasBuffer) {
          sendWei = currentBal > transferGasBuffer ? currentBal - transferGasBuffer : 0n;
        }
        if (sendWei > 0n) {
          const sendTx = await wallet.sendTransaction({ to: currentConfig.treasuryAddress, value: sendWei, nonce: await nextNonce() });
          run.sendTx = sendTx.hash;
          savePending(run);
          const rc = await sendTx.wait();
          if (!rc || rc.status !== 1) throw new Error(`treasury send ${sendTx.hash} failed`);
          addLog("success", `[KEEP] Successfully forwarded ${ethers.formatEther(sendWei)} ETH to Treasury! Tx: ${sendTx.hash}`);
        }
        run.sent = true;
        savePending(run);
      } else if (!toTreasury) {
        addLog("success", `[2/2 - KEEP] ${ethers.formatEther(claimWei)} ETH successfully kept in operator wallet (will not be touched by buyback).`);
      }
      botState.totalFeesRetainedETH = (parseFloat(botState.totalFeesRetainedETH || "0.0") + claimedVal).toFixed(4);
    }

    botState.totalCyclesExecuted++;
    saveConfigToFile({ cycleCount: botState.totalCyclesExecuted });
    savePending(null);
  } catch (err: any) {
    addLog("error", `Cycle execution error: ${err.message || err}`);
  } finally {
    isExecuting = false;
    botState.status = "standby";
  }
}

// Loop berulang
setInterval(() => {
  executeCycle().catch((e) => addLog("error", `Loop error: ${e.message}`));
}, currentConfig.pollIntervalSeconds * 1000);

// Pengecekan pertama kali jalan
executeCycle().catch(console.error);

// -------------------------------------------------------------
// NATIVE HTTP API SERVER (Untuk komunikasi langsung dengan /memex)
// -------------------------------------------------------------

// Rahasia admin untuk /memex. Tanpa ADMIN_SECRET (min. 16 karakter), API menolak SEMUA perubahan config:
// token, treasury dan private key hanya bisa diganti oleh yang tahu rahasianya.
const ADMIN_SECRET = (process.env.ADMIN_SECRET || "").trim();
const ADMIN_ENABLED = ADMIN_SECRET.length >= 16;
const MAX_BODY_BYTES = 16 * 1024;

function isAdmin(req: http.IncomingMessage): boolean {
  if (!ADMIN_ENABLED) return false;
  const got = String(req.headers["x-admin-secret"] || "");
  // bandingkan hash, waktu konstan: panjang dan isi rahasia tidak bocor lewat timing
  const a = crypto.createHash("sha256").update(got).digest();
  const b = crypto.createHash("sha256").update(ADMIN_SECRET).digest();
  return crypto.timingSafeEqual(a, b);
}

function sendJSON(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-secret"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-secret"
    });
    res.end();
    return;
  }

  const url = req.url || "/";

  // Endpoint 1: GET /api/status
  if (req.method === "GET" && (url === "/api/status" || url === "/api/status/")) {
    return sendJSON(res, 200, {
      success: true,
      data: {
        online: true,
        status: botState.status,
        walletAddress: botState.walletAddress,
        tokenAddress: currentConfig.tokenAddress,
        curveAddress: currentConfig.curveAddress,
        treasuryAddress: currentConfig.treasuryAddress,
        claimThresholdETH: currentConfig.claimThresholdETH,
        escrowBalanceETH: botState.escrowBalanceETH,
        totalFeesClaimedETH: botState.totalFeesClaimedETH,
        totalFeesRetainedETH: botState.totalFeesRetainedETH,
        totalCyclesExecuted: botState.totalCyclesExecuted,
        nextCycleType: (botState.totalCyclesExecuted + 1) % 2 === 1 ? "burn" : "keep",
        lastCycleTime: botState.lastCycleTime,
        pollIntervalSeconds: currentConfig.pollIntervalSeconds,
        logs: botState.logs
      }
    });
  }

  // Endpoint 2: POST /api/config atau POST /api/admin/save
  if (req.method === "POST" && (url === "/api/config" || url === "/api/admin/save" || url === "/api/config/")) {
    if (!ADMIN_ENABLED) {
      addLog("warn", "[SECURITY] Perubahan config ditolak: ADMIN_SECRET belum di-set di bot.");
      return sendJSON(res, 503, { success: false, error: "ADMIN_SECRET is not set on the bot (min. 16 characters), so admin changes are disabled." });
    }
    if (!isAdmin(req)) {
      addLog("warn", "[SECURITY] Perubahan config ditolak: admin secret salah.");
      return sendJSON(res, 401, { success: false, error: "Wrong admin secret." });
    }
    let body = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        const data = JSON.parse(body || "{}");
        let updated = false;

        if (data.tokenAddress !== undefined) {
          const cleanToken = data.tokenAddress.trim();
          currentConfig.tokenAddress = cleanToken;
          updated = true;
          addLog("info", `[CONFIG] Token Address diperbarui dari /memex: ${cleanToken || "Dikosongkan"}`);
        }

        if (data.treasuryAddress !== undefined) {
          const cleanTreasury = data.treasuryAddress.trim();
          currentConfig.treasuryAddress = cleanTreasury;
          updated = true;
          addLog("info", `[CONFIG] Treasury Address diperbarui: ${cleanTreasury || "Dikosongkan"}`);
        }

        if (data.privateKey !== undefined) {
          const cleanKey = data.privateKey.trim();
          currentConfig.privateKey = cleanKey;
          initWallet();
          updated = true;
          addLog("info", `[CONFIG] Operator Private Key diperbarui dari /memex. Address: ${botState.walletAddress || "None"}`);
        }

        if (updated) {
          saveConfigToFile({
            tokenAddress: currentConfig.tokenAddress,
            treasuryAddress: currentConfig.treasuryAddress,
            privateKey: currentConfig.privateKey
          });
        }

        return sendJSON(res, 200, {
          success: true,
          message: "Konfigurasi bot berhasil diperbarui",
          tokenAddress: currentConfig.tokenAddress,
          treasuryAddress: currentConfig.treasuryAddress,
          walletAddress: botState.walletAddress
        });
      } catch (err: any) {
        return sendJSON(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // Tolak route lain
  return sendJSON(res, 404, { success: false, error: "Not Found" });
});

const PORT = currentConfig.port || 5015;

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[API] Port ${PORT} sedang dipakai. Mencoba port ${PORT + 1}...`);
    try {
      server.listen(PORT + 1, "0.0.0.0");
    } catch (e) {
      console.warn("API server dialihkan, proses bot tetap berjalan.");
    }
  } else {
    console.error("[API Error]:", err.message);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("==========================================================");
  console.log(`BLAZE AUTONOMOUS BURN ENGINE & API SERVER ACTIVE`);
  console.log(`   Server Port      : ${PORT}`);
  console.log(`   Admin API Ready  : http://localhost:${PORT}/api/status`);
  console.log(`   Operator Wallet  : ${botState.walletAddress || "Not ready"}`);
  console.log(`   Admin Changes    : ${ADMIN_ENABLED ? "ON (x-admin-secret required)" : "OFF (set ADMIN_SECRET, min. 16 chars, to enable /memex)"}`);
  console.log(`   Initial Status   : ${isValidAddress(currentConfig.tokenAddress) ? "ACTIVE" : "STANDBY (Awaiting CA from /memex)"}`);
  console.log("==========================================================");
});
