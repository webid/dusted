// -- VIEW Contract (chain-direct data source) ---------------------------------
const CHAIN_RPC = "https://node.shadownet.etherlink.com";
const VIEW_ADDR = "0x9aB01b7b864c255Af5c8BD5C0f26D6bE0d8201F6";
const CORE_ADDR = "0x098ebA92E5a634A3be967E6891F905E2ABe89059";

// Ensure Decimal is available from break_infinity.js
const D =
  typeof Decimal !== "undefined"
    ? Decimal
    : typeof window !== "undefined"
      ? window.Decimal
      : null;
if (!D) console.error("Dusted: Decimal library (break_infinity.js) not found!");

// mote upgrades (for upgrade scanning and strategy evaluation)

// grab from playerHex word 63 (moteUpgrades) and decode as uint256 bitmask

// Usage:
// activeSet.has(13); // Lightning fast boolean check

// import { Ef } from "./mote_upgrades.js";

function getActiveIdsSet(hexMask, upgradesData) {
  const mask = BigInt(hexMask);
  return new Set(
    upgradesData
      .filter((u) => (mask & (1n << BigInt(u.id))) !== 0n)
      .map((u) => u.id),
  );
}

var SHREDDER_STATE = {
  dust: D ? new D(0) : null,
  dustPerTick: D ? new D(0) : null,
  activeTicks: 0,
  softcap: 30000,
  motes: 0,
  pendingMotes: 0,
  targetMotes: 75,
  cheapestUpgrade: null,
  hasScannedTC: false,
  hasScannedUpgrades: false,
  hasScannedStats: false,
  ticksThisRun: 0,
  tcStart: 10000,
  condensers: [],
  compressions: 0,
  nextTcCost: D ? new D(0) : null,
  unclaimedDust: D ? new D(0) : null,
  hasReachedE308: false,
  _prevChainTicks: 0,
  _justReset: false,
  currentBlock: 0,
  lastUpdateBlock: 0,
  chainTicksThisRun: 0,
};

// keccak256 selectors (verified via `cast sig`)
const SEL_GET_PLAYER = "0x5c12cd4b"; // getPlayer(address)
const SEL_DUST_PER_TICK = "0xbd859b08"; // dustPerTick(address)
const SEL_COMP_COST = "0x62f2db0e"; // compressionCost(address)
const SEL_TICK_PARAMS = "0x6b7582c4"; // getTickSpeedParams()
const SEL_CARRY_GLOBALS = "0x1606b060"; // getCarryGlobals()
const SEL_ACTION_FEE = "0x1441d227"; // actionFee()
const SEL_BLOCKS_PER_TICK = "0x4c0b305b"; // blocksPerTick()

/** Zero-pad a hex value to 32 bytes (64 hex chars). */
function pad32(hex) {
  return hex.replace("0x", "").padStart(64, "0");
}

/** ABI-encode a single address argument. */
function encodeAddr(addr) {
  return pad32(addr.toLowerCase().replace("0x", ""));
}

/** Decode a uint256 from a 32-byte ABI word at offset (in hex string, no 0x). */
function decodeUint(hex, wordOffset) {
  const start = wordOffset * 64;
  return parseInt(hex.slice(start, start + 64), 16);
}

/** Decode a FloatNum struct {mantissa(uint128), exponent(int64), negative(bool)}
 *  from ABI-encoded output at wordOffset. Each field occupies one 32-byte word. */
function decodeFloat(hex, wordOffset) {
  const m = decodeUint(hex, wordOffset); // uint128 mantissa (scaled by 1e18)
  const eRaw = decodeUint(hex, wordOffset + 1); // int64 exponent (may be negative)
  const neg = decodeUint(hex, wordOffset + 2); // bool negative
  // Convert int64: if top bit set → negative
  const e = eRaw > 0x7fffffffffffffff ? eRaw - 0x10000000000000000 : eRaw;
  // mantissa is stored * 1e18 as a uint128
  const mantissaF = m / 1e18;
  const val = new Decimal(`${mantissaF}e${e}`);
  return neg ? val.neg() : val;
}

/** Raw eth_call via fetch. Returns hex result string (no 0x). */
async function ethCall(to, data) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  const res = await fetch(CHAIN_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = await res.json();
  // console.log(json);
  // if (json.error) console.log(data);
  if (json.error) throw new Error(json.error.message);
  return (json.result || "0x").slice(2); // strip 0x
}

