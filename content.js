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
  nextTcCost: new Decimal(0),
  unclaimedDust: new Decimal(0),
  hasReachedE308: false  // Persists for the run — once e308 is hit, crystallization is always available
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
  return new Decimal(match[0].toLowerCase());
}

// Feature #1: Softcap-aware floor calculation
// Accounts for growth rate dropping from 1.02 to 1.02^0.5 at the softcap boundary
// logTarget: the log10 production level to reach (default 308 for crystallization floor)
function ticksToReachFloor(log10P, currentActiveTicks, softcap, logTarget) {
  if (logTarget === undefined) logTarget = 308;
  if (log10P >= logTarget) return 0;

  const preRate = Math.log10(1.02);        // ~0.00860 (full compounding)
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
  const postSoftcapTicks = Math.max(0, (logTarget - log10P_at_softcap) / postRate);

  return ticksToSoftcap + postSoftcapTicks;
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

  // Parse unclaimed production
  const unclaimedMatch = fullText.match(/\(\+([0-9.e+]+)\s*dust\)/i);
  if (unclaimedMatch) {
    SHREDDER_STATE.unclaimedDust = parseSciNum(unclaimedMatch[1]);
  } else {
    SHREDDER_STATE.unclaimedDust = new Decimal(0);
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
  
  if (
    cheapestUpgrade !== Infinity || 
    fullText.match(/t[1-4][\s\n]*[-–—]/i) || 
    fullText.includes("req:") ||
    fullText.match(/\bt1\b[\s\S]{1,50}\bt2\b[\s\S]{1,50}\bt3\b/i) ||
    fullText.match(/amplifier\s*=>/i)
  ) {
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

  // CR Tab Pending Motes Parsing
  const crRegex = /motes gained\s*~?\s*([\d.,]+)/i;
  const crMatch = fullText.match(crRegex);
  if (crMatch) {
    SHREDDER_STATE.pendingMotes = parseFloat(crMatch[1].replace(/,/g, ''));
  } else if (fullText.toLowerCase().includes("crystallise at 1e308")) {
    SHREDDER_STATE.pendingMotes = 0;
  }

  // Stats Telemetry Parsing
  const ticksRunMatch = fullText.match(/ticks this run\s+([\d,]+)/i);
  if (ticksRunMatch) {
    const currentTicks = parseInt(ticksRunMatch[1].replace(/,/g, ''), 10);
    if (SHREDDER_STATE.ticksThisRun > 0 && currentTicks < SHREDDER_STATE.ticksThisRun - 100) {
      // RESET DETECTED
      SHREDDER_STATE.nextTcCost = new Decimal(0);
      SHREDDER_STATE.hasScannedTC = false;
      SHREDDER_STATE.compressions = "Pending...";
      SHREDDER_STATE.cheapestUpgrade = null;
      SHREDDER_STATE.hasScannedUpgrades = false;
      SHREDDER_STATE.hasReachedE308 = false; // Reset on crystallization
    }
    SHREDDER_STATE.ticksThisRun = currentTicks;
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
  const effectiveDust = SHREDDER_STATE.dust.add(SHREDDER_STATE.unclaimedDust);
  const activeTicks = SHREDDER_STATE.activeTicks;
  const softcap = SHREDDER_STATE.softcap;
  let timeToFloor = 0;
  let maxDustBeforeSoftcap = null;
  let optimizationTarget = 308; // Default: crystallization floor
  
  // Latch the e308 flag once effective dust (or max dust) reaches e308
  if (effectiveDust.gte(new Decimal("1e308")) || SHREDDER_STATE.pendingMotes > 0) {
    SHREDDER_STATE.hasReachedE308 = true;
  }

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
    'DC1': 3,
    'DC2': 4,
    'DC3': 5,
    'DC4': 6,
    'DC5': 8,
    'DC6': 10,
    'DC7': 12,
    'DC8': 15
  };

  let bestPurchase = null;
  let bestPurchaseWait = 0;
  let maxTimeSaved = -Infinity;
  let affordableTargets = [];
  
  // Calculate efficiency delta for each condenser
  const evaluatedCondensers = SHREDDER_STATE.condensers.map(c => {
    let efficiencyDelta = 0;
    let c_t_wait = Infinity;
    
    // The DC-Spike Filter: Ignore DC1-DC4 if cost > e100 and cost > P_tick
    const isDC1_4 = ['DC1', 'DC2', 'DC3', 'DC4'].includes(c.tier);
    if (isDC1_4 && c.nextCost.gt(new Decimal("1e100")) && c.nextCost.gt(P_tick)) {
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
        const t_floor_after = ticksToReachFloor(P_new_estimated.log10(), activeTicksAtPurchase, softcap, optimizationTarget);
        
        const total_time_if_buy = c_t_wait + t_floor_after;
        const time_saved = timeToFloor - total_time_if_buy;
        efficiencyDelta = timeToFloor > 0 ? (time_saved / timeToFloor) * 100 : 0;
        
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
      t_wait: c_t_wait
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
        multiplierToApply = Decimal.pow(baseMultiplier, SHREDDER_STATE.compressions + 1);
        multiplierToApply = multiplierToApply.mul(Math.pow(1.02, 100));
      }
      
      const P_new_tc = P_tick.mul(multiplierToApply);
      // Feature #1: TC purchase grants +100 active ticks (threshold drops)
      const activeTicksAtTcPurchase = activeTicks + t_wait + 100;
      const t_floor_after_tc = ticksToReachFloor(P_new_tc.log10(), activeTicksAtTcPurchase, softcap, optimizationTarget);
      const total_time_if_buy_tc = t_wait + t_floor_after_tc;
      const time_saved_tc = timeToFloor - total_time_if_buy_tc;
      
      tc_efficiencyDelta = timeToFloor > 0 ? (time_saved_tc / timeToFloor) * 100 : 0;
      
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
      .filter(c => {
        const diff = Decimal.max(0, c.nextCost.sub(effectiveDust));
        if (!diff.eq(0) || !MULTIPLIERS[c.tier]) return false;
        // Apply DC-Spike filter: exclude DC1-DC4 if cost > e100 and cost > P_tick
        const isDC1_4 = ['DC1', 'DC2', 'DC3', 'DC4'].includes(c.tier);
        if (isDC1_4 && c.nextCost.gt(new Decimal("1e100")) && c.nextCost.gt(P_tick)) return false;
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
        const simTimeToFloor = ticksToReachFloor(simP.log10(), simActiveTicks, softcap, optimizationTarget);

        // Now evaluate remaining non-affordable upgrades against the boosted state
        let chainBestTarget = null;
        let chainBestWait = 0;
        let chainMaxTimeSaved = -Infinity;

        SHREDDER_STATE.condensers.forEach(c => {
          if (chainSteps.includes(c.tier)) return; // Already bought in chain
          const isDC1_4 = ['DC1', 'DC2', 'DC3', 'DC4'].includes(c.tier);
          if (isDC1_4 && c.nextCost.gt(new Decimal("1e100")) && c.nextCost.gt(simP)) return;

          const diff = Decimal.max(0, c.nextCost.sub(simDust));
          const chainWait = diff.div(simP).toNumber();
          const multiplier = MULTIPLIERS[c.tier] || 1.1;
          const P_new = simP.mul(multiplier);
          const activeAtPurchase = simActiveTicks + chainWait;
          const floorAfter = ticksToReachFloor(P_new.log10(), activeAtPurchase, softcap, optimizationTarget);
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
          const tcFloorAfter = ticksToReachFloor(P_new_tc.log10(), tcActiveAfter, softcap, optimizationTarget);
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

          if (chainTotalFloor < singleTotalFloor && chainTotalFloor < timeToFloor) {
            // Chain path wins
            chainSequence = {
              steps: chainSteps,
              target: chainBestTarget,
              wait: chainBestWait,
              totalTime: chainTotalFloor
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

  if (hasTargetMotes) {
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
    hasReachedE308: SHREDDER_STATE.hasReachedE308
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
      needsCRScan: SHREDDER_STATE.hasReachedE308 && SHREDDER_STATE.pendingMotes === 0,
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
