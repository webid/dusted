let showedRoadmap = false;

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
  targetMotes: 0,
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
  requiredDust: D ? new D(0) : null,
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

  // console.log("max dust this round:", roundMax.toExponential(3));
  // console.log("all time max dust:", allTimeMax.toExponential(3));

  // divisor will be calculated based on upgrades unlocked, 308 default, but user already has Break-Infinity I => mote formula ÷307
  // multiplier will be caulated based on upgrades unlocked, user has Mote Prism => ×2 motes on crystallise
  const estimateMotes = (maxDust, multiplier, divisor) => {
    const dustDecimal = new Decimal(maxDust);

    if (dustDecimal.lt("1e308")) return new Decimal(0);

    const logDust = dustDecimal.log10();
    const exponent = (logDust - 230.2) / divisor;

    return Decimal.pow(10, exponent).times(multiplier);
  };

  const estimateRequiredDust = (targetMotes, multiplier, divisor) => {
    const target = new Decimal(targetMotes);

    if (target.lte(0)) return new Decimal("1e308");

    const baseLog = target.div(multiplier).log10();
    const targetExponent = baseLog * divisor + 230.2;

    return Decimal.pow(10, targetExponent);
  };

  // calculate multiplier and divisor based on active upgrades
  let multiplier = 1;
  let divisor = 308;

  if (activeUpgrades.has(8)) multiplier *= 2; // Mote Prism
  if (activeUpgrades.has(14)) multiplier *= 2; // Mote Resonance I
  if (activeUpgrades.has(25)) multiplier *= 4; // Mote Resonance II
  if (activeUpgrades.has(31)) multiplier *= 8; // Mote Resonance III
  if (activeUpgrades.has(37)) multiplier *= 16; // Mote Amplification
  if (activeUpgrades.has(39)) multiplier *= 32; // Ascendancy

  if (activeUpgrades.has(13)) divisor = 307; // Break-Infinity I
  if (activeUpgrades.has(19)) divisor = 306; // Break-Infinity II
  if (activeUpgrades.has(26)) divisor = 305; // Break-Infinity III
  if (activeUpgrades.has(32)) divisor = 304; // Break-Infinity IV
  if (activeUpgrades.has(36)) divisor = 303; // Break-Infinity V

  // calculate how high max Dust must go if we want to earn enough motes to buy the cheapest upgrade, based on current upgrades and the motes we already have

  let estimatedRequiredDust;
  if (
    SHREDDER_STATE.motes + SHREDDER_STATE.pendingMotes <
    SHREDDER_STATE.targetMotes
  ) {
    estimatedRequiredDust = estimateRequiredDust(
      SHREDDER_STATE.targetMotes - SHREDDER_STATE.motes,
      multiplier,
      divisor,
    );

    // console.log(
    //   `Dust required to reach ${
    //     SHREDDER_STATE.targetMotes - SHREDDER_STATE.motes
    //   } motes:`,
    //   estimatedRequiredDust.toExponential(3),
    // );
  }
  // estimate pending motes
  const effectiveMaxDust = Decimal.max(roundMax, SHREDDER_STATE.dust || 0);
  if (effectiveMaxDust.gt(new Decimal("1e308"))) {
    SHREDDER_STATE.pendingMotes = estimateMotes(
      effectiveMaxDust,
      multiplier,
      divisor,
    ).toNumber();
    SHREDDER_STATE.hasScannedUpgrades = true;
  } else {
    SHREDDER_STATE.pendingMotes = 0;
  }

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
    // todo: calculate how much motes each inactive upgrade would give us based on current max dust and formula, and log that too
    // todo: calculate how much motes each inactive upgrade costs, and log that too, also the total for all inactive upgrades in the tier
    // inactiveUpgradesInTier.length > 0 &&
    //   console.log(
    //     `Tier ${tierIndex} (${tierName}):`,
    //     inactiveUpgradesInTier.map((u) => u.name),
    //   );
  });

  // scan the cheapest inactive upgrade
  const cheapestInactiveUpgrade = moteUpgrades.reduce(
    (cheapest, u) =>
      u.cost < cheapest.cost && !activeUpgrades.has(u.id) ? u : cheapest,
    { cost: Infinity },
  );

  // console.log(
  //   `Cheapest Upgrade to Buy:`,
  //   `Tier ${cheapestInactiveUpgrade.tier}: ${moteUpgradeTiers[cheapestInactiveUpgrade.tier]} -> ${cheapestInactiveUpgrade.name}, [${cheapestInactiveUpgrade.cost} motes]`,
  // );

  // const floorMotes = estimateMotes(new Decimal("1e308"), multiplier, divisor);
  // const tier3Path = [
  //   { name: "Grand Cascade", cost: 75 },
  //   { name: "Compression Mastery", cost: 100 },
  //   { name: "Temporal Echo", cost: 125 },
  //   { name: "Break-Infinity II", cost: 80 },
  // ];

  // let totalRounds = 0;
  // let currentBalance = SHREDDER_STATE.motes + SHREDDER_STATE.pendingMotes;

  // const roadmap = tier3Path.map((upgrade) => {
  //   const needed = Math.max(0, upgrade.cost - currentBalance);
  //   const rounds = Math.ceil(needed / floorMotes.toNumber());

  //   totalRounds += rounds;
  //   currentBalance = Math.max(0, currentBalance - upgrade.cost); // Reset balance after "buying"

  //   return { ...upgrade, rounds, cumulative: totalRounds };
  // });

  // // display roadmap in console in a readable format

  // console.log("Roadmap to Tier 3 Upgrades:");
  // roadmap.forEach((step, index) => {
  //   console.log(
  //     `Step ${index + 1}: ${step.name} (${step.cost} motes) - Rounds: ${step.rounds}, Cumulative: ${step.cumulative}`,
  //   );
  // });

  // ROADMAP v2
  // const calculateRoadmap = (startingMotes, yieldPerRound) => {
  //   const path = [
  //     { name: "Compression Mastery", cost: 100 },
  //     { name: "Temporal Echo", cost: 125 },
  //     { name: "Break-Infinity II", cost: 80 },
  //   ];

  //   let balance = startingMotes;
  //   let totalRounds = 0;

  //   return path.map((step) => {
  //     const needed = Math.max(0, step.cost - balance);
  //     const rounds = Math.ceil(needed / yieldPerRound);
  //     totalRounds += rounds;
  //     // Simulate buying and carrying over leftovers
  //     balance = balance + rounds * yieldPerRound - step.cost;
  //     return { name: step.name, rounds, cumulative: totalRounds };
  //   });
  // };

  // const yields = {
  //   fast: estimateMotes("1e308", multiplier, divisor).toNumber(), // ~7.17M
  //   softcap: estimateMotes("1e405", multiplier, divisor).toNumber(), // ~14.8M
  //   deep: 18, // User defined target
  // };

  // const fastRoadmap = calculateRoadmap(12.26, yields.fast);
  // const softcapRoadmap = calculateRoadmap(12.26, yields.softcap);
  // const deepRoadmap = calculateRoadmap(12.26, yields.deep);

  // // todo, log as a table with columns: Upgrade Name | Rounds (Fast) | Rounds (Softcap) | Rounds (Deep)

  // console.log(
  //   "Upgrade Name         | Fast (Cum.) | Softcap (Cum.) | Deep (Cum.)",
  // );
  // fastRoadmap.forEach((step, i) => {
  //   const f = `${step.rounds} (${step.cumulative})`;
  //   const s = `${softcapRoadmap[i]?.rounds} (${softcapRoadmap[i]?.cumulative})`;
  //   const d = `${deepRoadmap[i]?.rounds} (${deepRoadmap[i]?.cumulative})`;
  //   console.log(
  //     `${step.name.padEnd(20)} | ${f.padEnd(11)} | ${s.padEnd(14)} | ${d}`,
  //   );
  // });
  // console.log("Fast (1e308):", fastRoadmap);
  // console.log("Softcap (1e405):", softcapRoadmap);
  // console.log("Deep (18 motes/round):", deepRoadmap);

  // ROADMAP v3 (with time estimates)
  if (!showedRoadmap) {
    const TICK_ESTIMATES = { fast: 23000, softcap: 36500, deep: 45000 };

    const calculateRoadmap = (startingMotes, yieldPerRound, strategyKey) => {
      const path = [
        { name: "Compression Mastery", cost: 100 },
        { name: "Temporal Echo", cost: 125 },
        { name: "Break-Infinity II", cost: 80 },
      ];

      let balance = startingMotes;
      let totalRounds = 0;
      const tickRate = TICK_ESTIMATES[strategyKey];

      return path.map((step) => {
        const needed = Math.max(0, step.cost - balance);
        const rounds = Math.ceil(needed / yieldPerRound);
        totalRounds += rounds;
        balance = balance + rounds * yieldPerRound - step.cost;
        return {
          name: step.name,
          rounds,
          cumulativeRounds: totalRounds,
          totalTicks: totalRounds * tickRate,
        };
      });
    };

    const yields = {
      fast: estimateMotes("1e308", multiplier, divisor).toNumber(), // ~7.17M
      softcap: estimateMotes("1e405", multiplier, divisor).toNumber(), // ~14.8M
      deep: 18, // User defined target
    };

    const fastRoadmap = calculateRoadmap(12.26, yields.fast, "fast");
    const softcapRoadmap = calculateRoadmap(12.26, yields.softcap, "softcap");
    const deepRoadmap = calculateRoadmap(12.26, yields.deep, "deep");

    console.log(
      "Upgrade Name         | Fast (Ticks)   | Softcap (Ticks)| Deep (Ticks)",
    );
    fastRoadmap.forEach((step, i) => {
      const f = `${step.cumulativeRounds} (${step.totalTicks.toLocaleString()})`;
      const s = `${softcapRoadmap[i].cumulativeRounds} (${softcapRoadmap[i].totalTicks.toLocaleString()})`;
      const d = `${deepRoadmap[i].cumulativeRounds} (${deepRoadmap[i].totalTicks.toLocaleString()})`;
      console.log(
        `${step.name.padEnd(20)} | ${f.padEnd(14)} | ${s.padEnd(14)} | ${d}`,
      );
    });
    showedRoadmap = true;
  }

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
  // True if current dust ≥ 1e308, OR this round max dust ≥ 1e308
  // After crystallization, crys increments but dust resets — we can safely
  // check dust directly each cycle.
  const hasReachedE308 =
    dust.gte(new Decimal("1e308")) || roundMax.gte(new Decimal("1e308"));

  // console.log("Has reached e308:", hasReachedE308, {
  //   dust: dust.toExponential(3),
  //   roundMax: roundMax.toExponential(3),
  // });

  // Base DC Configs
  const DC_CONFIGS = [
    { baseCostExp: 1, baseInc: 3 },
    { baseCostExp: 2, baseInc: 4 },
    { baseCostExp: 4, baseInc: 5 },
    { baseCostExp: 6, baseInc: 6 },
    { baseCostExp: 9, baseInc: 8 },
    { baseCostExp: 13, baseInc: 10 },
    { baseCostExp: 18, baseInc: 12 },
    { baseCostExp: 24, baseInc: 15 },
  ];

  let powerMultiplier = 1;
  if (activeUpgrades.has(1)) powerMultiplier *= 1.5;
  if (activeUpgrades.has(5)) powerMultiplier *= 1.5;
  if (activeUpgrades.has(11)) powerMultiplier *= 2;
  if (activeUpgrades.has(20)) powerMultiplier *= 2;
  if (activeUpgrades.has(33)) powerMultiplier *= 3;

  const tcMult = new Decimal(1.01264).pow(comprP * powerMultiplier);

  let baseDcMult = new Decimal(1);
  if (activeUpgrades.has(0)) baseDcMult = baseDcMult.times(2);
  if (activeUpgrades.has(6)) baseDcMult = baseDcMult.times(4);
  if (activeUpgrades.has(12)) baseDcMult = baseDcMult.times(8);
  if (activeUpgrades.has(18)) baseDcMult = baseDcMult.times(32);
  if (activeUpgrades.has(22)) baseDcMult = baseDcMult.times(64);
  if (activeUpgrades.has(30)) baseDcMult = baseDcMult.times(256);
  if (activeUpgrades.has(34)) baseDcMult = baseDcMult.times(1024);
  if (activeUpgrades.has(39)) baseDcMult = baseDcMult.times(4096);

  const sumPurchases = dcPurchases.reduce((a, b) => a + b, 0);
  if (activeUpgrades.has(27))
    baseDcMult = baseDcMult.times(1 + sumPurchases / 100);
  if (activeUpgrades.has(35))
    baseDcMult = baseDcMult.times(1 + sumPurchases / 50);
  if (activeUpgrades.has(29))
    baseDcMult = baseDcMult.times(Decimal.pow(1.001, comprP));

  // Apply Temporal Compression multiplier
  baseDcMult = baseDcMult.times(tcMult);

  // Build accurate condenser objects
  const condensers = [];
  for (let i = 0; i < 8; i++) {
    const owned = dcPurchases[i] || 0;
    const carried = dcCarried[i] || 0;
    const amount = dcAmounts[i] || new Decimal(0);
    const config = DC_CONFIGS[i];

    // Calculate cost
    const kFactor = carryK || 500;
    const incExp = Math.max(0.5, config.baseInc - carried / kFactor);
    const costExp = config.baseCostExp + owned * incExp;
    const nextCost = Decimal.pow(10, costExp);

    // Calculate multiplier
    let mult = new Decimal(baseDcMult);
    if (i === 0 && activeUpgrades.has(3)) mult = mult.times(4);
    if (i === 1 && activeUpgrades.has(4)) mult = mult.times(4);
    if (i === 2 && activeUpgrades.has(7)) mult = mult.times(4);
    if (i === 3 && activeUpgrades.has(10)) mult = mult.times(4);
    if (i === 4 && activeUpgrades.has(15)) mult = mult.times(4);
    if (i === 5 && activeUpgrades.has(17)) mult = mult.times(4);
    if (i === 6 && activeUpgrades.has(21)) mult = mult.times(4);
    if (i === 7 && activeUpgrades.has(23)) mult = mult.times(4);

    if (activeUpgrades.has(9) && (i === 0 || i === 2 || i === 4 || i === 6)) {
      mult = mult.times(4);
    }
    if (i === 7 && activeUpgrades.has(24)) {
      mult = mult.times(Decimal.max(1, Decimal.pow(motes.toNumber(), 0.1)));
    }

    condensers.push({
      tier: `DC${i + 1}`,
      amount: amount,
      owned: owned,
      carried: carried,
      nextCost: nextCost,
      multiplier: mult,
      incExp: incExp,
    });
  }

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
    powerMultiplier: powerMultiplier,
    nextTcCost: compCost,
    crystallisations: crys,
    hasReachedE308,
    condensers: condensers,
    carryK,
    dcPurchases,
    dcCarried,
    moteMultiplier: multiplier,
    moteDivisor: divisor,
    hasScannedTC: true,
    hasScannedStats: true,
    hasScannedUpgrades: true,
    cheapestUpgrade: cheapestInactiveUpgrade.cost,
    requiredDust: estimatedRequiredDust,
    roundMax: roundMax,
    allTimeMax: allTimeMax,
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

  const isReset = cs.crystallisations > (SHREDDER_STATE.crystallisations || 0);

  if (isReset) {
    SHREDDER_STATE._justReset = true;
    SHREDDER_STATE.dust = cs.dust;
    SHREDDER_STATE.dustPerTick = cs.dustPerTick;
    SHREDDER_STATE.ticksThisRun = cs.ticksThisRun;
    SHREDDER_STATE.nextTcCost = new Decimal(0);
    SHREDDER_STATE.hasScannedTC = false;
    SHREDDER_STATE.compressions = "Pending...";
    SHREDDER_STATE.cheapestUpgrade = null;
    SHREDDER_STATE.hasScannedUpgrades = false;
    SHREDDER_STATE.hasReachedE308 = false;
    SHREDDER_STATE.pendingMotes = 0;
  } else {
    // Normal update: only snap forward to prevent backwards jumping
    if (cs.dust && (!SHREDDER_STATE.dust || cs.dust.gt(SHREDDER_STATE.dust))) {
      SHREDDER_STATE.dust = cs.dust;
    }
    if (
      cs.dustPerTick &&
      (!SHREDDER_STATE.dustPerTick ||
        cs.dustPerTick.gt(SHREDDER_STATE.dustPerTick))
    ) {
      SHREDDER_STATE.dustPerTick = cs.dustPerTick;
    }
    if (
      cs.ticksThisRun &&
      (!SHREDDER_STATE.ticksThisRun ||
        cs.ticksThisRun > SHREDDER_STATE.ticksThisRun)
    ) {
      SHREDDER_STATE.ticksThisRun = cs.ticksThisRun;
    }
  }

  // We intentionally ignore cs.ticksThisRun during normal updates
  // to allow the DOM scrapers (which have exact compounding) to manage them smoothly.

  SHREDDER_STATE.currentBlock = extractCurrentBlock();
  SHREDDER_STATE.motes = cs.motes;
  SHREDDER_STATE.lastUpdateBlock = cs.lastUpdateBlock;
  SHREDDER_STATE.chainTicksThisRun = cs.ticksThisRun;
  SHREDDER_STATE.activeTicks =
    SHREDDER_STATE.ticksThisRun - (cs.tcStart - cs.crystallisations * 100);
  SHREDDER_STATE.softcap = cs.softcap + cs.crystallisations * 20;
  SHREDDER_STATE.tcStart = cs.tcStart - cs.crystallisations * 100;
  SHREDDER_STATE.compressions = cs.compressions;
  SHREDDER_STATE.crystallisations = cs.crystallisations;
  SHREDDER_STATE.powerMultiplier = cs.powerMultiplier || 1;
  SHREDDER_STATE.moteMultiplier = cs.moteMultiplier || 1;
  SHREDDER_STATE.moteDivisor = cs.moteDivisor || 308;

  if (cs.roundMax) SHREDDER_STATE.roundMax = cs.roundMax.toString();
  if (cs.allTimeMax) SHREDDER_STATE.allTimeMax = cs.allTimeMax.toString();

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
  if (cs.requiredDust && cs.requiredDust.gte(1e308))
    SHREDDER_STATE.requiredDust = cs.requiredDust;
  else SHREDDER_STATE.requiredDust = undefined;
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
  let dustFound = false;
  let ticksFound = false;

  // Dust and Dust/Tick
  const dustEl = document.querySelector("span.yel");
  if (dustEl) {
    const newDust = parseSciNum(dustEl.textContent);

    // Fast reset detection (crystallization while not on stats tab)
    if (
      SHREDDER_STATE.dust &&
      SHREDDER_STATE.dust.gt(1e10) &&
      newDust.lt(1e9)
    ) {
      SHREDDER_STATE._justReset = true;
      SHREDDER_STATE.ticksThisRun = 0;
      SHREDDER_STATE.activeTicks = 0;
      SHREDDER_STATE.nextTcCost = new Decimal(0);
      SHREDDER_STATE.hasScannedTC = false;
      SHREDDER_STATE.compressions = "Pending...";
      SHREDDER_STATE.cheapestUpgrade = null;
      SHREDDER_STATE.hasScannedUpgrades = false;
      SHREDDER_STATE.hasReachedE308 = false;
      SHREDDER_STATE.pendingMotes = 0;
    }

    SHREDDER_STATE.dust = newDust;
    dustFound = true;
  }

  const dustTickEl = document.querySelector("span.oran");
  if (dustTickEl) {
    SHREDDER_STATE.dustPerTick = parseSciNum(dustTickEl.textContent);
    dustFound = true;
  }

  // Parse unclaimed production
  const unclaimedMatch = fullText.match(/\(\+([0-9.e+]+)\s*dust\)/i);
  if (unclaimedMatch) {
    SHREDDER_STATE.unclaimedDust = parseSciNum(unclaimedMatch[1]);
  } else {
    SHREDDER_STATE.unclaimedDust = new Decimal(0);
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
      SHREDDER_STATE._justReset = true;
      SHREDDER_STATE.nextTcCost = new Decimal(0);
      SHREDDER_STATE.hasScannedTC = false;
      SHREDDER_STATE.compressions = "Pending...";
      SHREDDER_STATE.cheapestUpgrade = null;
      SHREDDER_STATE.hasScannedUpgrades = false;
      SHREDDER_STATE.hasReachedE308 = false;
      SHREDDER_STATE.pendingMotes = 0;
    }

    if (!SHREDDER_STATE.chainTicksThisRun)
      SHREDDER_STATE.chainTicksThisRun = currentTicks;
    SHREDDER_STATE.hasScannedStats = true;
    ticksFound = true;
  }

  return { dustFound, ticksFound };
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
    (effectiveDust.gte(new Decimal("1e308")) ||
      Decimal.max(SHREDDER_STATE.roundMax || 0, effectiveDust).gte(
        new Decimal("1e308"),
      ))
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
  let purchaseOptions = [];

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

        if (time_saved > 0) {
          purchaseOptions.push({
            target: c.tier,
            wait: c_t_wait,
            timeSaved: time_saved,
            pctSaved: efficiencyDelta,
            cost: c.nextCost.toString(),
            affordable: isAffordable,
          });
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
      const activeTicksAtTcPurchase = activeTicks;
      const t_floor_after_tc = ticksToReachFloor(
        P_new_tc.log10(),
        activeTicksAtTcPurchase,
        softcap,
        optimizationTarget,
      );
      const total_time_if_buy_tc = t_wait + t_floor_after_tc;
      const time_saved_tc = timeToFloor - total_time_if_buy_tc;

      tc_efficiencyDelta =
        timeToFloor > 0 ? (time_saved_tc / timeToFloor) * 100 : 0;

      if (time_saved_tc > 0) {
        purchaseOptions.push({
          target: "TC",
          wait: t_wait,
          timeSaved: time_saved_tc,
          pctSaved: tc_efficiencyDelta,
          cost: SHREDDER_STATE.nextTcCost.toString(),
          affordable: tcAffordable,
        });
      }
    }
  }
  // Evaluate top options
  purchaseOptions.sort((a, b) => b.timeSaved - a.timeSaved);
  const topOptions = purchaseOptions.slice(0, 2);
  if (topOptions.length > 0) {
    bestPurchase = topOptions[0].target;
    bestPurchaseWait = topOptions[0].wait;
    maxTimeSaved = topOptions[0].timeSaved;
  }
  affordableTargets = purchaseOptions
    .filter((o) => o.affordable)
    .map((o) => o.target);

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
    topOptions: topOptions,
    maxDustBeforeSoftcap: maxDustBeforeSoftcap,
    hasReachedE308: SHREDDER_STATE.hasReachedE308,
  };
}