/** Fetch and decode the player's on-chain state. Returns a partial SHREDDER_STATE override. */
async function fetchChainState(playerAddress) {
  const addrHex = encodeAddr(playerAddress);

  // VIEW contract: player-specific data
  // CORE contract: global params (getTickSpeedParams, getCarryGlobals, blocksPerTick)
  const [playerHex, dptHex, tickHex, carryHex, compCostHex] = await Promise.all(
    [
      ethCall(CORE_ADDR, SEL_GET_PLAYER + addrHex),
      ethCall(VIEW_ADDR, SEL_DUST_PER_TICK + addrHex),
      ethCall(CORE_ADDR, SEL_TICK_PARAMS),
      ethCall(CORE_ADDR, SEL_CARRY_GLOBALS),
      ethCall(CORE_ADDR, SEL_COMP_COST + addrHex),
    ],
  );

  // ── getPlayer layout (each field = one or more 32-byte words) ────────────
  // Field order from ABI:
  //  [0-2]   dust (FloatNum: mantissa, exponent, negative)
  //  [3-5]   maxDust
  //  [6-8]   motes
  //  [9-11]  shards
  //  [12-14] voidEssence
  //  [15-38] dcAmounts[8] (8 × 3 words)
  //  [39-46] dcPurchases[8] (8 × 1 word, uint32 packed)
  //  [47-54] idPurchases[8]
  //  [55-62] tdPurchases[8]
  //  [63]    moteUpgrades (uint256)
  //  [64]    collapseStudies (uint256)
  //  [65]    crystallisations (uint32)
  //  [66]    voidCollapses (uint32)
  //  [67]    realityBreaks (uint32)
  //  [68]    lastUpdateBlock (uint64)
  //  [69]    compressionPurchases (uint32)
  //  [70-72] relicMultiplier (FloatNum)
  //  [73]    relicSlots (uint8)
  //  [74]    initialized (bool)
  //  [75]    ticksThisRun (uint64)
  //  [76]    tickSpeedParamsBlock (uint64)
  //  [77]    psTickSpeedRate (uint64)
  //  [78]    psTickSpeedStart (uint64)
  //  [79]    psTickSpeedSoftcap (uint64)
  //  [80]    psTickSpeedPower (uint32)
  //  [81-83] allTimeMaxDust (FloatNum)
  //  [84-91] dcCarriedPurchases[8]
  //  [92]    psTickSpeedSoftcapDecay (uint64)
  //  [93]    psTickSpeedSoftcapMin (uint32)
  //  [94]    psTickSpeedSoftcapGrowth (uint32)

  const dust = decodeFloat(playerHex, 0);
  const motes = decodeFloat(playerHex, 6);
  const crys = decodeUint(playerHex, 65);
  const comprP = decodeUint(playerHex, 69);
  const lastUpdateBlock = decodeUint(playerHex, 68);
  const ticksRun = decodeUint(playerHex, 75);
  const psStart = decodeUint(playerHex, 78);
  const psSoftcap = decodeUint(playerHex, 79);
  const allTimeMax = decodeFloat(playerHex, 81);
  const roundMax = decodeFloat(playerHex, 3);
  const activeUpgrades = getActiveIdsSet(
    decodeUint(playerHex, 63),
    moteUpgrades,
  );

  // console.log("Active Mote Upgrades IDs:", activeUpgrades);
  // iterate over moteUpgradeTiers and log which upgrades inside each tier are active
  moteUpgradeTiers.forEach((tierName, tierIndex) => {
    const upgradesInTier = moteUpgrades.filter((u) => u.tier === tierIndex);
    // const activeUpgradesInTier = upgradesInTier.filter((u) =>
    //   activeUpgrades.has(u.id),
    // );
    const inactiveUpgradesInTier = upgradesInTier.filter(
      (u) => !activeUpgrades.has(u.id),
    );

    // inactiveUpgradesInTier.length > 0 &&
    //   console.log(
    //     `Tier ${tierIndex} (${tierName}):`,
    //     inactiveUpgradesInTier.map((u) => u.name),
    //   );
  });

  // TODO: this needs to be a separate function to optimily scan the cheapest inactive upgrade and all its fields
  const cheapestInactiveUpgrade = moteUpgrades.reduce(
    (cheapest, u) =>
      u.cost < cheapest.cost && !activeUpgrades.has(u.id) ? u : cheapest,
    { cost: Infinity },
  );

  // console.log(
  //   `Cheapest Upgrade to Buy:`,
  //   `Tier ${cheapestInactiveUpgrade.tier}: ${moteUpgradeTiers[cheapestInactiveUpgrade.tier]} -> ${cheapestInactiveUpgrade.name}, [${cheapestInactiveUpgrade.cost} motes]`,
  // );

  // dcAmounts[0..7] start at word 15, each FloatNum = 3 words
  const dcAmounts = [];
  for (let i = 0; i < 8; i++) {
    dcAmounts.push(decodeFloat(playerHex, 15 + i * 3));
  }
  // dcPurchases[0..7] at word 39
  const dcPurchases = [];
  for (let i = 0; i < 8; i++) {
    dcPurchases.push(decodeUint(playerHex, 39 + i));
  }
  // dcCarriedPurchases[0..7] at word 84
  const dcCarried = [];
  for (let i = 0; i < 8; i++) {
    dcCarried.push(decodeUint(playerHex, 84 + i));
  }

  // ── dustPerTick (3-word FloatNum) ─────────────────────────────────────────
  const dpt = decodeFloat(dptHex, 0);

  // ── compressionCost (3-word FloatNum) ─────────────────────────────────────
  const compCost = decodeFloat(compCostHex, 0);

  // ── getTickSpeedParams → (rate, start, softcap, power, lastParamChange) ──
  const globalSoftcap = decodeUint(tickHex, 2);

  // ── getCarryGlobals → (softcapDecay, softcapMin, softcapGrowth, carryK, amountCarry) ─
  const carryK = decodeUint(carryHex, 3);

  // ── Derived values ────────────────────────────────────────────────────────
  const softcap = psSoftcap || globalSoftcap || SHREDDER_STATE.softcap;
  const tcStart = psStart || SHREDDER_STATE.tcStart;
  const activeTicks = Math.max(0, ticksRun - tcStart);

  // hasReachedE308: correct derivation — no sticky latch needed
  // True if current dust ≥ 1e308, OR all-time max ≥ 1e308 (a prior run hit it)
  // After crystallization, crys increments but dust resets — we can safely
  // check dust directly each cycle.
  const hasReachedE308 =
    // dust.gte(new Decimal("1e308")) || allTimeMax.gte(new Decimal("1e308"));
    dust.gte(new Decimal("1e308")) || roundMax.gte(new Decimal("1e308"));

  // Build condenser objects compatible with evaluateStrategy()
  const condensers = dcAmounts.map((amt, i) => ({
    tier: `DC${i + 1}`,
    amount: amt,
    nextCost: amt, // dcAmounts[i] IS the next purchase cost
  }));

  return {
    dust,
    dustPerTick: dpt,
    motes: motes.toNumber(),
    ticksThisRun: ticksRun,
    lastUpdateBlock: lastUpdateBlock,
    activeTicks,
    softcap,
    tcStart,
    compressions: comprP,
    nextTcCost: compCost,
    crystallisations: crys,
    hasReachedE308,
    condensers:
      SHREDDER_STATE.condensers.length > 0
        ? SHREDDER_STATE.condensers
        : condensers, // Only override if we don't have any data
    carryK,
    dcPurchases,
    dcCarried,
    // These are now always satisfied from chain data:
    hasScannedTC: true,
    hasScannedStats: true,
    hasScannedUpgrades: true,
    cheapestUpgrade: cheapestInactiveUpgrade.cost,
  };
}

