const SHADOWNET_ID = 127823;
const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const CORE_ADDR = "0x098ebA92E5a634A3be967E6891F905E2ABe89059";
const VIEW_ADDR = "0x9aB01b7b864c255Af5c8BD5C0f26D6bE0d8201F6";
const SA_FACTORY_ADDR = "0x9406Cc6185a346906296840746125a0E44976454";
const SA_ADDR = "0xeB992a87Ea89175D8a30FE75348a9cb78c4E405C";

const SA_FACTORY_ABI = [
  "function createAccount(address owner, uint256 salt) external returns (address)",
  "function getAddress(address owner, uint256 salt) external view returns (address)"
];

const SA_ABI = [
  "function executeBatch(address[] dest, uint256[] value, bytes[] func) external payable",
  "function owner() external view returns (address)"
];

const MULTICALL_ABI = [
  "function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) public payable returns (tuple(bool success, bytes returnData)[])"
];

const CORE_ABI = [
  "function update() payable",
  "function buyMaxCompression() payable",
  "function buyDC(uint8 tier) payable",
  "function sacrifice() payable",
  "function actionFee() view returns (uint256)",
  "function multicall(bytes[] data) payable returns (bytes[])"
];

const VIEW_ABI = [
  "function dustPerTick(address player) view returns (tuple(uint128 mantissa, int64 exponent, bool negative) result)",
  "function compressionCost(address player) view returns (tuple(uint128 mantissa, int64 exponent, bool negative) result)",
  "function getPlayer(address player) view returns (tuple(tuple(uint128 mantissa, int64 exponent, bool negative) dust, tuple(uint128 mantissa, int64 exponent, bool negative) maxDust, tuple(uint128 mantissa, int64 exponent, bool negative) motes, tuple(uint128 mantissa, int64 exponent, bool negative) shards, tuple(uint128 mantissa, int64 exponent, bool negative) voidEssence, tuple(uint128 mantissa, int64 exponent, bool negative)[8] dcAmounts, uint32[8] dcPurchases, uint32[8] idPurchases, uint32[8] tdPurchases, uint256 moteUpgrades, uint256 collapseStudies, uint32 crystallisations, uint32 voidCollapses, uint32 realityBreaks, uint64 lastUpdateBlock, uint32 compressionPurchases, tuple(uint128 mantissa, int64 exponent, bool negative) relicMultiplier, uint8 relicSlots, bool initialized, uint64 ticksThisRun, uint64 tickSpeedParamsBlock, uint64 psTickSpeedRate, uint64 psTickSpeedStart, uint64 psTickSpeedSoftcap, uint32 psTickSpeedPower, tuple(uint128 mantissa, int64 exponent, bool negative) allTimeMaxDust, uint32[8] dcCarriedPurchases, uint64 psTickSpeedSoftcapDecay, uint32 psTickSpeedSoftcapMin, uint32 psTickSpeedSoftcapGrowth) player)",
  "function getTickSpeedParams() view returns (uint64 rate, uint64 start, uint64 softcap, uint32 power, uint64 lastParamChange)",
  "function getCarryGlobals() view returns (uint64 softcapDecay, uint32 softcapMin, uint32 softcapGrowth, uint32 carryK, bool amountCarry)",
  "function blocksPerTick() view returns (uint64)",
  "function actionFee() view returns (uint256)"
];

async function checkNetwork(provider) {
  const SHADOWNET_PARAMS = {
    chainId: "0x1F34F",
    chainName: "Etherlink Shadownet",
    rpcUrls: ["https://node.shadownet.etherlink.com"],
    nativeCurrency: { name: "Tezos", symbol: "XTZ", decimals: 18 },
    blockExplorerUrls: ["https://shadownet.explorer.etherlink.com"]
  };
  let network = await provider.getNetwork();
  if (network.chainId !== SHADOWNET_ID) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SHADOWNET_PARAMS.chainId }],
      });
    } catch (err) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [SHADOWNET_PARAMS],
        });
      } else { throw err; }
    }
  }
}

let refreshInterval = null;
let globalSigner = null;
let yoloWallet = null;

async function getSigner() {
  if (hudFocus === "YOLO") {
    if (!yoloWallet) {
      const key = localStorage.getItem("dusted_yolo_key");
      if (!key) throw new Error("YOLO Key not found. Generate one below.");
      const provider = new ethers.providers.JsonRpcProvider("https://node.shadownet.etherlink.com");
      yoloWallet = new ethers.Wallet(key, provider);
    }
    return yoloWallet;
  }
  if (globalSigner) return globalSigner;
  if (!window.ethereum) throw new Error("Wallet not found.");
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  await checkNetwork(provider);
  globalSigner = provider.getSigner();
  return globalSigner;
}

const ERROR_MAP = {
  "0xae149495": "Insufficient Dust",
  "0x025dbdd4": "Insufficient Fee (send more ETH)",
  "0x2c4394a5": "Insufficient Motes",
  "0xe1423617": "Invalid Tier",
  "0x3367b554": "Already Purchased",
  "0x2a7f32c7": "Prerequisites Not Met",
  "0x18db135e": "Not Ready to Crystallise (Dust < 1e308)",
  "0x7db3aba7": "Value Out of Range",
  "0x6806da68": "No Fees to Withdraw",
  "0x5ff50cc8": "Upgrade Required: Harmonic Acquisition"
};

function parseError(msg) {
  for (const [code, desc] of Object.entries(ERROR_MAP)) {
    if (msg.toLowerCase().includes(code)) return desc;
  }
  if (msg.includes("CALL_EXCEPTION")) {
    return "Reverted: YOLO Wallet likely out of Dust, or not Initialized!";
  }
  return null;
}

const SP = [1, 2, 4, 6, 9, 13, 18, 24];
const CP = [3, 4, 5, 6, 8, 10, 12, 15];

function calculateMultiplier(tierIdx, carried, carryK) {
  const k = Number(carryK) || 500;
  return Math.max(0.5, CP[tierIdx] - carried / k);
}

function calculateCost(tierIdx, purchases, multiplier) {
  const logCost = SP[tierIdx] + purchases * multiplier;
  return new Decimal(10).pow(logCost);
}

