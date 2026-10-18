/**
 * End-to-end run of the burn bot against a throwaway local chain (never mainnet).
 *
 * Needs a dev node with chain id 4663 that supports hardhat_setCode / hardhat_mine, e.g.
 *   npx hardhat node --port 8599      (hardhat.config: networks.hardhat.chainId = 4663)
 * then: E2E_RPC=http://127.0.0.1:8599 npm run test:e2e
 *
 * A stand-in escrow sits at the real Pons escrow address; the token and a curve with the Pons
 * curve's buy() signature are real contracts (test/PonsLike.sol, compiled into test/ponslike.json).
 * The bot under test is the unmodified bot/pons-burn-bot.ts. Checks marked FINDING record
 * behaviour worth knowing before launch rather than failing the run.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const RPC = process.env.E2E_RPC || "http://127.0.0.1:8599";
const PORT = 5419;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(ROOT, ".e2e");
const API = `http://127.0.0.1:${PORT}`;
const ART = JSON.parse(fs.readFileSync(path.join(ROOT, "test/ponslike.json"), "utf-8"));

const ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const DEAD = "0x000000000000000000000000000000000000dEaD";
// balanceOf(any) → this contract's ETH; claim() → sends all of it to the caller
const ESCROW_CODE = "0x5f3560e01c634e71d92d14601557475f5260205ff35b5f5f5f5f47335af100";
const MNEMONIC = "test test test test test test test test test test test junk";
const dev = (i: number) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
const OPERATOR_KEY = dev(0).privateKey;
const ADMIN_SECRET = "e2e-admin-secret-0123456789";

const provider = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true, cacheTimeout: -1 });
const T = (n: number) => ethers.parseUnits(String(n), 18);
const E = (s: string) => ethers.parseEther(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let engine: ChildProcess | null = null;
let passed = 0;
const findings: string[] = [];
function ok(cond: unknown, what: string) {
  assert.ok(cond, what);
  passed++;
  console.log(`  ✔ ${what}`);
}
function finding(what: string) {
  findings.push(what);
  console.log(`  ! FINDING: ${what}`);
}

function startEngine(env: Record<string, string>) {
  engine = spawn(process.execPath, ["--import", "tsx", path.join(ROOT, "bot/pons-burn-bot.ts")], { cwd: WORK, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const out = fs.createWriteStream(path.join(WORK, "engine.log"), { flags: "a" });
  engine.stdout!.pipe(out);
  engine.stderr!.pipe(out);
}
async function stopEngine() {
  if (!engine) return;
  const done = new Promise((r) => engine!.once("exit", r));
  engine.kill("SIGKILL");
  await done;
  engine = null;
}
const log = () => (fs.existsSync(path.join(WORK, "engine.log")) ? fs.readFileSync(path.join(WORK, "engine.log"), "utf-8") : "");
const status = async (): Promise<any> => ((await (await fetch(API + "/api/status", { signal: AbortSignal.timeout(5000) })).json()) as any).data;
async function until<T>(what: string, read: () => Promise<T | false | null | undefined>, seconds = 60): Promise<T> {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const v = await read().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}\n${log().split("\n").slice(-25).join("\n")}`);
    await sleep(300);
  }
}
const cyclesDone = (n: number) => until(`cycle #${n} to finish`, async () => ((await status()).totalCyclesExecuted >= n ? status() : null));

async function main() {
  assert.equal(BigInt(await provider.send("eth_chainId", [])), 4663n, "the dev node must use chain id 4663");
  await provider.send("hardhat_reset", []);
  await provider.send("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000)]);
  await provider.send("hardhat_mine", ["0x1"]);
  const accounts: string[] = await provider.send("eth_accounts", []);
  const operator = new ethers.Wallet(OPERATOR_KEY, provider);
  assert.equal(operator.address.toLowerCase(), accounts[0].toLowerCase(), "account 0 must be the default dev account");
  const deployer = await provider.getSigner(accounts[8]);
  const treasury = accounts[9];
  const bal = (a: string) => provider.getBalance(a);

  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  await provider.send("hardhat_setCode", [ESCROW, ESCROW_CODE]);
  await provider.send("hardhat_setBalance", [ESCROW, "0x0"]);

  const token = (await new ethers.ContractFactory(ART.TestToken.abi, ART.TestToken.bytecode, deployer).deploy(T(1_000_000_000))) as ethers.Contract;
  await token.waitForDeployment();
  const curve = (await new ethers.ContractFactory(ART.TestCurve.abi, ART.TestCurve.bytecode, deployer).deploy(await token.getAddress(), 100_000_000n)) as ethers.Contract;
  await curve.waitForDeployment();
  const TOKEN = await token.getAddress();
  const CURVE = await curve.getAddress();
  await (await token.setCurve(CURVE)).wait();
  await (await token.transfer(CURVE, T(900_000_000))).wait();
  const fundEscrow = async (eth: string) => (await deployer.sendTransaction({ to: ESCROW, value: E(eth) })).wait();
  const dead = () => token.balanceOf(DEAD) as Promise<bigint>;

  // the creator's own dev buy at launch, sitting in the operator wallet
  const DEV_BAG = T(500_000);
  await (await (curve.connect(operator) as ethers.Contract).buy(E("0.005"), 0n, operator.address, { value: E("0.005") })).wait();
  const devBag = (await token.balanceOf(operator.address)) as bigint;
  assert.ok(devBag >= DEV_BAG, "the dev buy landed");

  const env = { RPC_URL: RPC, PORT: String(PORT), TOKEN_ADDRESS: TOKEN, TREASURY_ADDRESS: treasury, CREATOR_PRIVATE_KEY: OPERATOR_KEY, POLL_INTERVAL_SECONDS: "1", ADMIN_SECRET, TX_TIMEOUT_SECONDS: "5" };
  startEngine(env);

  console.log("\nStart-up");
  const st = await until("the bot API", () => status());
  ok(st.walletAddress.toLowerCase() === operator.address.toLowerCase(), "bot runs on the operator wallet");
  await until("the curve to be detected", async () => ((await status()).curveAddress?.toLowerCase() === CURVE.toLowerCase() ? true : null));
  ok(true, "the curve is read from token.curve(), as on Pons");
  ok(!JSON.stringify(await status()).includes(OPERATOR_KEY.slice(2)), "the operator key is never served by /api/status");

  console.log("\nAdmin");
  const save = (body: object, secret?: string) =>
    fetch(API + "/api/admin/save", { method: "POST", headers: { "content-type": "application/json", ...(secret !== undefined ? { "x-admin-secret": secret } : {}) }, body: JSON.stringify(body) });
  const treasuryNow = async () => ((await status()).treasuryAddress || "").toLowerCase();
  for (const path of ["/api/admin/save", "/api/config"]) {
    const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ treasuryAddress: accounts[7], tokenAddress: accounts[8], privateKey: dev(9).privateKey }) });
    ok(r.status === 401 && (await treasuryNow()) === treasury.toLowerCase(), `${path} without the secret is refused (401) and changes nothing`);
  }
  const wrong = await save({ treasuryAddress: accounts[7] }, ADMIN_SECRET + "x");
  ok(wrong.status === 401 && (await treasuryNow()) === treasury.toLowerCase(), "a wrong secret is refused (401)");
  const st2 = await status();
  ok(st2.walletAddress.toLowerCase() === operator.address.toLowerCase() && st2.tokenAddress.toLowerCase() === TOKEN.toLowerCase(), "the key and the token are untouched after the refused calls");
  const right = await save({ treasuryAddress: accounts[7] }, ADMIN_SECRET);
  ok(right.status === 200 && (await treasuryNow()) === accounts[7].toLowerCase(), "the right secret can change the treasury");
  await save({ treasuryAddress: treasury }, ADMIN_SECRET);
  ok((await treasuryNow()) === treasury.toLowerCase(), "and change it back");

  console.log("\nBurn #1 (odd cycle)");
  const curveEth1 = await bal(CURVE);
  const dead1 = await dead();
  await fundEscrow("0.009");
  await sleep(3500);
  ok((await status()).totalCyclesExecuted === 0 && (await dead()) === dead1, "nothing happens below the 0.01 ETH threshold");
  await fundEscrow("0.002");
  await cyclesDone(1);
  const burned1 = (await dead()) - dead1;
  ok(burned1 > 0n, `${ethers.formatUnits(burned1, 18)} tokens reached the dead address`);
  ok((await bal(CURVE)) - curveEth1 === E("0.011"), "all 0.011 ETH claimed went into the buy on the curve");
  ok((await bal(ESCROW)) === 0n, "the escrow was emptied by the claim");
  const boughtNow = burned1 - devBag;
  if ((await token.balanceOf(operator.address)) === 0n && burned1 >= devBag) {
    finding(`the burn sends the operator wallet's WHOLE token balance to 0x…dEaD: the creator's dev buy (${ethers.formatUnits(devBag, 18)}) was burned along with the ${ethers.formatUnits(boughtNow, 18)} bought back`);
  } else ok(true, "the dev bag in the operator wallet was left alone");

  console.log("\nKeep #2 (even cycle)");
  const t2 = await bal(treasury);
  await fundEscrow("0.019");
  await sleep(3500);
  ok((await status()).totalCyclesExecuted === 1, "the even cycle waits for 0.02 ETH");
  await fundEscrow("0.001");
  await cyclesDone(2);
  ok((await bal(treasury)) - t2 === E("0.02"), "the 0.02 ETH goes to the treasury, all of it");

  console.log("\nBurn #3, with the bot killed right after the claim");
  const dead3 = await dead();
  const opEth3 = await bal(operator.address);
  await provider.send("evm_setAutomine", [false]);
  await deployer.sendTransaction({ to: ESCROW, value: E("0.01") });
  await provider.send("hardhat_mine", ["0x1"]);
  await until("the claim of cycle #3 to be sent", async () => (/Cycle #3 - BURN\] THRESHOLD[\s\S]*Claim Tx broadcasted/.test(log()) ? true : null));
  await stopEngine();
  await provider.send("hardhat_mine", ["0x1"]);
  await provider.send("evm_setAutomine", [true]);
  const nonce3 = await provider.getTransactionCount(operator.address);
  startEngine(env);
  await cyclesDone(3);
  const burned3 = (await dead()) - dead3;
  const stranded = (await bal(operator.address)) - opEth3;
  ok(burned3 > 0n, `after the restart the claimed ETH was still bought and burned (${ethers.formatUnits(burned3, 18)})`);
  const sent3 = (await provider.getTransactionCount(operator.address)) - nonce3;
  ok(sent3 === 2, `the restart sent only the buy and the burn: no second claim (sent ${sent3})`);
  ok(stranded < E("0.001"), `no claimed ETH left behind in the operator wallet (change ${ethers.formatEther(stranded)} ETH, gas only)`);
  ok((await token.balanceOf(operator.address)) === devBag, "the dev bag is still untouched");

  await stopEngine();
  startEngine(env);
  await until("the bot to come back", () => status());
  await sleep(4000);
  ok((await dead()) - dead3 === burned3 && (await status()).totalCyclesExecuted === 3, "a second restart after the run is done burns nothing more");

  console.log("\nKeep #4, with the claim stuck in the mempool");
  const t4 = await bal(treasury);
  await provider.send("evm_setAutomine", [false]);
  await deployer.sendTransaction({ to: ESCROW, value: E("0.02") });
  await provider.send("hardhat_mine", ["0x1"]);
  await until("the claim of cycle #4 to be sent", async () => (/Cycle #4 - KEEP\] THRESHOLD[\s\S]*Claim Tx broadcasted/.test(log()) ? true : null));
  const nonce4 = await provider.getTransactionCount(operator.address, "latest");
  await sleep(14000);
  const timeouts = (log().match(/still pending after 5s/g) || []).length;
  ok(timeouts >= 2, `a claim stuck in the mempool times out and is checked again, instead of hanging the loop (${timeouts} checks)`);
  const st4 = await status();
  ok(Date.now() - st4.lastTickAt < 8000 && st4.busyForSeconds <= 7, `the heartbeat keeps beating while it is stuck (busy for ${st4.busyForSeconds}s at most per check)`);
  const pending4 = (await provider.getTransactionCount(operator.address, "pending")) - nonce4;
  ok(pending4 === 1, `the stuck claim is never sent a second time (${pending4} pending)`);
  await provider.send("hardhat_mine", ["0x1"]);
  await provider.send("evm_setAutomine", [true]);
  await cyclesDone(4);
  ok((await bal(treasury)) - t4 === E("0.02"), "once it is mined the run finishes: the 0.02 ETH reaches the treasury");
  ok(st4.operatorBalanceETH !== "" && st4.gasLow === false, `the operator's gas is reported (${st4.operatorBalanceETH} ETH, not low)`);

  await stopEngine();
  console.log(`\n${passed} checks passed, ${findings.length} findings.`);
  for (const f of findings) console.log(`  - ${f}`);
}

main()
  .catch(async (e) => {
    console.error("\nFAILED:", e.message || e);
    await stopEngine();
    process.exit(1);
  })
  .then(() => process.exit(0));