/** Address of the currently connected wallet — populated once we find it in the DOM. */
let chainPlayerAddress = null;

/** Last time we fetched from chain (ms). */
let lastChainFetch = 0;

/** Extract current block number from DOM header. Returns 0 if not found. */
function extractCurrentBlock() {
  const headerRight = document.querySelector(".site-header-right");
  if (!headerRight) return 0;
  const cyanSpan = headerRight.querySelector(".cyan");
  if (cyanSpan) {
    const blockText = cyanSpan.textContent.trim();
    const blockNum = parseInt(blockText.replace(/,/g, ""), 10);
    return isNaN(blockNum) ? 0 : blockNum;
  }
  return 0;
}

/** Merge a chainState object into SHREDDER_STATE. */
function applyChainState(cs) {
  if (!cs) return;
  // Only overwrite dust/dustPerTick if chain values are non-zero
  // (DOM still provides finer-grained unclaimed-dust tracking)

  // if (cs.dust && cs.dust.gt(0)) SHREDDER_STATE.dust = cs.dust;

  // if (cs.dustPerTick && cs.dustPerTick.gt(0))
  //   SHREDDER_STATE.dustPerTick = cs.dustPerTick;
  SHREDDER_STATE.motes = cs.motes;

  // Extract current block from DOM
  const currentBlock = extractCurrentBlock();
  SHREDDER_STATE.currentBlock = currentBlock;
  SHREDDER_STATE.lastUpdateBlock = cs.lastUpdateBlock;
  SHREDDER_STATE.chainTicksThisRun = cs.ticksThisRun;

  // Calculate improved ticksThisRun using block difference
  // Formula: ticksThisRun = chainTicksThisRun + (currentBlock - lastUpdateBlock) * 5
  if (currentBlock > 0 && cs.lastUpdateBlock >= 0) {
    const blocksSinceUpdate = Math.max(0, currentBlock - cs.lastUpdateBlock);
    const ticksFromBlocks = blocksSinceUpdate * 5;
    SHREDDER_STATE.ticksThisRun = cs.ticksThisRun + ticksFromBlocks;
  } else {
    // Fallback to chain value if block extraction fails
    SHREDDER_STATE.ticksThisRun = cs.ticksThisRun;
  }
  // SHREDDER_STATE.activeTicks = cs.activeTicks;
  SHREDDER_STATE.activeTicks =
    SHREDDER_STATE.ticksThisRun - (cs.tcStart - cs.crystallisations * 100);
  SHREDDER_STATE.softcap = cs.softcap + cs.crystallisations * 20;
  SHREDDER_STATE.tcStart = cs.tcStart - cs.crystallisations * 100;
  SHREDDER_STATE.compressions = cs.compressions;
  if (cs.nextTcCost && cs.nextTcCost.gt) {
    SHREDDER_STATE.nextTcCost = cs.nextTcCost;
  }
  SHREDDER_STATE.hasReachedE308 = cs.hasReachedE308;
  SHREDDER_STATE.hasScannedTC = cs.hasScannedTC;
  SHREDDER_STATE.hasScannedStats = cs.hasScannedStats;
  SHREDDER_STATE.hasScannedUpgrades = cs.hasScannedUpgrades;
  if (cs.condensers && cs.condensers.length > 0) {
    SHREDDER_STATE.condensers = cs.condensers;
  }
  // Reset detection: if chain ticksThisRun is dramatically lower than what we
  // previously stored, a crystallization happened — clear stale state.
  if (
    SHREDDER_STATE._prevChainTicks > 0 &&
    cs.ticksThisRun < SHREDDER_STATE._prevChainTicks - 100
  ) {
    SHREDDER_STATE.pendingMotes = 0;
    SHREDDER_STATE.nextTcCost = new Decimal(0);
  }
  SHREDDER_STATE._prevChainTicks = cs.ticksThisRun;
  SHREDDER_STATE.cheapestUpgrade = cs.cheapestUpgrade;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SET_TARGET_MOTES") {
    SHREDDER_STATE.targetMotes = message.value;
  }
});