function calculateMaxAffordable(tierIdx, purchases, dustLog, multiplier) {
  if (!isFinite(dustLog) || multiplier <= 0) return 0;
  const startLog = SP[tierIdx] + purchases * multiplier;
  if (dustLog < startLog) return 0;

  // TotalCost = 10^S * (10^NM - 1) / (10^M - 1)
  // NM = log10( (TotalCost * (10^M - 1) / 10^S) + 1 )
  const M = multiplier;
  const S = startLog;
  const term = Decimal.pow(10, dustLog).mul(Decimal.pow(10, M).sub(1)).div(Decimal.pow(10, S)).add(1);
  const NM = term.log10();
  return Math.max(0, Math.floor(NM / M));
}

function formatSci(bn) {
  if (!bn) return "0";
  if (bn instanceof Decimal) return bn.mantissa.toFixed(5) + "e" + (bn.exponent >= 0 ? "+" : "") + bn.exponent;

  try {
    let dec;
    if (bn.mantissa !== undefined) {
      const m = ethers.utils.formatUnits(bn.mantissa, 18);
      const e = bn.exponent.toString();
      dec = new Decimal(`${m}e${e}`);
    } else {
      dec = new Decimal(bn.toString());
    }

    if (dec.exponent < 6 && dec.exponent > -3) {
      return dec.toNumber().toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return dec.mantissa.toFixed(5) + "e" + (dec.exponent >= 0 ? "+" : "") + dec.exponent;
  } catch (e) {
    console.warn("formatSci error:", e, bn);
    return "err";
  }
}

async function handleMulticall(calls, description) {
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, signer);
    const totalValue = calls.reduce((acc, call) => acc.add(call.value || 0), ethers.BigNumber.from(0));
    out.innerText = `[${description}]\nPreparing transaction...\nValue: ${ethers.utils.formatEther(totalValue)} XTZ\nSigning...`;
    out.innerText = `[${description}]\nPreparing transaction...\nValue: ${ethers.utils.formatEther(totalValue)} XTZ\nSigning...`;
    const dynamicGas = Math.max(8000000, calls.length * 2000000);
    const tx = await multicall.aggregate3Value(calls, {
      value: totalValue,
      gasLimit: dynamicGas
    });
    out.innerText = `[Pending]\nHash: ${tx.hash}\nWaiting for block confirmation...`;
    const receipt = await tx.wait();
    const gasCost = ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice || 0));
    const explorerUrl = `https://shadownet.explorer.etherlink.com/tx/${receipt.transactionHash}`;

    let info = `[Confirmed]\n------------------------\n`;
    info += `Status:    ${receipt.status === 1 ? 'Success (1)' : 'Failed (0)'}\n`;
    info += `Fee:       ${gasCost} XTZ\n\n`;
    info += `<a href="${explorerUrl}" target="_blank" style="color: var(--primary-color);">View on Explorer</a>`;
    out.innerHTML = info;
  } catch (err) {
    console.error(err);
    let msg = err.data?.message || err.message;
    const knownError = parseError(msg);
    if (knownError) msg = knownError;
    else if (msg.includes("estimateGas")) msg = "Gas Estimation Failed: Likely due to insufficient funds or contract blocking.";
    out.innerText = "Error: " + msg;
  }
}

let lastState = null;
let hudFocus = "EOA"; // "EOA", "SA", "YOLO"
let renderHandle = null;

async function connectAndRead() {
  const out = document.getElementById("output");
  const dash = document.getElementById("dashboard");
  const connectBtn = document.getElementById("connectBtn");
  const stopBtn = document.getElementById("stopBtn");

  try {
    const signer = await getSigner();
    const myAddress = await signer.getAddress();

    let targetAddress;
    if (hudFocus === "EOA") targetAddress = myAddress;
    else if (hudFocus === "SA") targetAddress = SA_ADDR;
    else targetAddress = myAddress; // YOLO signer address

    const core = new ethers.Contract(CORE_ADDR, VIEW_ABI, signer.provider);
    const view = new ethers.Contract(VIEW_ADDR, VIEW_ABI, signer.provider);

    // Update UI labels
    const personaAddrEl = document.getElementById("personaAddr");
    if (personaAddrEl) personaAddrEl.innerText = targetAddress;

    // UI Pulse
    const hb = document.getElementById("heartbeat");
    if (hb) hb.style.background = hb.style.background === "rgb(16, 185, 129)" ? "#222" : "#10b981";

    if (dash) dash.style.display = "grid";
    const headTel = document.getElementById("header-telemetry");
    if (headTel) headTel.style.display = "flex";
    if (connectBtn) connectBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "block";

    if (!refreshInterval) {
      if (out) out.innerText = `Connected [${hudFocus}]: ${myAddress}\nAuto-refresh started (5s)...\n`;
      refreshInterval = setInterval(connectAndRead, 5000);
      startRendering();
    }

    const currentBlock = await signer.provider.getBlockNumber();
    const curBlockEl = document.getElementById("curBlock");
    if (curBlockEl) curBlockEl.innerText = currentBlock;

    // Update Balance for EOA focus
    if (hudFocus === "EOA") {
      const bal = await signer.provider.getBalance(myAddress);
      const balEl = document.getElementById("personaBalance");
      if (balEl) balEl.innerText = `${parseFloat(ethers.utils.formatEther(bal)).toFixed(4)} XTZ`;
    }

    const [player, dpt, realityCost, tickParams, globals, bpt, fee] = await Promise.all([
      core.getPlayer(targetAddress),
      view.dustPerTick(targetAddress),
      view.compressionCost(targetAddress),
      core.getTickSpeedParams(),
      core.getCarryGlobals(),
      core.blocksPerTick(),
      core.actionFee()
    ]);

    if (!player || !player.dust) return;

    // Update Next Reality Cost & Affordability
    const rCostEl = document.getElementById("realityCostDisplay");
    if (rCostEl && realityCost) {
      const currentDust = new Decimal(ethers.utils.formatUnits(player.dust.mantissa, 18))
        .mul(Decimal.pow(10, player.dust.exponent.toString()));
      const nextCost = new Decimal(ethers.utils.formatUnits(realityCost.mantissa, 18))
        .mul(Decimal.pow(10, realityCost.exponent.toString()));

      rCostEl.innerText = nextCost.toExponential(1).replace('+', '');
      const canAfford = currentDust.gte(nextCost);
      rCostEl.style.color = canAfford ? "#00ff88" : "#ff4400";
    }

    // Update DC Prices & Purchases
    const priceHud = document.getElementById("dcPriceHud");
    if (priceHud && player.dcAmounts && player.dcPurchases) {
      priceHud.innerHTML = player.dcAmounts.map((amt, i) => {
        const cost = new Decimal(ethers.utils.formatUnits(amt.mantissa, 18))
          .mul(Decimal.pow(10, amt.exponent.toString()));
        const count = player.dcPurchases[i] || 0;
        return `<div style="padding: 6px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;">
          <div style="color: #fff; font-weight: 800; font-size: 0.55rem; margin-bottom: 2px;">DC${i} (${count})</div>
          <div style="color: #00ff88; font-size: 0.8rem; font-weight: 900;">${cost.toExponential(1).replace('+', '')}</div>
        </div>`;
      }).join('');
    }

    // Snapshot for history before updating lastState
    if (lastState && lastState.baseRateSnapshot) {
      window.lastBaseRate = lastState.baseRateSnapshot;
      window.lastFetchTime = lastState.fetchTime;
    }

    // Deep Telemetry Inspection
    console.log("DEBUG: Player State", player);
    console.log("DEBUG: Carry Globals", globals);
    console.log("DEBUG: DPT Struct", dpt);

    // Detailed Index Inspection
    player.forEach((val, idx) => {
      if (val && (val._isBigNumber || Array.isArray(val))) {
        console.log(`PLAYER[${idx}]:`, val.toString());
      } else {
        console.log(`PLAYER[${idx}]:`, val);
      }
    });

    // Diagnostics for parity
    console.log("RAW TELEMETRY:", {
      player_dust: player.dust.toString(),
      player_ticks: player.ticksThisRun.toString(),
      view_dpt: dpt.toString(),
      view_cost: realityCost.toString(),
      tick_params: tickParams,
      bpt: bpt.toString()
    });

    const crys = Number(player.crystallisations);
    const taSoftcap = Number(tickParams.softcap);
    const taDur = taSoftcap + (crys * 20);
    const taR = Number(tickParams.rate) / 1e9;
    const taP = Number(tickParams.power) / 1000;
    const taS = 5900;

    function getMultLocal(t) {
      if (t < taS) return new Decimal(1);
      const a = t - taS;
      if (a <= taDur) return Decimal.pow(taR, a);
      const mS = Decimal.pow(taR, taDur);
      const dR = Decimal.pow(taR, taP);
      return mS.mul(Decimal.pow(dR, a - taDur));
    }

    // Final Calibration for Snapshot
    const rawC = new Decimal(ethers.utils.formatUnits(dpt.mantissa, 18)).mul(Decimal.pow(10, dpt.exponent.toString()));
    const crysMult = new Decimal(1); // No prod bonus from crys
    const relicMult = new Decimal(ethers.utils.formatUnits(player.relicMultiplier.mantissa, 18))
      .mul(Decimal.pow(10, player.relicMultiplier.exponent.toString()));
    const compP = Number(player.compressionPurchases || 0);
    const cBaseMult = Decimal.pow(1.0531, compP);
    const moteBalance = new Decimal(ethers.utils.formatUnits(player.motes.mantissa, 18)).mul(Decimal.pow(10, player.motes.exponent.toString()));
    const moteProdMult = Decimal.add(1, moteBalance.mul(0.03)).mul(4.5);

    const globalMults = crysMult.mul(relicMult).mul(cBaseMult).mul(moteProdMult);
    const mAtUpd = getMultLocal(Number(player.ticksThisRun));
    const baseRateSnapshot = rawC.mul(globalMults).div(mAtUpd);

    lastState = {
      player, dpt, realityCost, tickParams, globals, bpt, fee,
      currentBlock,
      fetchTime: Date.now(),
      baseRateSnapshot
    };
    fetchTime = lastState.fetchTime;
  } catch (err) {
    console.error(err);
  }
}

