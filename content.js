console.log("Dust Protocol HUD: Intelligence script loaded.");

const SHREDDER_STATE = {
  dust: new Decimal(0),
  dustPerTick: new Decimal(0),
  activeTicks: 0,
  softcap: 30760,
  motes: 0,
  pendingMotes: 0,
  targetMotes: 40,
  cheapestUpgrade: null,
  hasScannedTC: false,
  hasScannedUpgrades: false,
  hasScannedStats: false,
  ticksThisRun: 0,
  tcStart: 6200,
  condensers: [],
  compressions: 0,
  nextTcCost: new Decimal(0)
};

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SET_TARGET_MOTES') {
    SHREDDER_STATE.targetMotes = message.value;
  }
});

function parseSciNum(text) {
  if (!text) return new Decimal(0);
  const match = text.match(/([0-9.]+)(?:e\+?(-?[0-9]+))?/i);
  if (!match) return new Decimal(0);
  return new Decimal(match[0]);
}

function extractData() {
  const fullText = document.body.innerText;

  // Dust and Dust/Tick (Primary: span classes, Fallback: raw text)
  const dustEl = document.querySelector('span.yel');
  if (dustEl) {
    SHREDDER_STATE.dust = parseSciNum(dustEl.textContent);
  } else {
    const dMatch = fullText.match(/dust\s+([0-9.e+]+)/i);
    if (dMatch) SHREDDER_STATE.dust = parseSciNum(dMatch[1]);
  }

  const dustTickEl = document.querySelector('span.oran');
  if (dustTickEl) {
    SHREDDER_STATE.dustPerTick = parseSciNum(dustTickEl.textContent);
  } else {
    const dtMatch = fullText.match(/dust \/ tick\s+([0-9.e+]+)/i);
    if (dtMatch) SHREDDER_STATE.dustPerTick = parseSciNum(dtMatch[1]);
  }

  // Motes & Active Ticks via raw text to ignore arbitrary HTML nesting
  const motesMatch = fullText.match(/motes\s+~?([\d,.]+)/i);
  if (motesMatch) SHREDDER_STATE.motes = parseFloat(motesMatch[1].replace(/,/g, ''));

  const activeTicksMatch = fullText.match(/active ticks\s+([\d,]+)(?:\s*\/\s*([\d,]+))?/i);
  if (activeTicksMatch) {
    SHREDDER_STATE.activeTicks = parseInt(activeTicksMatch[1].replace(/,/g, ''), 10);
    if (activeTicksMatch[2]) {
      SHREDDER_STATE.softcap = parseInt(activeTicksMatch[2].replace(/,/g, ''), 10);
    }
  }

  // Upgrades parsing
  let cheapestUpgrade = Infinity;
  const upgradeMatches = fullText.matchAll(/([\d.]+)([kKmM]?)\s+BUY/gi);
  for (const match of upgradeMatches) {
    let cost = parseFloat(match[1]);
    const suffix = match[2].toLowerCase();
    if (suffix === 'k') cost /= 1000;
    // Assuming 'm' is motes, so no conversion needed for m since motes are base unit
    if (cost < cheapestUpgrade) {
      cheapestUpgrade = cost;
    }
  }
  if (cheapestUpgrade !== Infinity) {
    SHREDDER_STATE.cheapestUpgrade = cheapestUpgrade;
  }
  
  if (cheapestUpgrade !== Infinity || fullText.match(/t[1-4][\s\n]*-/i) || fullText.includes("req:")) {
    SHREDDER_STATE.hasScannedUpgrades = true;
  }

  // Temporal Compression parsing
  const compMatch = fullText.match(/compressions\s+(\d+)/i);
  if (compMatch) {
    SHREDDER_STATE.compressions = parseInt(compMatch[1], 10);
    SHREDDER_STATE.hasScannedTC = true;
  }

  const tcCostMatch = fullText.match(/compressions[\s\S]{1,200}?cost\s+([0-9.e+]+)\s+dust/i);
  if (tcCostMatch) {
    SHREDDER_STATE.nextTcCost = parseSciNum(tcCostMatch[1]);
    SHREDDER_STATE.hasScannedTC = true;
  }

  // CR Tab Pending Motes Parsing (Post e308)
  if (SHREDDER_STATE.dust.gte(new Decimal("1e308"))) {
    // The CR tab shows: motes gained ~7.18
    const crRegex = /motes gained\s*~?\s*([\d.,]+)/i;
    const crMatch = fullText.match(crRegex);
    if (crMatch) {
      SHREDDER_STATE.pendingMotes = parseFloat(crMatch[1].replace(/,/g, ''));
    }
  } else {
    SHREDDER_STATE.pendingMotes = 0;
  }

  // Stats Telemetry Parsing
  const ticksRunMatch = fullText.match(/ticks this run\s+([\d,]+)/i);
  if (ticksRunMatch) {
    SHREDDER_STATE.ticksThisRun = parseInt(ticksRunMatch[1].replace(/,/g, ''), 10);
    SHREDDER_STATE.hasScannedStats = true;
  }
  
  const tcStartMatch = fullText.match(/eff\. tc start \/ softcap\s+([\d,]+)\s*\/\s*([\d,]+)/i);
  if (tcStartMatch) {
    SHREDDER_STATE.tcStart = parseInt(tcStartMatch[1].replace(/,/g, ''), 10);
    SHREDDER_STATE.softcap = parseInt(tcStartMatch[2].replace(/,/g, ''), 10);
    SHREDDER_STATE.hasScannedStats = true;
  }

  // Condenser Grid (Robust row detection ignoring exact CSS styles)
  const currentCondensers = [];
  const allDivs = document.querySelectorAll('div');
  allDivs.forEach(row => {
    const children = row.children;
    if (children.length >= 4) {
      const tierText = (children[0].textContent || "").trim().toLowerCase();
      if (/^dc[1-8]$/.test(tierText)) {
        currentCondensers.push({
          tier: tierText.toUpperCase(),
          amount: parseSciNum(children[1].textContent),
          nextCost: parseSciNum(children[3].textContent)
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
  let timeToFloor = 0;
  
  if (P_tick.gt(0)) {
    // Formula: t = (308 - log10(P_current)) / log10(1.02)
    const log10_P = P_tick.log10();
    timeToFloor = (308 - log10_P) / Math.log10(1.02);
    timeToFloor = Math.max(0, timeToFloor);
  }

  // Derived from the Stats Page Carry Effects
  const MULTIPLIERS = {
    'DC1': 3,
    'DC2': 4,
    'DC3': 5,
    'DC4': 6,
    'DC5': 8,
    'DC6': 10,
    'DC7': 12,
    'DC8': 15,
    'TC': 1.058 // Estimated from 1.624e6 at 253 compressions
  };

  let bestPurchase = null;
  let bestPurchaseWait = 0;
  let maxTimeSaved = -Infinity;
  
  // Calculate efficiency delta for each condenser
  const evaluatedCondensers = SHREDDER_STATE.condensers.map(c => {
    let efficiencyDelta = 0;
    
    // The DC-Spike Filter: Ignore DC1-DC4 if cost > e100 and cost > P_tick
    const isDC1_4 = ['DC1', 'DC2', 'DC3', 'DC4'].includes(c.tier);
    if (isDC1_4 && c.nextCost.gt(new Decimal("1e100")) && c.nextCost.gt(P_tick)) {
      efficiencyDelta = -999; // Filtered out
    } else if (P_tick.gt(0)) {
      const diff = Decimal.max(0, c.nextCost.sub(SHREDDER_STATE.dust));
      const t_wait = diff.div(P_tick).toNumber();
      
      // Estimate P_new using the exact carry effect bases
      const multiplier = MULTIPLIERS[c.tier] || 1.1;
      const P_new_estimated = P_tick.mul(multiplier);
      const t_floor_after = (308 - P_new_estimated.log10()) / Math.log10(1.02);
      
      const total_time_if_buy = t_wait + t_floor_after;
      const time_saved = timeToFloor - total_time_if_buy;
      efficiencyDelta = timeToFloor > 0 ? (time_saved / timeToFloor) * 100 : 0;
      
      if (time_saved > maxTimeSaved && time_saved > 0) {
        maxTimeSaved = time_saved;
        bestPurchase = c.tier;
        bestPurchaseWait = t_wait;
      }
    }

    return {
      tier: c.tier,
      amount: c.amount.toString(),
      nextCost: c.nextCost.toString(),
      efficiencyDelta: efficiencyDelta
    };
  });

  // Evaluate TC
  let tc_efficiencyDelta = 0;
  if (SHREDDER_STATE.nextTcCost.gt(0) && P_tick.gt(0)) {
    const diff = Decimal.max(0, SHREDDER_STATE.nextTcCost.sub(SHREDDER_STATE.dust));
    const t_wait = diff.div(P_tick).toNumber();
    
    // Apply Temporal Compression estimated multiplier
    const P_new_tc = P_tick.mul(MULTIPLIERS['TC']);
    const t_floor_after_tc = (308 - P_new_tc.log10()) / Math.log10(1.02);
    const total_time_if_buy_tc = t_wait + t_floor_after_tc;
    const time_saved_tc = timeToFloor - total_time_if_buy_tc;
    
    tc_efficiencyDelta = timeToFloor > 0 ? (time_saved_tc / timeToFloor) * 100 : 0;
    
    if (time_saved_tc > maxTimeSaved && time_saved_tc > 0) {
      maxTimeSaved = time_saved_tc;
      bestPurchase = "Temporal Compression";
      bestPurchaseWait = t_wait;
    }
  }

  // Hard Exit Rule Simulation
  let recommendation = "Hold Position (Natural Growth)";
  
  const isPostE308 = SHREDDER_STATE.dust.gte(new Decimal("1e308"));
  const totalMotes = SHREDDER_STATE.motes + SHREDDER_STATE.pendingMotes;
  const hasTargetMotes = totalMotes >= SHREDDER_STATE.targetMotes;
  const hitSoftcap = SHREDDER_STATE.activeTicks >= SHREDDER_STATE.softcap;

  if (isPostE308) {
    if (hasTargetMotes) {
      recommendation = "CRITICAL: MOTE TARGET REACHED. CRYSTALLISE!";
    } else if (hitSoftcap) {
      recommendation = "CRITICAL: SOFTCAP HIT. GRINDING HALTED.";
    } else {
      recommendation = "Pushing to Target (Monitor CR Tab for Motes)";
    }
  } else if (bestPurchase) {
    recommendation = `Target Acquisition: ${bestPurchase}`;
  }

  return {
    timeToFloor: timeToFloor,
    recommendation: recommendation,
    bestPurchaseWait: bestPurchaseWait,
    condensers: evaluatedCondensers,
    tc_efficiencyDelta: tc_efficiencyDelta
  };
}

const intervalId = setInterval(() => {
  try {
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
      cheapestUpgrade: SHREDDER_STATE.cheapestUpgrade,
      hasScannedTC: SHREDDER_STATE.hasScannedTC,
      hasScannedUpgrades: SHREDDER_STATE.hasScannedUpgrades,
      hasScannedStats: SHREDDER_STATE.hasScannedStats,
      ticksThisRun: SHREDDER_STATE.ticksThisRun,
      tcStart: SHREDDER_STATE.tcStart,
      compressions: SHREDDER_STATE.compressions,
      nextTcCost: SHREDDER_STATE.nextTcCost.toString(),
      ...strategy
    };
    
    chrome.runtime.sendMessage({ type: 'HUD_UPDATE', payload }).catch((err) => {
      if (err.message && err.message.includes("Extension context invalidated")) {
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