function parseSciNum(text) {
  if (!text) return new Decimal(0);
  const match = text.match(/([0-9.]+)(?:e\+?(-?[0-9]+))?/i);
  if (!match) return new Decimal(0);
  return new Decimal(match[0].toLowerCase());
}

// Feature #1: Softcap-aware floor calculation
// Accounts for growth rate dropping from 1.02 to 1.02^0.5 at the softcap boundary
// logTarget: the log10 production level to reach (default 308 for crystallization floor)
function ticksToReachFloor(log10P, currentActiveTicks, softcap, logTarget) {
  if (logTarget === undefined) logTarget = 308;
  if (log10P >= logTarget) return 0;

  const preRate = Math.log10(1.02); // ~0.00860 (full compounding)
  const postRate = Math.log10(1.02) * 0.5; // ~0.00430 (power 0.500)

  // Already past softcap? Use post rate entirely
  if (currentActiveTicks >= softcap) {
    return Math.max(0, (logTarget - log10P) / postRate);
  }

  const ticksToSoftcap = softcap - currentActiveTicks;
  const ticksNeededAtFullRate = (logTarget - log10P) / preRate;

  // Can reach target before softcap? Use full rate
  if (ticksNeededAtFullRate <= ticksToSoftcap) {
    return ticksNeededAtFullRate;
  }

  // Will cross softcap: split the calculation
  const log10P_at_softcap = log10P + ticksToSoftcap * preRate;
  const postSoftcapTicks = Math.max(
    0,
    (logTarget - log10P_at_softcap) / postRate,
  );

  return ticksToSoftcap + postSoftcapTicks;
}