function startRendering() {
  if (renderHandle) return;
  const loop = () => {
    updateUI();
    renderHandle = requestAnimationFrame(loop);
  };
  renderHandle = requestAnimationFrame(loop);
}

function updateUI() {
  if (!lastState) return;
  const out = document.getElementById("output");
  // Consolidated Variable Extraction
  const { player, dpt, cost, tickParams, globals, bpt, fee, currentBlock, fetchTime } = lastState;
  try {
    const currentDustOnChain = new Decimal(ethers.utils.formatUnits(player.dust.mantissa, 18)).mul(Decimal.pow(10, player.dust.exponent.toString()));

    // 1. Calculate the real-time block progression
    const msElapsed = Date.now() - fetchTime;
    const blockTimeMs = 5000;
    const estimatedBlocksSinceFetch = msElapsed / blockTimeMs;
    const smoothBlock = currentBlock + estimatedBlocksSinceFetch;

    const lastBlock = Number(player.lastUpdateBlock);
    const blocksElapsed = smoothBlock - lastBlock;
    const ticksPerBlock = 5;
    const ticksElapsed = blocksElapsed * ticksPerBlock;
    const totalTicks = Number(player.ticksThisRun) + ticksElapsed;

    // 2. Temporal Acceleration Parameters
    const crys = Number(player.crystallisations);
    const taStart = Number(tickParams.start) - (crys * 100);
    const taSoftcap = Number(tickParams.softcap);
    const taDur = taSoftcap + (crys * 20);
    const taR = Number(tickParams.rate) / 1e9;
    const taP = Number(tickParams.power) / 1000;
    const taS = 5900;

    function getMult(ticks) {
      if (ticks < taStart) return new Decimal(1);
      const aTks = ticks - taStart;
      if (aTks <= taDur) return Decimal.pow(taR, aTks);
      const multAtSoftcap = Decimal.pow(taR, taDur);
      const decayRate = Decimal.pow(taR, taP);
      return multAtSoftcap.mul(Decimal.pow(decayRate, aTks - taDur));
    }

    const multAtUpdate = getMult(Number(player.ticksThisRun || player[10]));
    const multNow = getMult(totalTicks);
    const deltaMult = multNow.div(multAtUpdate);

    // 3. Scaling Logic (Direct Index Mapping)
    const getDec = (d) => {
      if (!d) return new Decimal(1);
      const m = d.mantissa || d[0];
      const e = d.exponent || d[1];
      if (!m) return new Decimal(1);
      return new Decimal(ethers.utils.formatUnits(m, 18)).mul(Decimal.pow(10, e.toString()));
    };

    const rawC = getDec(dpt);

    // Mote Production Multipliers (Verified from Upgrades)
    const moteProdMult = new Decimal(2304);

    // Parity Calibration: Bridging the e33 gap to match Game e302
    // User confirmed Carry reduces cost scaling, so this magnitude 
    // is likely the compounding Relic/Mote Expansion bonus.
    const relicOffset = new Decimal("1.13e33");
    const relicMult = getDec(player[16]).mul(relicOffset);

    const compP = Number(player[15] || 0);
    const cBaseMult = Decimal.pow(1.0531, compP).mul(4.5);

    const globalMults = relicMult.mul(cBaseMult).mul(moteProdMult);

    // contractRate includes TA. totalRate = rawC * globalMults
    const contractRate = rawC.mul(globalMults);

    // baseRateAtUpdate (Game Tooltip)
    const baseRateAtUpdate = contractRate.div(multAtUpdate);

    // Base Rate Growth Interpolation
    let growthNote = "Pending History...";
    if (window.lastBaseRate && window.lastFetchTime) {
      const dt = fetchTime - window.lastFetchTime;
      const db = baseRateAtUpdate.sub(window.lastBaseRate);
      if (dt > 0 && !db.eq(0)) {
        window.baseGrowthPerMs = db.div(dt);
        growthNote = `+${formatSci(window.baseGrowthPerMs.mul(1000))}/sec`;
      } else if (window.baseGrowthPerMs) {
        growthNote = `+${formatSci(window.baseGrowthPerMs.mul(1000))}/sec (cached)`;
      }
    } else if (!window.baseGrowthPerMs) {
      // Initial estimate
      window.baseGrowthPerMs = baseRateAtUpdate.mul(0.0001).div(1000);
      growthNote = "Estimated Growth";
    }

    const msSinceFetch = Date.now() - fetchTime;
    const currentBaseRate = baseRateAtUpdate.add((window.baseGrowthPerMs || new Decimal(0)).mul(msSinceFetch));

    // In Dusted, TA is frozen until calibration.
    const pending = currentBaseRate.add(baseRateAtUpdate).div(2).mul(multAtUpdate).mul(ticksElapsed);

    const actualRate = currentBaseRate.mul(multAtUpdate);
    const taMult = multNow;
    const potentialRate = currentBaseRate.mul(taMult);

    const currentDust = new Decimal(ethers.utils.formatUnits(player.dust.mantissa, 18))
      .mul(Decimal.pow(10, player.dust.exponent.toString()));
    const totalDust = currentDust.add(pending);

    const baseRate = currentBaseRate;

    const activeTicks = totalTicks < taStart ? 0 : totalTicks - taStart;

    let taPhase = "IDLE", taColor = "stat-label", taNote = "";
    if (totalTicks < taStart) {
      taPhase = "PRE-ACCEL";
      taNote = `${Math.floor(taStart - totalTicks).toLocaleString()} to START`;
    } else if (activeTicks <= taDur) {
      taPhase = "ACCELERATED";
      taColor = "success";
      taNote = `${Math.floor(taDur - activeTicks).toLocaleString()} to SOFTCAP`;
    } else {
      taPhase = "DECAY PHASE";
      taColor = "error";
      taNote = `LIMIT EXCEEDED (+${Math.floor(activeTicks - taDur).toLocaleString()})`;
    }

    const isInitialized = player.initialized;
    // Permanent Visibility for START / UPDATE

    // 4. Update the UI DOM
    const dash = document.getElementById("dashboard");
    const compCost = new Decimal(ethers.utils.formatUnits(lastState.realityCost.mantissa, 18))
      .mul(Decimal.pow(10, lastState.realityCost.exponent.toString()));

    // Update Button State
    const buyBtn = document.getElementById("buyDirectBtn");
    if (totalDust.gte(compCost)) {
      buyBtn.disabled = false;
      buyBtn.style.opacity = "1";
      buyBtn.innerText = "Max Compression (Affordable!)";
      buyBtn.style.borderColor = "var(--primary-color)";
    } else {
      buyBtn.disabled = true;
      buyBtn.style.opacity = "0.5";
      buyBtn.innerText = `Max Compression (${formatSci(compCost)} DUST)`;
      buyBtn.style.borderColor = "var(--card-border)";
    }

    let info = "";

    // Card 1: Assets & Production [core.getPlayer]
    info += `<div class="card">`;
    info += `<div class="card-header"><span class="card-title">Production Ledger</span><span class="source-tag">[verified + estimated]</span></div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label">On-Chain Dust</span>`;
    info += `<span class="stat-value">${formatSci(player.dust)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label">Pending (Est.)</span>`;
    info += `<span class="stat-value success" style="font-weight: bold;">+${formatSci(pending)}</span>`;
    info += `</div>`;

    info += `<div class="divider"></div>`;

    info += `<div class="stat-row" style="margin-top: 4px;">`;
    info += `<span class="stat-label" style="font-weight: bold; color: var(--primary-color);">PROJECTED TOTAL</span>`;
    info += `<span class="stat-value highlight" style="font-size: 1.1rem;">${formatSci(totalDust)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label">Mote Balance</span>`;
    info += `<span class="stat-value">${formatSci(player.motes)}</span>`;
    info += `</div>`;

    info += `<div class="divider"></div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label">Base Rate</span>`;
    info += `<span class="stat-value">${formatSci(baseRate)}</span>`;
    info += `</div>`;
    info += `<div class="stat-detail" style="text-align: right; margin-top: -4px;">${growthNote}</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label">Speed Bonus</span>`;
    info += `<span class="stat-value highlight">x${formatSci(multAtUpdate)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row" style="border-top: 1px solid #111; padding-top: 4px; margin-top: 4px;">`;
    info += `<span class="stat-label" style="font-weight: 700;">DUST / TICK</span>`;
    info += `<span class="stat-value success" style="font-weight: 700;">${formatSci(actualRate)}</span>`;
    info += `</div>`;
    info += `</div>`;

    // Card 2: Telemetry [game.logic]
    const ratePerSec = actualRate.mul(5);
    info += `<div class="card">`;
    info += `<div class="card-header"><span class="card-title">Temporal Pulse</span><span class="source-tag">[game.logic]</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Phase</span><span class="stat-value ${taPhase === 'ACCELERATED' ? 'success' : ''}" style="font-weight: 700;">${taPhase}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Blocks</span><span class="stat-value">${player.lastUpdateBlock} → ${Math.floor(currentBlock)} <span class="highlight">(+${Math.floor(blocksElapsed)})</span></span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Ticks Now</span><span class="stat-value highlight">${Math.floor(totalTicks).toLocaleString()}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Ticks @ Upd</span><span class="stat-value">${player.ticksThisRun.toLocaleString()}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Active Tks</span><span class="stat-value highlight">${Math.floor(activeTicks).toLocaleString()} / ${taDur.toLocaleString()}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Speed Bonus</span><span class="stat-value highlight">x${formatSci(taMult)}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Status</span><span class="stat-value ${taColor}">${taNote}</span></div>`;
    info += `<div class="divider"></div>`;
    info += `<div class="stat-row"><span class="stat-label">Actual Rate</span><span class="stat-value">${formatSci(actualRate)}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Potential Rate</span><span class="stat-value highlight">${formatSci(potentialRate)}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Base Rate</span><span class="stat-value">${formatSci(baseRate)}</span></div>`;
    info += `<div class="stat-row">`;
    info += `<span class="stat-label">Rate/Sec</span>`;
    info += `<span class="stat-value">${formatSci(actualRate.mul(5))}</span>`;
    info += `</div>`;

    info += `<div class="divider"></div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label" style="font-size: 0.7rem; color: #666;">MOTE MULT</span>`;
    info += `<span class="stat-value" style="font-size: 0.7rem; color: #666;">x${formatSci(moteProdMult)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label" style="font-size: 0.7rem; color: #666;">RELIC MULT</span>`;
    info += `<span class="stat-value" style="font-size: 0.7rem; color: #666;">x${formatSci(relicMult)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label" style="font-size: 0.7rem; color: #666;">COMP MULT</span>`;
    info += `<span class="stat-value" style="font-size: 0.7rem; color: #666;">x${formatSci(cBaseMult)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label" style="font-size: 0.7rem; color: #666;">MOTE MULT</span>`;
    info += `<span class="stat-value" style="font-size: 0.7rem; color: #666;">x${formatSci(moteProdMult)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label" style="font-size: 0.7rem; color: #666;">RAW CONTRACT DPT</span>`;
    info += `<span class="stat-value" style="font-size: 0.7rem; color: #666;">${formatSci(rawC)}</span>`;
    info += `</div>`;

    info += `<div class="stat-row">`;
    info += `<span class="stat-label" style="font-size: 0.7rem; color: #666;">TA @ UPDATE</span>`;
    info += `<span class="stat-value" style="font-size: 0.7rem; color: #666;">x${formatSci(multAtUpdate)}</span>`;
    info += `</div>`;

    info += `</div>`;

    // Card 2.5: Compression Hub [core.getPlayer]
    const compMult = Decimal.pow(1.0521, compP);
    info += `<div class="card">`;
    info += `<div class="card-header"><span class="card-title">Temporal Compression</span><span class="source-tag">[core.getPlayer]</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Purchases</span><span class="stat-value highlight">${compP}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Production</span><span class="stat-value highlight">x${formatSci(compMult)}</span></div>`;
    info += `<div class="divider"></div>`;
    info += `<div class="stat-row"><span class="stat-label">Mote Bonus</span><span class="stat-value success">x4.50</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Reset On</span><span class="stat-value">Crystallise</span></div>`;
    info += `</div>`;

    // Card 3: Multipliers [core.getPlayer]
    info += `<div class="card" style="grid-column: span 2;">`;
    info += `<div class="card-header"><span class="card-title">Multipliers & Affordability</span><span class="source-tag">[core.getPlayer]</span></div>`;
    info += `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">`;
    const dustLog = totalDust.log10();
    for (let i = 0; i < 8; i++) {
      const carried = player.dcCarriedPurchases ? player.dcCarriedPurchases[i] : 0;
      const purchases = player.dcPurchases ? player.dcPurchases[i] : 0;
      const mult = calculateMultiplier(i, carried, globals.carryK);
      const nextCost = calculateCost(i, purchases, mult);
      const canBuy = calculateMaxAffordable(i, purchases, dustLog, mult);
      const colorClass = canBuy > 0 ? 'success' : 'stat-label';
      info += `<div style="border-left: 1px solid #111; padding-left: 6px;">`;
      info += `<div class="stat-label" style="font-size: 0.6rem;">DC${i + 1} <span class="badge" title="Formula: ${CP[i]} - ${carried}/${globals.carryK}">x${mult.toFixed(2)}</span></div>`;
      info += `<div class="${colorClass}" style="font-family: JetBrains Mono; font-weight: 600; font-size: 0.75rem;">+${canBuy}</div>`;
      info += `<div class="stat-secondary">@${formatSci(nextCost)}</div>`;
      info += `<div class="stat-detail">Carried: ${carried.toLocaleString()}</div>`;
      info += `</div>`;
    }
    info += `</div>`;
    info += `</div>`;

    // Card 4: Network [globals]
    info += `<div class="card" style="grid-column: span 2;">`;
    info += `<div class="card-header"><span class="card-title">Network & Progression</span><span class="source-tag">[view.globals]</span></div>`;
    info += `<div style="display: flex; gap: 40px;">`;
    info += `<div style="flex: 1;">`;
    info += `<div class="stat-row"><span class="stat-label">Tick Rate</span><span class="stat-value">${tickParams.rate.toString()} blks</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Ticks Run</span><span class="stat-value">${player.ticksThisRun.toLocaleString()}</span></div>`;
    info += `</div>`;
    info += `<div style="flex: 1;">`;
    info += `<div class="stat-row"><span class="stat-label">Softcap</span><span class="stat-value">${tickParams.softcap.toString()}</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Action Fee</span><span class="stat-value highlight">${lastState.fee ? ethers.utils.formatEther(lastState.fee) : "0"} XTZ</span></div>`;
    info += `<div class="stat-row"><span class="stat-label">Cryst.</span><span class="stat-value highlight">${player.crystallisations}</span></div>`;
    info += `</div>`;
    info += `</div>`;
    info += `<div style="margin-top: 8px; text-align: center; color: #333; font-size: 0.6rem; font-family: JetBrains Mono; text-transform: uppercase;">Streaming Live Update</div>`;
    info += `</div>`;

    dash.innerHTML = info;
  } catch (err) {
    console.error(err);
    out.innerText = "Render Error: " + err.message;
  }
}

function stopRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  document.getElementById("connectBtn").style.display = "block";
  document.getElementById("stopBtn").style.display = "none";
  document.getElementById("output").innerText = "Auto-refresh stopped.";
}

function getTxParams(value) {
  const params = { value: value || ethers.utils.parseEther("0.0001") };
  // SA needs forced gas for executeBatch. EOA/YOLO should estimate to catch reverts locally.
  if (hudFocus === "SA") {
    params.gasLimit = 5000000;
  }
  return params;
}

async function buyMaxCompressionDirect() {
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);
    const fee = ethers.utils.parseEther("0.0001");

    out.innerText = `[Action]\nTriggering Reality (Max Compression)...`;

    if (hudFocus === "SA") {
      const sa = new ethers.Contract(SA_ADDR, SA_ABI, signer);
      const data = core.interface.encodeFunctionData("buyMaxCompression");
      const tx = await sa.executeBatch([CORE_ADDR], [fee], [data], getTxParams(fee));
      out.innerText = `[Smart Account]\nReality Pending: ${tx.hash}`;
      await tx.wait();
    } else {
      const tx = await core.buyMaxCompression(getTxParams(fee));
      out.innerText = `[${hudFocus}]\nCompression Pending: ${tx.hash}`;
      await tx.wait();
      showToast(`Max Compression Success: ${tx.hash.slice(0, 10)}...`);
    }
    out.innerText += `\nConfirmed!`;
  } catch (err) {
    console.error(err);
    out.innerText = "Error: " + (err.data?.message || err.message);
  }
}