async function scrapePlayerAddress() {
  if (window.ethereum) {
    if (window.ethereum.selectedAddress) {
      return window.ethereum.selectedAddress;
    }
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
  return "0xc2e97ae6ca9aafb19ce0b8bcd1f4c50285db2377";
}

const intervalId = setInterval(async () => {
  try {
    if (!chainPlayerAddress) {
      chainPlayerAddress = await scrapePlayerAddress();
    }
    const now = Date.now();
    if (chainPlayerAddress && now - lastChainFetch > 3000) {
      lastChainFetch = now;
      fetchChainState(chainPlayerAddress)
        .then((cs) => {
          applyChainState(cs);
        })
        .catch((err) =>
          console.warn("[Dusted] Chain fetch failed:", err.message),
        );
    }

    const found = extractData();

    // Always increment smoothly, regardless of tab
    if (SHREDDER_STATE.hasScannedStats) {
      SHREDDER_STATE.ticksThisRun = (SHREDDER_STATE.ticksThisRun || 0) + 1;

      // Enforce baseline to prevent falling behind (e.g. computer sleep or fast blocks)
      const currentBlock = extractCurrentBlock();
      if (
        currentBlock > 0 &&
        SHREDDER_STATE.lastUpdateBlock >= 0 &&
        SHREDDER_STATE.chainTicksThisRun !== undefined
      ) {
        const blocksSinceUpdate = Math.max(
          0,
          currentBlock - SHREDDER_STATE.lastUpdateBlock,
        );
        const baselineTicks =
          SHREDDER_STATE.chainTicksThisRun + blocksSinceUpdate * 5;
        if (baselineTicks > SHREDDER_STATE.ticksThisRun) {
          SHREDDER_STATE.ticksThisRun = baselineTicks;
        }
      }
    }

    // Fallback: If we are not on the Dust/Stats tab where elements are visible, use the local ticker
    if (!found.dustFound && SHREDDER_STATE.hasScannedStats) {
      if (SHREDDER_STATE.dust && SHREDDER_STATE.dustPerTick) {
        // Also simulate the 1.02 compounding since the game engine does this
        const rate =
          SHREDDER_STATE.activeTicks < SHREDDER_STATE.softcap
            ? 1.02
            : Math.pow(1.02, 0.5);
        SHREDDER_STATE.dustPerTick = SHREDDER_STATE.dustPerTick.mul(rate);
        SHREDDER_STATE.dust = SHREDDER_STATE.dust.add(
          SHREDDER_STATE.dustPerTick,
        );
      }
    }

    if (SHREDDER_STATE.hasScannedStats) {
      SHREDDER_STATE.activeTicks = Math.max(
        0,
        SHREDDER_STATE.ticksThisRun - SHREDDER_STATE.tcStart,
      );
    }
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
      requiredDust: SHREDDER_STATE.requiredDust
        ? SHREDDER_STATE.requiredDust.toExponential(3)
        : null,
      crystallisations: SHREDDER_STATE.crystallisations || 0,
      powerMultiplier: SHREDDER_STATE.powerMultiplier || 9,
      moteMultiplier: SHREDDER_STATE.moteMultiplier || 1,
      moteDivisor: SHREDDER_STATE.moteDivisor || 308,
      roundMax: SHREDDER_STATE.roundMax,
      allTimeMax: SHREDDER_STATE.allTimeMax,
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