function extractData() {
  const fullText = document.body.innerText;

  // Dust and Dust/Tick (Primary: span classes, Fallback: raw text)
  const dustEl = document.querySelector("span.yel");
  if (dustEl) {
    SHREDDER_STATE.dust = parseSciNum(dustEl.textContent);
  } else {
    const dMatch = fullText.match(/dust\s+([0-9.e+]+)/i);
    if (dMatch) SHREDDER_STATE.dust = parseSciNum(dMatch[1]);
  }

  const dustTickEl = document.querySelector("span.oran");
  if (dustTickEl) {
    // console.log("setting dust/tick from span.oran:", dustTickEl.textContent);
    SHREDDER_STATE.dustPerTick = parseSciNum(dustTickEl.textContent);
  } else {
    const dtMatch = fullText.match(/dust \/ tick\s+([0-9.e+]+)/i);
    if (dtMatch) {
      // console.log("setting dust/tick from raw text:", dtMatch[1]);
      SHREDDER_STATE.dustPerTick = parseSciNum(dtMatch[1]);
    }
  }

  // Parse unclaimed production
  const unclaimedMatch = fullText.match(/\(\+([0-9.e+]+)\s*dust\)/i);
  if (unclaimedMatch) {
    SHREDDER_STATE.unclaimedDust = parseSciNum(unclaimedMatch[1]);
  } else {
    SHREDDER_STATE.unclaimedDust = new Decimal(0);
  }

  // Motes & Active Ticks via raw text to ignore arbitrary HTML nesting
  // const motesMatch = fullText.match(/motes\s+~?([\d,.]+)/i);
  // if (motesMatch)
  //   SHREDDER_STATE.motes = parseFloat(motesMatch[1].replace(/,/g, ""));

  // const activeTicksMatch = fullText.match(
  //   /active ticks\s+([\d,]+)(?:\s*\/\s*([\d,]+))?/i,
  // );
  // if (activeTicksMatch) {
  //   SHREDDER_STATE.activeTicks = parseInt(
  //     activeTicksMatch[1].replace(/,/g, ""),
  //     10,
  //   );
  //   if (activeTicksMatch[2]) {
  //     SHREDDER_STATE.softcap = parseInt(
  //       activeTicksMatch[2].replace(/,/g, ""),
  //       10,
  //     );
  //   }
  // }

  // Upgrades parsing
  // let cheapestUpgrade = Infinity;
  // const upgradeMatches = fullText.matchAll(/([\d.]+)([kKmM]?)\s+BUY/gi);
  // for (const match of upgradeMatches) {
  //   let cost = parseFloat(match[1]);
  //   const suffix = match[2].toLowerCase();
  //   if (suffix === "k") cost /= 1000;
  //   // Assuming 'm' is motes, so no conversion needed for m since motes are base unit
  //   if (cost < cheapestUpgrade) {
  //     cheapestUpgrade = cost;
  //   }
  // }
  // if (cheapestUpgrade !== Infinity) {
  //   SHREDDER_STATE.cheapestUpgrade = cheapestUpgrade;
  // }

  // if (
  //   cheapestUpgrade !== Infinity ||
  //   fullText.match(/t[1-4][\s\n]*[-–—]/i) ||
  //   fullText.includes("req:") ||
  //   fullText.match(/\bt1\b[\s\S]{1,50}\bt2\b[\s\S]{1,50}\bt3\b/i) ||
  //   fullText.match(/amplifier\s*=>/i)
  // ) {
  //   SHREDDER_STATE.hasScannedUpgrades = true;
  // }

  // Temporal Compression parsing
  // const compMatch = fullText.match(/compressions\s+(\d+)/i);
  // if (compMatch) {
  //   SHREDDER_STATE.compressions = parseInt(compMatch[1], 10);
  //   SHREDDER_STATE.hasScannedTC = true;
  // }

  const tcCostMatch = fullText.match(
    /compressions[\s\S]{1,200}?cost\s+([0-9.e+]+)\s+dust/i,
  );
  if (tcCostMatch) {
    SHREDDER_STATE.nextTcCost = parseSciNum(tcCostMatch[1]);
    SHREDDER_STATE.hasScannedTC = true;
  }

  // CR Tab Pending Motes Parsing
  const crRegex = /motes gained\s*~?\s*([\d.,]+)/i;
  const crMatch = fullText.match(crRegex);
  if (crMatch) {
    SHREDDER_STATE.pendingMotes = parseFloat(crMatch[1].replace(/,/g, ""));
  } else if (fullText.toLowerCase().includes("crystallise at 1e308")) {
    SHREDDER_STATE.pendingMotes = 0;
  }

  // Stats Telemetry Parsing
  const ticksRunMatch = fullText.match(/ticks this run\s+([\d,]+)/i);
  SHREDDER_STATE._justReset = false; // Default: no reset this cycle
  if (ticksRunMatch) {
    const currentTicks = parseInt(ticksRunMatch[1].replace(/,/g, ""), 10);
    if (
      SHREDDER_STATE.ticksThisRun > 0 &&
      currentTicks < SHREDDER_STATE.ticksThisRun - 100
    ) {
      // RESET DETECTED (crystallization occurred)
      SHREDDER_STATE._justReset = true; // Guard against re-latching hasReachedE308 this cycle
      SHREDDER_STATE.nextTcCost = new Decimal(0);
      SHREDDER_STATE.hasScannedTC = false;
      SHREDDER_STATE.compressions = "Pending...";
      SHREDDER_STATE.cheapestUpgrade = null;
      SHREDDER_STATE.hasScannedUpgrades = false;
      SHREDDER_STATE.hasReachedE308 = false; // Clear on crystallization
      SHREDDER_STATE.pendingMotes = 0; // Stale CR-tab motes no longer valid
    }

    // Apply block-based calculation if we have block data
    let improvedTicks = currentTicks;
    const currentBlock = extractCurrentBlock();
    if (currentBlock > 0 && SHREDDER_STATE.lastUpdateBlock >= 0) {
      const blocksSinceUpdate = Math.max(
        0,
        currentBlock - SHREDDER_STATE.lastUpdateBlock,
      );
      const ticksFromBlocks = blocksSinceUpdate * 5;
      improvedTicks = currentTicks + ticksFromBlocks;
      console.log("[Dusted] Stats tab block-based update:", {
        statsParsedTicks: currentTicks,
        blocksSinceUpdate,
        ticksFromBlocks,
        improvedTicks,
      });
    }

    SHREDDER_STATE.ticksThisRun = improvedTicks;
    SHREDDER_STATE.hasScannedStats = true;
  }

  const tcStartMatch = fullText.match(
    /eff\. tc start \/ softcap\s+([\d,]+)\s*\/\s*([\d,]+)/i,
  );
  if (tcStartMatch) {
    SHREDDER_STATE.tcStart = parseInt(tcStartMatch[1].replace(/,/g, ""), 10);
    SHREDDER_STATE.softcap = parseInt(tcStartMatch[2].replace(/,/g, ""), 10);
    SHREDDER_STATE.hasScannedStats = true;
  }

  // Condenser Grid (Robust row detection ignoring exact CSS styles)
  const currentCondensers = [];
  const allDivs = document.querySelectorAll("div");
  allDivs.forEach((row) => {
    const children = row.children;
    if (children.length >= 4) {
      const tierText = (children[0].textContent || "").trim().toLowerCase();
      if (/^dc[1-8]$/.test(tierText)) {
        currentCondensers.push({
          tier: tierText.toUpperCase(),
          amount: parseSciNum(children[1].textContent),
          nextCost: parseSciNum(children[3].textContent),
        });
      }
    }
  });

  if (currentCondensers.length > 0) {
    SHREDDER_STATE.condensers = currentCondensers;
  }

  return SHREDDER_STATE;
}