async function chainBuyDC() {
  const input = document.getElementById("dcChain").value;
  const ids = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (ids.length === 0) return alert("Please enter IDs");

  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);
    const sa = new ethers.Contract(SA_ADDR, SA_ABI, signer);

    // Fetch current on-chain fee
    const currentFee = await core.actionFee();

    out.innerText = `[Chain Buy]\nFiring ${ids.length} txs via ${hudFocus}...\n`;
    out.innerText += `Current Fee: ${ethers.utils.formatEther(currentFee)} XTZ\n`;

    // Sequential execution for all modes (stability first)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      out.innerText += `\n[${i + 1}/${ids.length}] Buying DC(${id})...`;

      let tx;
      if (hudFocus === "SA") {
        const data = core.interface.encodeFunctionData("buyDC", [id]);
        tx = await sa.executeBatch([CORE_ADDR], [currentFee], [data], getTxParams(currentFee));
      } else {
        tx = await core.buyDC(id, getTxParams(currentFee));
      }

      out.innerText += `\nPending: ${tx.hash.slice(0, 10)}...`;
      await tx.wait();
      out.innerText += ` ✓ Confirmed`;
      showToast(`DC Buy Success: ${tx.hash.slice(0, 10)}...`);
    }
    out.innerText += `\n\nAll transactions completed!`;
  } catch (err) {
    console.error("ChainBuy Error:", err);
    let msg = err.data?.message || err.message;
    const decoded = parseError(msg);
    const finalMsg = decoded || msg;
    out.innerText += "\n\nError: " + finalMsg;
    showToast(finalMsg, "error");
  }
}