function evaluateStrategy() {
  const P_tick = SHREDDER_STATE.dustPerTick;
  const effectiveDust = SHREDDER_STATE.dust.add(SHREDDER_STATE.unclaimedDust);
  const activeTicks = SHREDDER_STATE.activeTicks;
  const softcap = SHREDDER_STATE.softcap;
  let timeToFloor = 0;
  let maxDustBeforeSoftcap = null;
  let optimizationTarget = 308; // Default: crystallization floor

  // Latch the e308 flag once effective dust (or max dust) reaches e308.
  // Guard: don't re-latch in the same cycle where a crystallization reset was just detected.
  if (
    !SHREDDER_STATE._justReset &&
    (effectiveDust.gte(new Decimal("1e308")) || SHREDDER_STATE.pendingMotes > 0)
  ) {
    SHREDDER_STATE.hasReachedE308 = true;
  }
  SHREDDER_STATE._justReset = false; // Consume the guard

  if (P_tick.gt(0)) {
    const log10_P = P_tick.log10();

    if (SHREDDER_STATE.hasReachedE308 && activeTicks < softcap) {
      // Post-e308, pre-softcap: switch optimization target to natural production ceiling
      // This is the log10(dust/tick) you'd reach at softcap without buying anything
      const ticksToSoftcap = softcap - activeTicks;
      const preRate = Math.log10(1.02);
      maxDustBeforeSoftcap = log10_P + ticksToSoftcap * preRate;
      optimizationTarget = maxDustBeforeSoftcap;

      // timeToFloor becomes ticks until softcap (the productive runway)
      timeToFloor = ticksToSoftcap;
    } else if (!SHREDDER_STATE.hasReachedE308) {
      // Pre-e308: normal floor calculation
      timeToFloor = ticksToReachFloor(log10_P, activeTicks, softcap);
      timeToFloor = Math.max(0, timeToFloor);
    }
    // Post-e308 + post-softcap: timeToFloor stays 0, no meaningful optimization left
  }

  // Derived from the Stats Page Carry Effects
  const MULTIPLIERS = {
    DC1: 3,
    DC2: 4,
    DC3: 5,
    DC4: 6,
    DC5: 8,
    DC6: 10,
    DC7: 12,
    DC8: 15,
  };

  let bestPurchase = null;
  let bestPurchaseWait = 0;
  let maxTimeSaved = -Infinity;
  let affordableTargets = [];

  // Calculate efficiency delta for each condenser
  const evaluatedCondensers = SHREDDER_STATE.condensers.map((c) => {
    let efficiencyDelta = 0;
    let c_t_wait = Infinity;

    // The DC-Spike Filter: Ignore DC1-DC4 if cost > e100 and cost > P_tick
    const isDC1_4 = ["DC1", "DC2", "DC3", "DC4"].includes(c.tier);
    if (
      isDC1_4 &&
      c.nextCost.gt(new Decimal("1e100")) &&
      c.nextCost.gt(P_tick)
    ) {
      efficiencyDelta = -999; // Filtered out
    } else if (P_tick.gt(0)) {
      const diff = Decimal.max(0, c.nextCost.sub(effectiveDust));
      c_t_wait = diff.div(P_tick).toNumber();
      const isAffordable = diff.lte(0);

      // Skip purchases whose wait exceeds our productive runway
      // (they'd push us past softcap before we can even afford them)
      if (c_t_wait > timeToFloor && timeToFloor > 0 && !isAffordable) {
        efficiencyDelta = -999;
      } else {
        // Estimate P_new using the exact carry effect bases
        const multiplier = MULTIPLIERS[c.tier] || 1.1;
        const P_new_estimated = P_tick.mul(multiplier);
        // Feature #1: Account for activeTicks advancing during wait
        const activeTicksAtPurchase = activeTicks + c_t_wait;
        const t_floor_after = ticksToReachFloor(
          P_new_estimated.log10(),
          activeTicksAtPurchase,
          softcap,
          optimizationTarget,
        );

        const total_time_if_buy = c_t_wait + t_floor_after;
        const time_saved = timeToFloor - total_time_if_buy;
        efficiencyDelta =
          timeToFloor > 0 ? (time_saved / timeToFloor) * 100 : 0;

        if (time_saved > maxTimeSaved && time_saved > 0) {
          maxTimeSaved = time_saved;
          bestPurchase = c.tier;
          bestPurchaseWait = c_t_wait;
        }
        if (time_saved > 0 && isAffordable) {
          affordableTargets.push(c.tier);
        }
      }
    }

    return {
      tier: c.tier,
      amount: c.amount.toString(),
      nextCost: c.nextCost.toString(),
      efficiencyDelta: efficiencyDelta,
      t_wait: c_t_wait,
    };
  });

  // Evaluate TC
  let tc_efficiencyDelta = 0;
  if (SHREDDER_STATE.nextTcCost.gt(0) && P_tick.gt(0)) {
    const diff = Decimal.max(0, SHREDDER_STATE.nextTcCost.sub(effectiveDust));
    const t_wait = diff.div(P_tick).toNumber();
    const tcAffordable = diff.lte(0);

    // Skip if wait exceeds productive runway
    if (t_wait > timeToFloor && timeToFloor > 0 && !tcAffordable) {
      tc_efficiencyDelta = -999;
    } else {
      const motePower = Math.max(1, SHREDDER_STATE.motes);
      const baseMultiplier = 1.0583 * motePower;

      let multiplierToApply;
      if (activeTicks > 0) {
        multiplierToApply = new Decimal(baseMultiplier);
        if (activeTicks < softcap) {
          multiplierToApply = multiplierToApply.mul(Math.pow(1.02, 100));
        }
      } else {
        multiplierToApply = Decimal.pow(
          baseMultiplier,
          SHREDDER_STATE.compressions + 1,
        );
        multiplierToApply = multiplierToApply.mul(Math.pow(1.02, 100));
      }

      const P_new_tc = P_tick.mul(multiplierToApply);
      // Feature #1: TC purchase grants +100 active ticks (threshold drops) <- THIS IS DUMB
      // const activeTicksAtTcPurchase = activeTicks + t_wait + 100;
      const activeTicksAtTcPurchase = activeTicks;
      const t_floor_after_tc = ticksToReachFloor(
        P_new_tc.log10(),
        activeTicksAtTcPurchase,
        softcap,
        optimizationTarget,
      );
      const total_time_if_buy_tc = t_wait + t_floor_after_tc;
      const time_saved_tc = timeToFloor - total_time_if_buy_tc;
      // console.log(
      //   "Time to floor if buy TC:",
      //   total_time_if_buy_tc,
      //   "Time saved:",
      //   time_saved_tc,
      // );

      tc_efficiencyDelta =
        timeToFloor > 0 ? (time_saved_tc / timeToFloor) * 100 : 0;

      if (time_saved_tc > maxTimeSaved && time_saved_tc > 0) {
        maxTimeSaved = time_saved_tc;
        bestPurchase = "TC";
        bestPurchaseWait = t_wait;
      }
      if (time_saved_tc > 0 && tcAffordable) {
        affordableTargets.push("TC");
      }
    }
  }

  // Feature #3: Chain Forecasting
  // Simulate buying all affordable DCs, then find the best remaining target
  let chainSequence = null;
  if (affordableTargets.length > 0 && P_tick.gt(0)) {
    // Build list of affordable DCs sorted by multiplier (highest first)
    const affordableDCs = SHREDDER_STATE.condensers
      .filter((c) => {
        const diff = Decimal.max(0, c.nextCost.sub(effectiveDust));
        if (!diff.eq(0) || !MULTIPLIERS[c.tier]) return false;
        // Apply DC-Spike filter: exclude DC1-DC4 if cost > e100 and cost > P_tick
        const isDC1_4 = ["DC1", "DC2", "DC3", "DC4"].includes(c.tier);
        if (
          isDC1_4 &&
          c.nextCost.gt(new Decimal("1e100")) &&
          c.nextCost.gt(P_tick)
        )
          return false;
        return true;
      })
      .sort((a, b) => (MULTIPLIERS[b.tier] || 0) - (MULTIPLIERS[a.tier] || 0));

    if (affordableDCs.length > 0) {
      // Simulate buying all affordable DCs
      let simP = P_tick;
      let simDust = effectiveDust;
      let simActiveTicks = activeTicks;
      let chainSteps = [];

      for (const dc of affordableDCs) {
        if (simDust.gte(dc.nextCost)) {
          simDust = simDust.sub(dc.nextCost);
          simP = simP.mul(MULTIPLIERS[dc.tier] || 1);
          chainSteps.push(dc.tier);
        }
      }

      if (chainSteps.length > 0) {
        // Recalculate timeToFloor with simulated P_tick
        const simTimeToFloor = ticksToReachFloor(
          simP.log10(),
          simActiveTicks,
          softcap,
          optimizationTarget,
        );

        // Now evaluate remaining non-affordable upgrades against the boosted state
        let chainBestTarget = null;
        let chainBestWait = 0;
        let chainMaxTimeSaved = -Infinity;

        SHREDDER_STATE.condensers.forEach((c) => {
          if (chainSteps.includes(c.tier)) return; // Already bought in chain
          const isDC1_4 = ["DC1", "DC2", "DC3", "DC4"].includes(c.tier);
          if (
            isDC1_4 &&
            c.nextCost.gt(new Decimal("1e100")) &&
            c.nextCost.gt(simP)
          )
            return;

          const diff = Decimal.max(0, c.nextCost.sub(simDust));
          const chainWait = diff.div(simP).toNumber();
          const multiplier = MULTIPLIERS[c.tier] || 1.1;
          const P_new = simP.mul(multiplier);
          const activeAtPurchase = simActiveTicks + chainWait;
          const floorAfter = ticksToReachFloor(
            P_new.log10(),
            activeAtPurchase,
            softcap,
            optimizationTarget,
          );
          const totalTime = chainWait + floorAfter;
          const saved = simTimeToFloor - totalTime;

          if (saved > chainMaxTimeSaved && saved > 0) {
            chainMaxTimeSaved = saved;
            chainBestTarget = c.tier;
            chainBestWait = chainWait;
          }
        });

        // Also evaluate TC in the chain context
        if (SHREDDER_STATE.nextTcCost.gt(0)) {
          const tcDiff = Decimal.max(0, SHREDDER_STATE.nextTcCost.sub(simDust));
          const tcChainWait = tcDiff.div(simP).toNumber();
          const motePower = Math.max(1, SHREDDER_STATE.motes);
          const baseMult = 1.0583 * motePower;
          let tcMult = new Decimal(baseMult);
          if (simActiveTicks > 0 && simActiveTicks < softcap) {
            tcMult = tcMult.mul(Math.pow(1.02, 100));
          }
          const P_new_tc = simP.mul(tcMult);
          const tcActiveAfter = simActiveTicks + tcChainWait + 100;
          const tcFloorAfter = ticksToReachFloor(
            P_new_tc.log10(),
            tcActiveAfter,
            softcap,
            optimizationTarget,
          );
          const tcTotalTime = tcChainWait + tcFloorAfter;
          const tcSaved = simTimeToFloor - tcTotalTime;
          if (tcSaved > chainMaxTimeSaved && tcSaved > 0) {
            chainMaxTimeSaved = tcSaved;
            chainBestTarget = "TC";
            chainBestWait = tcChainWait;
          }
        }

        // Compare chain path vs single best target
        // Chain total = 0 (buy affordable now) + chainBestWait + chainFloorAfter
        // vs single = bestPurchaseWait + singleFloorAfter
        if (chainBestTarget) {
          // The chain's time is measured from current state:
          // simTimeToFloor already reflects the boost from buying affordable DCs
          // chainMaxTimeSaved is relative to simTimeToFloor
          const chainTotalFloor = simTimeToFloor - chainMaxTimeSaved; // time with chain+target
          const singleTotalFloor = timeToFloor - maxTimeSaved; // time with single best

          if (
            chainTotalFloor < singleTotalFloor &&
            chainTotalFloor < timeToFloor
          ) {
            // Chain path wins
            chainSequence = {
              steps: chainSteps,
              target: chainBestTarget,
              wait: chainBestWait,
              totalTime: chainTotalFloor,
            };
          }
        }
      }
    }
  }

  // Hard Exit Rule Simulation
  let recommendation = "Hold Position (Natural Growth)";

  const totalMotes = SHREDDER_STATE.motes + SHREDDER_STATE.pendingMotes;
  const hasTargetMotes = totalMotes >= SHREDDER_STATE.targetMotes;
  const hitSoftcap = activeTicks >= softcap;

  if (hasTargetMotes && SHREDDER_STATE.targetMotes > 0) {
    recommendation = "CRITICAL: TARGET REACHED! BUY MAX DC THEN CRYSTALLISE";
  } else if (hitSoftcap) {
    recommendation = "CRITICAL: SOFTCAP HIT! BUY MAX DC THEN CRYSTALLISE";
  } else if (bestPurchase && maxTimeSaved > 0) {
    recommendation = `Target Acquisition: ${bestPurchase}`;
  } else if (SHREDDER_STATE.hasReachedE308) {
    recommendation = "Pushing to Target (Monitor CR Tab for Motes)";
  }

  return {
    timeToFloor: timeToFloor,
    recommendation: recommendation,
    bestPurchaseWait: bestPurchaseWait,
    affordableTargets: affordableTargets,
    condensers: evaluatedCondensers,
    tc_efficiencyDelta: tc_efficiencyDelta,
    chainSequence: chainSequence,
    maxDustBeforeSoftcap: maxDustBeforeSoftcap,
    hasReachedE308: SHREDDER_STATE.hasReachedE308,
  };
}

async function scrapePlayerAddress() {
  if (window.ethereum) {
    // selectedAddress is set when already connected
    if (window.ethereum.selectedAddress) {
      return window.ethereum.selectedAddress;
    }
    // eth_accounts returns connected accounts without prompting
    try {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });
      if (accounts && accounts.length > 0) {
        return accounts[0];
      }
    } catch (e) {
      console.warn("eth_accounts failed:", e);
    }
  }
  // fallback
  return "0xc2e97ae6ca9aafb19ce0b8bcd1f4c50285db2377";
}

const intervalId = setInterval(async () => {
  // console.log("[Dusted] tick", Date.now(), lastChainFetch);
  try {
    // 1. Try to resolve the player address (once found, cached)
    if (!chainPlayerAddress) {
      // window.ethereum.request({ method: "eth_requestAccounts" });
      chainPlayerAddress = await scrapePlayerAddress();
    }
    // console.log("[Dusted] chainPlayerAddress", chainPlayerAddress);
    // 2. Fetch chain state every 10s (non-blocking)
    const now = Date.now();
    if (chainPlayerAddress && now - lastChainFetch > 3000) {
      lastChainFetch = now;
      fetchChainState(chainPlayerAddress)
        .then((cs) => {
          applyChainState(cs);
          // console.log("[Dusted] Chain state applied:", {
          //   crystallisations: cs.crystallisations,
          //   hasReachedE308: cs.hasReachedE308,
          //   chainTicksThisRun: cs.ticksThisRun,
          //   lastUpdateBlock: cs.lastUpdateBlock,
          //   currentBlock: SHREDDER_STATE.currentBlock,
          //   blocksSinceUpdate: SHREDDER_STATE.currentBlock - cs.lastUpdateBlock,
          //   improvedTicksThisRun: SHREDDER_STATE.ticksThisRun,
          //   activeTicks: SHREDDER_STATE.activeTicks,
          //   softcap: cs.softcap,
          //   compressions: cs.compressions,
          //   nextTcCost: cs.nextTcCost ? cs.nextTcCost.toString() : "0",
          // });
        })
        .catch((err) =>
          console.warn("[Dusted] Chain fetch failed:", err.message),
        );
    }

    // 3. DOM extraction (supplements chain data for unclaimed dust, pendingMotes, etc.)
    extractData();
    const strategy = evaluateStrategy();

    const payload = {
      dust: SHREDDER_STATE.dust.toString(),
      dustPerTick: SHREDDER_STATE.dustPerTick.toString(),
      activeTicks: SHREDDER_STATE.activeTicks,
      softcap: SHREDDER_STATE.softcap,
      motes: SHREDDER_STATE.motes,
      pendingMotes: SHREDDER_STATE.pendingMotes,
      totalMotes: SHREDDER_STATE.motes + SHREDDER_STATE.pendingMotes,
      needsCRScan:
        SHREDDER_STATE.hasReachedE308 && SHREDDER_STATE.pendingMotes === 0,
      cheapestUpgrade: SHREDDER_STATE.cheapestUpgrade,
      hasScannedTC: SHREDDER_STATE.hasScannedTC,
      hasScannedUpgrades: SHREDDER_STATE.hasScannedUpgrades,
      hasScannedStats: SHREDDER_STATE.hasScannedStats,
      ticksThisRun: SHREDDER_STATE.ticksThisRun,
      tcStart: SHREDDER_STATE.tcStart,
      compressions: SHREDDER_STATE.compressions,
      nextTcCost: SHREDDER_STATE.nextTcCost.toString(),
      ...strategy,
    };

    chrome.runtime.sendMessage({ type: "HUD_UPDATE", payload }).catch((err) => {
      if (
        err.message &&
        err.message.includes("Extension context invalidated")
      ) {
        clearInterval(intervalId);
      }
    });
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      clearInterval(intervalId);
    } else {
      console.error("Dust HUD Eval Error:", err);
    }
  }
}, 1000);