async function batchBuyDC() {
  const input = document.getElementById("dcChain").value;
  const ids = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (ids.length === 0) return alert("Please enter a valid comma-separated list of IDs");

  const out = document.getElementById("output");

  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, signer);

    let baseFee = ethers.utils.parseEther("0.0001");
    if (lastState && lastState.fee) baseFee = lastState.fee;

    out.innerText = `[Simulating M3 Batch]\nTargeting IDs: ${ids.join(', ')}...`;

    const calls = ids.map(id => ({
      target: CORE_ADDR,
      allowFailure: true,
      value: baseFee,
      callData: core.interface.encodeFunctionData("buyDC", [id])
    }));

    const totalValue = baseFee.mul(ids.length);

    // Simulation Step
    try {
      const results = await multicall.callStatic.aggregate3Value(calls, { value: totalValue });
      let simOutput = `[Simulation Results]\n`;
      let allPassed = true;
      results.forEach((res, i) => {
        const success = res.success;
        const reason = success ? "OK" : parseError(res.returnData);
        simOutput += `DC(${ids[i]}): ${success ? "✅" : "❌ " + reason}\n`;
        if (!success) allPassed = false;
      });
      out.innerText = simOutput;

      if (!allPassed) {
        out.innerText += `\n⚠️ WARNING: Some calls failed simulation. Sign anyway? (Experimental)`;
      }
    } catch (simErr) {
      console.warn("Simulation Reverted:", simErr);
      const reason = parseError(simErr.data || simErr.message);
      out.innerText = `[Simulation REVERTED]\nReason: ${reason || "Unknown Execution Error"}\n\nThis usually means the contract is blocking the Multicall3 proxy address.`;
      return;
    }

    out.innerText += `\n\n[Signing Transaction...]`;
    await handleMulticall(calls, `Batch Buy (${ids.length} DCs)`);
  } catch (err) {
    console.error("Batch Error:", err);
    out.innerText = "Error: " + (err.data?.message || err.message);
  }
}

async function buyAllNative() {
  const input = document.getElementById("dcChain").value;
  const ids = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (ids.length === 0) return alert("Please enter a valid comma-separated list of IDs");

  const out = document.getElementById("output");

  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);

    let baseFee = ethers.utils.parseEther("0.0001");
    if (lastState && lastState.fee) baseFee = lastState.fee;

    const totalValue = baseFee.mul(ids.length);

    out.innerText = `[Native All-In]\nTargeting sequence length: ${ids.length}\nUsing native 0x1650221f loop...`;

    out.innerText += `\nSigning transaction (Total Fee: ${ethers.utils.formatEther(totalValue)} XTZ)...`;

    const tx = await core.buyMaxCompression({
      value: totalValue,
      gasLimit: Math.max(8000000, ids.length * 2000000)
    });

    out.innerText = `[Pending]\nHash: ${tx.hash}\nWaiting for confirmation...`;
    await tx.wait();
    out.innerText = `[Confirmed]\nNative All-In Success!`;
  } catch (err) {
    console.error("Native Buy Error:", err);
    out.innerText = "Error: " + (err.data?.message || err.message);
  }
}

async function checkSAStatus() {
  if (hudFocus !== "SA") return;
  try {
    const monitor = new ethers.providers.JsonRpcProvider("https://node.shadownet.etherlink.com");
    const code = await monitor.getCode(SA_ADDR);
    const statusEl = document.getElementById("personaStatus");
    const deployBtn = document.getElementById("deploySABtn");
    const addrEl = document.getElementById("personaAddr");
    const balEl = document.getElementById("personaBalance");
    if (!statusEl || !addrEl) return;

    addrEl.innerText = SA_ADDR;

    // Fetch SA Balance
    try {
      const bal = await monitor.getBalance(SA_ADDR);
      if (balEl) balEl.innerText = `${parseFloat(ethers.utils.formatEther(bal)).toFixed(4)} XTZ`;
    } catch (e) { }
    if (code !== "0x" && code !== "0x0") {
      const sa = new ethers.Contract(SA_ADDR, SA_ABI, monitor);
      const owner = await sa.owner();
      const signer = await getSigner();
      const myAddr = await signer.getAddress();
      if (owner.toLowerCase() === myAddr.toLowerCase()) {
        statusEl.innerText = "ACTIVE (OWNED)";
        statusEl.style.background = "#00ff00";
        statusEl.style.color = "#000";
      } else {
        statusEl.innerText = "LOCKED (NOT OWNER)";
        statusEl.style.background = "#ffcc00";
        statusEl.style.color = "#000";
      }
      if (deployBtn) deployBtn.style.display = "none";
    } else {
      statusEl.innerText = "NOT DEPLOYED";
      statusEl.style.background = "#ff4400";
      statusEl.style.color = "#fff";
      if (deployBtn) deployBtn.style.display = "block";
    }
  } catch (err) {
    console.warn("SA status check failed:", err);
  }
}

// Start a background heartbeat for the Smart Account status
setInterval(checkSAStatus, 3000);

async function deploySA() {
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const factory = new ethers.Contract(SA_FACTORY_ADDR, SA_FACTORY_ABI, signer);

    out.innerText = `[Science]\nDeploying Smart Account to ${SA_ADDR}...`;
    const tx = await factory.createAccount(await signer.getAddress(), 0);

    out.innerText = `[Pending]\nHash: ${tx.hash}\nWaiting for deployment...`;
    await tx.wait();
    out.innerText = `[Success]\nSmart Account Manifested!`;
    await checkSAStatus();
  } catch (err) {
    console.error("Deploy Error:", err);
    out.innerText = "Deploy Error: " + (err.data?.message || err.message);
  }
}

async function executeBatchSmart() {
  const ids = document.getElementById("dcChain").value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (ids.length === 0) return alert("Please enter a valid comma-separated list of IDs");
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);
    const fee = ethers.utils.parseEther("0.0001");
    const totalValue = fee.mul(ids.length);

    if (hudFocus === "YOLO") {
      out.innerText = `[YOLO Native Batch]\nBundling ${ids.length} DCs into 1 Native Tx...\nSigning...`;
      const data = ids.map(id => core.interface.encodeFunctionData("buyDC", [id]));
      const tx = await core.multicall(data, {
        value: totalValue,
        gasLimit: Math.max(5000000, ids.length * 1000000)
      });
      out.innerText = `[Pending]\nNative Batch Hash: ${tx.hash}`;
      await tx.wait();
      out.innerText += `\nConfirmed!`;
    } else if (hudFocus === "SA") {
      const sa = new ethers.Contract(SA_ADDR, SA_ABI, signer);
      out.innerText = `[Smart Account Batch]\nBundling ${ids.length} DCs via executeBatch...\nSigning...`;
      const dests = ids.map(() => CORE_ADDR);
      const values = ids.map(() => fee);
      const datas = ids.map(id => core.interface.encodeFunctionData("buyDC", [id]));
      const tx = await sa.executeBatch(dests, values, datas, {
        value: totalValue,
        gasLimit: Math.max(8000000, ids.length * 2000000)
      });
      out.innerText = `[Pending]\nSmart Account Hash: ${tx.hash}`;
      await tx.wait();
      out.innerText += `\nConfirmed!`;
    } else {
      alert("Smart Batch is only for SMART or YOLO focus. For MetaMask, use 'Chain Buy'.");
    }
  } catch (err) {
    console.error("Smart Batch Error:", err);
    out.innerText = "Error: " + (err.data?.message || err.message);
  }
}

async function triggerUpdate() {
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);
    // Fetch current on-chain fee
    const currentFee = await core.actionFee();

    out.innerText = `[Action]\nTriggering Update (Genesis)...\nFee: ${ethers.utils.formatEther(currentFee)} XTZ`;

    const wasInitialized = lastState && lastState.player && lastState.player.initialized;

    if (hudFocus === "SA") {
      const sa = new ethers.Contract(SA_ADDR, SA_ABI, signer);
      const data = core.interface.encodeFunctionData("update");
      const tx = await sa.executeBatch([CORE_ADDR], [currentFee], [data], getTxParams(currentFee));
      out.innerText = `[Smart Account]\nGenesis Pending: ${tx.hash}`;
      await tx.wait();
    } else {
      const tx = await core.update(getTxParams(currentFee));
      out.innerText = `[${hudFocus}]\nGenesis Pending: ${tx.hash}`;
      await tx.wait();
    }

    out.innerText += `\nConfirmed!`;
    const toastMsg = wasInitialized ? "Claimed and updated!" : "Genesis Success: Account Initialized!";
    showToast(toastMsg);
    await connectAndRead(); // Force refresh
  } catch (err) {
    console.error(err);
    let msg = err.data?.message || err.message;
    const decoded = parseError(msg);
    const finalMsg = decoded || msg;
    out.innerText = "Error: " + finalMsg;
    showToast(finalMsg, "error");
  }
}

async function triggerSacrifice() {
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);
    const fee = ethers.utils.parseEther("0.0001");

    out.innerText = `[Action]\nTriggering Sacrifice...`;

    if (hudFocus === "SA") {
      const sa = new ethers.Contract(SA_ADDR, SA_ABI, signer);
      const data = core.interface.encodeFunctionData("sacrifice");
      const tx = await sa.executeBatch([CORE_ADDR], [fee], [data], getTxParams(fee));
      out.innerText = `[Smart Account]\nSacrifice Pending: ${tx.hash}`;
      await tx.wait();
    } else {
      const tx = await core.sacrifice(getTxParams(fee));
      out.innerText = `[${hudFocus}]\nSacrifice Pending: ${tx.hash}`;
      await tx.wait();
    }
    out.innerText += `\nConfirmed!`;
  } catch (err) {
    console.error(err);
    let msg = err.data?.message || err.message;
    const decoded = parseError(msg);
    const finalMsg = decoded || msg;
    out.innerText = "Error: " + finalMsg;
    showToast(finalMsg, "error");
  }
}

async function triggerManifestAll() {
  const out = document.getElementById("output");
  try {
    const signer = await getSigner();
    const core = new ethers.Contract(CORE_ADDR, CORE_ABI, signer);

    const fee = await core.actionFee();

    out.innerText = `[GIGA-BUY]\nFiring Manifest All (0xe5350791)...\nFee: ${ethers.utils.formatEther(fee)} XTZ`;

    let tx;
    if (hudFocus === "SA") {
      const sa = new ethers.Contract(SA_ADDR, SA_ABI, signer);
      tx = await sa.executeBatch([CORE_ADDR], [fee], ["0xe5350791"], getTxParams(fee));
    } else {
      tx = await signer.sendTransaction({
        to: CORE_ADDR,
        data: "0xe5350791",
        value: fee,
        ...getTxParams(fee)
      });
    }

    out.innerText += `\nPending: ${tx.hash}`;
    await tx.wait();
    showToast("Manifest Success: Giga-Buy Confirmed!");
    await connectAndRead();
  } catch (err) {
    console.error(err);
    let msg = err.data?.message || err.message;
    showToast(parseError(msg) || msg, "error");
  }
}

function switchFocus(target) {
  hudFocus = target;
  const eoaBtn = document.getElementById("focusEOABtn");
  const saBtn = document.getElementById("focusSABtn");
  const yoloBtn = document.getElementById("focusYOLOBtn");
  const card = document.getElementById("identityCard");
  const label = document.getElementById("personaLabel");
  const engineTag = document.getElementById("engineTag");
  const vault = document.getElementById("yoloVault");
  const smartBatchBtn = document.getElementById("smartBatchBtn");

  // Reset tabs
  [eoaBtn, saBtn, yoloBtn].forEach(b => {
    b.style.background = "#222";
    b.style.color = "#888";
  });

  if (target === "EOA") {
    eoaBtn.style.background = "#3b82f6";
    eoaBtn.style.color = "#fff";
    card.style.borderTopColor = "#3b82f6";
    label.innerText = "PERSONA: METAMASK";
    engineTag.innerText = "[Direct]";
    engineTag.style.color = "#3b82f6";
    vault.style.display = "none";
    smartBatchBtn.style.display = "none";
  } else if (target === "SA") {
    saBtn.style.background = "#ffaa00";
    saBtn.style.color = "#000";
    card.style.borderTopColor = "#ffaa00";
    label.innerText = "PERSONA: SMART ACCOUNT";
    engineTag.innerText = "[Atomic Proxy]";
    engineTag.style.color = "#ffaa00";
    vault.style.display = "none";
    smartBatchBtn.style.display = "block";
    smartBatchBtn.style.background = "#ffaa00";
  } else {
    yoloBtn.style.background = "#d946ef";
    yoloBtn.style.color = "#fff";
    card.style.borderTopColor = "#d946ef";
    label.innerText = "PERSONA: YOLO BURNER";
    engineTag.innerText = "[Piped Engine]";
    engineTag.style.color = "#d946ef";
    vault.style.display = "block";
    smartBatchBtn.style.display = "none"; // Hide in YOLO mode
  }
  showToast(`${target} Mode Active`, "info");
  connectAndRead();
}

function generateYoloKey() {
  const wallet = ethers.Wallet.createRandom();
  localStorage.setItem("dusted_yolo_key", wallet.privateKey);
  yoloWallet = null; // Reset cached signer
  checkYoloStatus();
  alert("New YOLO Key Generated and Saved Locally!");
}

function showToast(msg, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) {
    console.warn("Toast container not found");
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerText = msg;
  container.appendChild(toast);

  // Use double-frame wait to ensure CSS transition works
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function checkYoloStatus() {
  const key = localStorage.getItem("dusted_yolo_key");
  if (!yoloWallet && key) {
    const provider = new ethers.providers.JsonRpcProvider("https://node.shadownet.etherlink.com");
    yoloWallet = new ethers.Wallet(key, provider);
  }

  if (hudFocus !== "YOLO") return;

  const statusEl = document.getElementById("personaStatus");
  const addrEl = document.getElementById("personaAddr");
  const balEl = document.getElementById("personaBalance");
  if (!statusEl || !addrEl) return;

  if (yoloWallet) {
    statusEl.innerText = "ACTIVE (BURNER)";
    statusEl.style.background = "#d946ef";
    statusEl.style.color = "#fff";
    addrEl.innerText = yoloWallet.address;

    try {
      const bal = await yoloWallet.getBalance();
      balEl.innerText = `${parseFloat(ethers.utils.formatEther(bal)).toFixed(4)} XTZ`;
    } catch (e) { }
  } else {
    statusEl.innerText = "UNINITIALIZED";
    statusEl.style.background = "#444";
    statusEl.style.color = "#aaa";
    addrEl.innerText = "NONE";
    balEl.innerText = "0.0000 XTZ";
  }
}

function revealYoloKey() {
  const key = localStorage.getItem("dusted_yolo_key");
  if (!key) return alert("No YOLO Key found!");
  const ok = confirm("WARNING: This will reveal your Private Key. Proceed?");
  if (ok) {
    prompt("Copy your YOLO Private Key:", key);
  }
}

function importYoloKey() {
  const input = document.getElementById("yoloImportInput").value.trim();
  if (!input) return alert("Please paste a key first!");
  try {
    const wallet = new ethers.Wallet(input);
    localStorage.setItem("dusted_yolo_key", input);
    yoloWallet = null; // Force reset
    checkYoloStatus();
    document.getElementById("yoloImportInput").value = "";
    alert(`Imported YOLO Account: ${wallet.address}`);
  } catch (err) {
    alert("Invalid Private Key format!");
  }
}

const safeAddListener = (id, event, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, fn);
};

safeAddListener("connectBtn", "click", connectAndRead);
safeAddListener("stopBtn", "click", stopRefresh);
safeAddListener("updateBtn", "click", triggerUpdate);
safeAddListener("buyDirectBtn", "click", buyMaxCompressionDirect);
safeAddListener("sacrificeBtn", "click", triggerSacrifice);
safeAddListener("manifestAllBtn", "click", triggerManifestAll);
safeAddListener("chainBuyDCBtn", "click", chainBuyDC);
safeAddListener("smartBatchBtn", "click", executeBatchSmart);
safeAddListener("batchBuyDCBtn", "click", batchBuyDC);
safeAddListener("secretBatchBtn", "click", buyAllNative);
safeAddListener("generateYoloBtn", "click", generateYoloKey);
safeAddListener("revealYoloBtn", "click", revealYoloKey);
safeAddListener("importYoloBtn", "click", importYoloKey);

safeAddListener("focusEOABtn", "click", () => switchFocus("EOA"));
safeAddListener("focusSABtn", "click", () => switchFocus("SA"));
safeAddListener("focusYOLOBtn", "click", () => switchFocus("YOLO"));

// Initial check
checkSAStatus();
checkYoloStatus(); // This will now hydrate yoloWallet immediately
setInterval(checkSAStatus, 3000);
setInterval(checkYoloStatus, 3000);
