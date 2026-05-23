let currentMoteMultiplier = 1;
let currentMoteDivisor = 308;
let lastAffordableRecommendation = "";
let syncedTabs = new Set();

function updateSoundToggleUI(checked) {
  const slider = document.getElementById("sound-toggle-slider");
  const knob = document.getElementById("sound-toggle-knob");
  if (slider && knob) {
    if (checked) {
      slider.style.backgroundColor = "#65b086";
      knob.style.left = "18px";
    } else {
      slider.style.backgroundColor = "#516079";
      knob.style.left = "2px";
    }
  }
}

// Simple Web Audio API beep
function playPingSound() {
  const soundEnabled = document.getElementById("sound-toggle")
    ? document.getElementById("sound-toggle").checked
    : true;
  if (!soundEnabled) return;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    
    // Quick fade out for a pleasant "ping"
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.warn("Audio Context blocked or unsupported:", e);
  }
}

function updateSimulation() {
  const dustVal = document.getElementById('sim-dust').value.trim();
  const motesVal = document.getElementById('sim-motes').value.trim();

  if (dustVal) {
    try {
      const dustDecimal = new Decimal(dustVal);
      if (dustDecimal.lt("1e308")) {
        document.getElementById('sim-motes-out').textContent = "0";
      } else {
        const logDust = dustDecimal.log10();
        const exponent = logDust / currentMoteDivisor - 0.75;
        const motes = Decimal.pow(10, exponent).times(currentMoteMultiplier);

        let displayMotes;
        if (motes.gte(1000)) {
          displayMotes = motes.toNumber().toLocaleString(undefined, { maximumFractionDigits: 0 });
        } else {
          displayMotes = motes.toNumber().toLocaleString(undefined, { maximumFractionDigits: 3 });
        }
        document.getElementById('sim-motes-out').textContent = displayMotes;
      }
    } catch (e) {
      document.getElementById('sim-motes-out').textContent = "--";
    }
  } else {
    document.getElementById('sim-motes-out').textContent = "0";
  }

  if (motesVal) {
    try {
      const target = new Decimal(motesVal);
      if (target.lte(0)) {
        document.getElementById('sim-dust-out').textContent = "1e308";
      } else {
        const baseLog = target.div(currentMoteMultiplier).log10();
        const targetExponent = (baseLog + 0.75) * currentMoteDivisor;
        const reqDust = Decimal.pow(10, targetExponent);
        document.getElementById('sim-dust-out').textContent = reqDust.toExponential(3).replace("e+", "e");
      }
    } catch (e) {
      document.getElementById('sim-dust-out').textContent = "--";
    }
  } else {
    document.getElementById('sim-dust-out').textContent = "0";
  }
}

function syncTargetMotesWithTab(val) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "SET_TARGET_MOTES",
        value: parseFloat(val) || 0,
      }, () => {
        if (chrome.runtime.lastError) {
          // Ignore connection errors safely
        }
      });
    }
  });
}

document.getElementById('sim-dust').addEventListener('input', (e) => {
  chrome.storage.local.set({ simDust: e.target.value });
  updateSimulation();
});

document.getElementById('sim-motes').addEventListener('input', (e) => {
  chrome.storage.local.set({ simMotes: e.target.value });
  updateSimulation();
});

document.getElementById("target-motes").addEventListener("input", (e) => {
  const val = parseFloat(e.target.value) || 0;
  chrome.storage.local.set({ targetMotes: val });
  syncTargetMotesWithTab(val);
});

document
  .getElementById("cheapest-upgrade-link")
  .addEventListener("click", (e) => {
    e.preventDefault();
    const val = parseFloat(e.target.textContent);
    document.getElementById("target-motes").value = val;
    chrome.storage.local.set({ targetMotes: val });
    syncTargetMotesWithTab(val);
  });

document.getElementById("sound-toggle").addEventListener("change", (e) => {
  const checked = e.target.checked;
  updateSoundToggleUI(checked);
  chrome.storage.local.set({ soundNotificationsEnabled: checked });
});

function formatTime(ticks) {
  if (!ticks || ticks <= 0) return "";
  const totalSeconds = Math.round(ticks);
  if (totalSeconds === 0) return "< 1s";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const unit = (u) =>
    `<span style="text-transform: lowercase; font-size: 0.9em; opacity: 0.7; margin-left: 1px;">${u}</span>`;

  if (h > 0) return `~${h}${unit("h")} ${m}${unit("m")} ${s}${unit("s")}`;
  if (m > 0) return `~${m}${unit("m")} ${s}${unit("s")}`;
  return `~${s}${unit("s")}`;
}

function formatDelta(delta) {
  if (delta === undefined || delta === null || Number.isNaN(delta))
    return '<span class="neutral-delta">--</span>';
  if (delta === -999) return '<span class="neutral-delta">—</span>';
  if (delta < -999) return '<span class="negative-delta">< -999%</span>';
  const val = delta.toFixed(2);
  if (delta > 0) return `<span class="positive-delta">+${val}%</span>`;
  if (delta < 0) return `<span class="negative-delta">${val}%</span>`;
  return `<span class="neutral-delta">0.00%</span>`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HUD_UPDATE") {
    try {
      const state = message.payload;
      const tabId = sender.tab ? sender.tab.id : null;
      if (tabId && !syncedTabs.has(tabId)) {
        chrome.storage.local.get("targetMotes", (items) => {
          if (items.targetMotes !== undefined) {
            chrome.tabs.sendMessage(tabId, {
              type: "SET_TARGET_MOTES",
              value: parseFloat(items.targetMotes) || 0,
            }, () => {
              if (chrome.runtime.lastError) {
                // Ignore
              } else {
                syncedTabs.add(tabId);
              }
            });
          }
        });
      }

      currentMoteMultiplier = state.moteMultiplier || 1;
      currentMoteDivisor = state.moteDivisor || 308;
      updateSimulation(); // Update real-time values if properties changed

    // Init Checklist
    const initBox = document.getElementById("init-checklist");
    let showChecklist = false;

    // if (!state.hasScannedTC || !state.hasScannedUpgrades || !state.hasScannedStats) {
    //   showChecklist = true;

    //   const tcCheck = document.getElementById('check-tc');
    //   if (state.hasScannedTC) {
    //     tcCheck.textContent = "[OK] Temporal Matrix Online.";
    //     tcCheck.style.color = "#516079";
    //   } else {
    //     tcCheck.textContent = "[-] Calibrating Temporal Matrix... (Visit TC Tab)";
    //     tcCheck.style.color = "#e27e5d";
    //   }

    //   const upCheck = document.getElementById('check-up');
    //   if (state.hasScannedUpgrades) {
    //     upCheck.textContent = "[OK] Expansion Trees Online.";
    //     upCheck.style.color = "#516079";
    //   } else {
    //     upCheck.textContent = "[-] Calibrating Expansion Trees... (Visit Upgrades Tab)";
    //     upCheck.style.color = "#e27e5d";
    //   }

    //   const stCheck = document.getElementById('check-st');
    //   if (state.hasScannedStats) {
    //     stCheck.textContent = "[OK] Telemetry Online.";
    //     stCheck.style.color = "#516079";
    //   } else {
    //     stCheck.textContent = "[-] Calibrating Telemetry... (Visit Stats Tab)";
    //     stCheck.style.color = "#e27e5d";
    //   }
    // }

    const crCheck = document.getElementById("check-cr");
    if (state.needsCRScan) {
      showChecklist = true;
      crCheck.style.display = "block";
      crCheck.textContent = "[-] Calibrating Post-e308 Motes... (Visit CR Tab)";
      crCheck.style.color = "#e27e5d";
    } else {
      crCheck.style.display = "none";
    }

    if (showChecklist) {
      initBox.style.display = "block";
    } else {
      initBox.style.display = "none";
    }

    // Update KPI: Time to Floor / Softcap
    const ttf = Math.floor(state.timeToFloor);
    const ttfEl = document.getElementById("time-to-floor");
    const timeEstEl = document.getElementById("time-estimate");
    const kpiLabel = document.getElementById("kpi-label");

    // Helper for localized time
    const getEstLocalTime = (ticks) => {
      if (ticks <= 0) return "";
      const d = new Date(Date.now() + ticks * 1000);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    if (state.hasReachedE308) {
      // Post-e308: show productive runway (ticks to softcap) + crystallize badge
      if (ttf > 0) {
        // Pre-softcap: timeToFloor = ticks remaining to softcap
        kpiLabel.textContent = "Ticks to Softcap";
        ttfEl.textContent = ttf.toLocaleString();
        ttfEl.style.color = "#b39ddb";
        document.getElementById("kpi-separator").style.display = "inline";
        timeEstEl.innerHTML = formatTime(ttf);
        timeEstEl.dataset.title = `Est. Time: ${getEstLocalTime(ttf)}`;
        document.getElementById("crys-badge-container").style.display = "block";
      } else {
        // Post-softcap: nothing left to optimize
        kpiLabel.textContent = "Ticks to Crystallize (e308)";
        ttfEl.textContent = "0";
        ttfEl.style.color = "#65b086";
        document.getElementById("kpi-separator").style.display = "none";
        timeEstEl.innerHTML = "";
        timeEstEl.dataset.title = "";
        document.getElementById("crys-badge-container").style.display = "block";
      }
    } else {
      kpiLabel.textContent = "Ticks to Crystallize (e308)";
      ttfEl.textContent = ttf > 0 ? ttf.toLocaleString() : "0";
      ttfEl.style.color = ""; // Reset to default
      if (ttf > 0) {
        document.getElementById("kpi-separator").style.display = "inline";
        timeEstEl.innerHTML = formatTime(ttf);
        timeEstEl.dataset.title = `Est. Time: ${getEstLocalTime(ttf)}`;
      } else {
        document.getElementById("kpi-separator").style.display = "none";
        timeEstEl.innerHTML = "";
        timeEstEl.dataset.title = "";
      }
      document.getElementById("crys-badge-container").style.display = "none";
    }

    const softcap = state.softcap;
    const tcStart = state.tcStart;
    const ticksThisRun = state.ticksThisRun || 0;
    const activeTicks = state.activeTicks || 0;

    // Unify variables
    document.getElementById("ticks-this-run").textContent = ticksThisRun.toLocaleString();
    document.getElementById("softcap-limit").textContent = (softcap || 30760).toLocaleString();

    const phaseSpan = document.getElementById("current-phase");
    const activeTickContainer = document.getElementById("active-tick-container");
    const tcGoalDiv = document.getElementById("goal-tc-start");
    const softcapGoalDiv = document.getElementById("goal-softcap");

    // Calculate Remaining Ticks
    const remainingTc = Math.max(0, tcStart - ticksThisRun);
    const remainingSoftcap = Math.max(0, softcap - activeTicks);

    if (remainingTc > 0) {
      phaseSpan.textContent = "Pre-Temporal Acceleration";
      phaseSpan.style.color = "#516079";

      document.getElementById("kpi-label").style.display = "block";
      document.getElementById("kpi-value-container").style.display = "flex";

      activeTickContainer.style.display = "none";
      tcGoalDiv.style.display = "block";
      document.getElementById("tc-rem-ticks").textContent = remainingTc.toLocaleString();
      const timeFmt = formatTime(remainingTc);
      const timeEl = document.getElementById("tc-rem-time");
      timeEl.innerHTML = timeFmt;
      timeEl.dataset.title = `Est. Time: ${getEstLocalTime(remainingTc)}`;

      softcapGoalDiv.style.display = "none";
      document.getElementById("softcap-bar").style.width = `0%`;
    } else if (remainingSoftcap > 0) {
      phaseSpan.textContent = "Temporal Acceleration Active";
      phaseSpan.style.color = "#ff00ff";

      document.getElementById("kpi-label").style.display = "block";
      document.getElementById("kpi-value-container").style.display = "flex";

      activeTickContainer.style.display = "block";
      document.getElementById("active-ticks").textContent = activeTicks.toLocaleString();

      tcGoalDiv.style.display = "none";
      softcapGoalDiv.style.display = "block";
      document.getElementById("softcap-rem-ticks").textContent = remainingSoftcap.toLocaleString();
      document.getElementById("softcap-rem-time").innerHTML = formatTime(remainingSoftcap);
      document.getElementById("softcap-rem-time").dataset.title = `Est. Time: ${getEstLocalTime(remainingSoftcap)}`;
      
      if (state.hasReachedE308) {
        document.getElementById("softcap-redundant-info").style.display = "none";
      } else {
        document.getElementById("softcap-redundant-info").style.display = "block";
      }

      const progress = Math.min(100, (activeTicks / softcap) * 100);
      document.getElementById("softcap-bar").style.width = `${progress}%`;

      const maxDustDiv = document.getElementById("softcap-max-dust");
      if (state.maxDustBeforeSoftcap !== null && state.maxDustBeforeSoftcap !== undefined) {
        const maxExp = Math.floor(state.maxDustBeforeSoftcap);
        const maxMantissa = Math.pow(10, state.maxDustBeforeSoftcap - maxExp).toFixed(2);

        const exponent = state.maxDustBeforeSoftcap / currentMoteDivisor - 0.75;
        let motesStr = "0";
        if (exponent > 0) {
          const motesVal = Decimal.pow(10, exponent).times(currentMoteMultiplier);
          if (motesVal.gte(1000)) {
            motesStr = motesVal.toNumber().toLocaleString(undefined, { maximumFractionDigits: 0 });
          } else {
            motesStr = motesVal.toNumber().toLocaleString(undefined, { maximumFractionDigits: 3 });
          }
        }

        maxDustDiv.style.display = "block";
        maxDustDiv.innerHTML = `
            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dotted rgba(81, 96, 121, 0.3); line-height: 1.5;">
              <div style="display: flex; justify-content: space-between;">
                <span>&raquo; Max Dust/Tick:</span>
                <span style="color:#48bbea; font-weight:bold;">~${maxMantissa}e${maxExp}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-top: 2px;">
                <span>&raquo; Est. Yield:</span>
                <span style="color:#48bbea; font-weight:bold;">${motesStr} Motes</span>
              </div>
            </div>
          `;
      } else {
        maxDustDiv.style.display = "none";
      }
    } else {
      phaseSpan.textContent = "After Softcap";
      phaseSpan.style.color = "#e27e5d";

      document.getElementById("kpi-label").style.display = "none";
      document.getElementById("kpi-value-container").style.display = "none";

      activeTickContainer.style.display = "none";

      tcGoalDiv.style.display = "none";
      softcapGoalDiv.style.display = "none";

      document.getElementById("softcap-bar").style.width = `100%`;
    }

    // Update global stats
    document.getElementById("crystallisations").textContent = state.crystallisations
      ? state.crystallisations.toLocaleString()
      : "0";
    document.getElementById("dust").textContent = new Decimal(
      state.dust,
    ).toExponential(3);
    document.getElementById("dust-per-tick").textContent = new Decimal(
      state.dustPerTick,
    ).toExponential(3);
    document.getElementById("motes").textContent = state.motes.toLocaleString();
    if (state.pendingMotes) {
      document.getElementById("pending-motes").parentElement.style.display =
        "flex";
      document.getElementById("pending-motes").textContent =
        state.pendingMotes.toLocaleString();
    } else {
      document.getElementById("pending-motes").parentElement.style.display =
        "none";
    }
    document.getElementById("total-motes").textContent = state.totalMotes
      ? state.totalMotes.toLocaleString()
      : state.motes.toLocaleString();

    if (state.cheapestUpgrade) {
      document.getElementById("cheapest-upgrade-container").style.display =
        "block";
      document.getElementById("cheapest-upgrade-link").textContent =
        state.cheapestUpgrade;
    }

    // update required dust if any
    // check why state.requiredDust never seems to be set in content.js - is it being overwritten somewhere? is the message not being sent?

    if (state.requiredDust) {
      document.getElementById("required-dust").textContent = state.requiredDust;
      document.getElementById("required-dust-container").style.display =
        "block";
    } else {
      document.getElementById("required-dust-container").style.display =
        "none";
    }

    if (state.roundMax) {
      try {
        const rdMax = new Decimal(state.roundMax);
        document.getElementById("max-dust-round").textContent = rdMax.eq(0) ? "0" : rdMax.toExponential(3).replace('e+', 'e');
      } catch (e) {
        console.warn("Invalid roundMax:", state.roundMax);
      }
    }
    if (state.allTimeMax) {
      try {
        const evMax = new Decimal(state.allTimeMax);
        document.getElementById("max-dust-ever").textContent = evMax.eq(0) ? "0" : evMax.toExponential(3).replace('e+', 'e');
      } catch (e) {
        console.warn("Invalid allTimeMax:", state.allTimeMax);
      }
    }

    // Update recommendation
    const recEl = document.getElementById("recommendation");

    if (state.recommendation.includes("CRITICAL: MOTE")) {
      recEl.textContent = state.recommendation;
      recEl.style.color = "#65b086";
    } else if (state.recommendation.includes("CRITICAL")) {
      recEl.textContent = state.recommendation;
      recEl.style.color = "#e27e5d";
    } else if (state.recommendation.includes("Target Acquisition")) {
      const bestTarget = state.recommendation.replace(
        "Target Acquisition: ",
        "",
      );
      let finalStr = "";

      const formatCostStr = (str) => {
        if (!str) return "0";
        if (str.includes("e")) {
          const parts = str.split("e");
          return `${parseFloat(parts[0]).toFixed(3)}e${parts[1].replace('+', '')}`;
        }
        return Number(str).toLocaleString();
      };

      const bestOpt = (state.topOptions && state.topOptions.length > 0) ? state.topOptions[0] : null;
      const secondOpt = (state.topOptions && state.topOptions.length > 1) ? state.topOptions[1] : null;

      let primaryStats = "";
      if (bestOpt) {
        const pctStr = (bestOpt.pctSaved > 0) ? ` <span style="opacity: 0.8; font-size: 0.9em;">(${bestOpt.pctSaved.toFixed(2)}%)</span>` : "";
        primaryStats = `<div style="color: #b39ddb; font-size: 0.85em; margin-top: 4px; letter-spacing: 0.5px;">COST: <span style="font-family: monospace;">${formatCostStr(bestOpt.cost)}</span> <span style="color: #516079; margin: 0 4px;">|</span> SAVED: <span style="color: #65b086; font-family: monospace;">${formatTime(bestOpt.timeSaved).replace('~', '').trim()}</span>${pctStr}</div>`;
      }

      let secondaryBlock = "";
      if (secondOpt) {
        const secPctStr = (secondOpt.pctSaved > 0) ? ` <span style="opacity: 0.8; font-size: 0.9em;">(${secondOpt.pctSaved.toFixed(2)}%)</span>` : "";
        secondaryBlock = `
          <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(81, 96, 121, 0.3); font-size: 0.85em; color: #8da3c7; letter-spacing: 0.5px;">
            <div style="text-transform: uppercase; margin-bottom: 6px; font-size: 0.85em; opacity: 0.8; font-weight: bold; color: #516079;">Alternative Option</div>
            <div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;">
              <span style="color: #48bbea; font-weight: bold; font-size: 1.05em;">BUY ${secondOpt.target}</span>
              <span style="color: #516079;">&mdash;</span>
              <span style="color: #b39ddb;">COST: <span style="font-family: monospace;">${formatCostStr(secondOpt.cost)}</span></span>
              <span style="color: #516079;">|</span>
              <span style="color: #b39ddb;">SAVED: <span style="color: #65b086; font-family: monospace;">${formatTime(secondOpt.timeSaved).replace('~', '').trim()}</span>${secPctStr}</span>
            </div>
          </div>
        `;
      }

        if (state.bestPurchaseWait > 0) {
          lastAffordableRecommendation = ""; // Reset since we are waiting again
          
          const timeStr = formatTime(state.bestPurchaseWait)
          .replace(/[()~]/g, "")
          .trim();
        finalStr = `
          <div style="display: flex; align-items: center; gap: 12px; margin-top: 8px;">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 60px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#48bbea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 4px;">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span style="font-family: monospace; font-size: 1.1em; font-weight: bold; color: #48bbea;">${timeStr}</span>
            </div>
            <div style="display: flex; flex-direction: column; border-left: 1px solid rgba(81, 96, 121, 0.3); padding-left: 12px;">
              <span style="font-weight: bold; font-size: 1.1em; letter-spacing: 0.5px; color: #48bbea;">BUY ${bestTarget}</span>
              ${primaryStats}
            </div>
          </div>
        `;
      } else {
        finalStr = `
          <div style="display: flex; align-items: center; gap: 12px; margin-top: 8px;">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 60px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#65b086" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 4px;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9 12l2 2 4-4"></path>
              </svg>
              <span style="font-family: monospace; font-size: 1.1em; font-weight: bold; color: #65b086;">NOW</span>
            </div>
            <div style="display: flex; flex-direction: column; border-left: 1px solid rgba(81, 96, 121, 0.3); padding-left: 12px;">
              <span style="font-weight: bold; font-size: 1.1em; letter-spacing: 0.5px; color: #65b086;">BUY ${bestTarget}</span>
              ${primaryStats}
            </div>
          </div>
        `;
        
        const currentAffordableStr = `BUY ${bestTarget}`;
        if (lastAffordableRecommendation !== currentAffordableStr) {
          playPingSound();
          lastAffordableRecommendation = currentAffordableStr;
        }
      }
      
      finalStr += secondaryBlock;

      recEl.innerHTML = finalStr;
      recEl.style.color = "unset";
    } else {
      recEl.textContent = state.recommendation;
      recEl.style.color = "#8b9bb4";
    }

    // Update TC
    if (new Decimal(state.nextTcCost).eq(0)) {
      document.getElementById("compressions").textContent = "Pending...";
      document.getElementById("tc-power-mult").textContent = "--";
      document.getElementById("tc-multiplier").textContent = "--";
      document.getElementById("next-tc-cost").textContent =
        "(Visit TC tab to scan)";
      document.getElementById("tc-delta").innerHTML = "--";
    } else {
      const comps = state.compressions || 0;
      const pMult = state.powerMultiplier || 9;
      const multiplier = new Decimal(1.01264).pow(comps * pMult);

      document.getElementById("compressions").textContent = comps;
      document.getElementById("tc-power-mult").textContent = `x${pMult.toFixed(2)} (mote upgrade)`;
      document.getElementById("tc-multiplier").textContent = `x${multiplier.toExponential(3)}`;

      document.getElementById("next-tc-cost").textContent = new Decimal(
        state.nextTcCost,
      ).toExponential(3);
      document.getElementById("tc-delta").innerHTML = formatDelta(
        state.tc_efficiencyDelta,
      );
    }

    // Update grid
    const grid = document.getElementById("grid-status");
    grid.innerHTML = "";
    state.condensers.forEach((c) => {
      const row = document.createElement("div");
      row.className = "grid-row";
      row.innerHTML = `<span>${c.tier}</span><span>${new Decimal(c.nextCost).toExponential(3)}</span><span>${formatDelta(c.efficiencyDelta)}</span>`;
      grid.appendChild(row);
    });
    } catch (err) {
      console.error("Sidepanel HUD Update Error:", err);
    }
  }
});

// Load persisted settings on startup
chrome.storage.local.get(
  ["soundNotificationsEnabled", "simDust", "simMotes", "targetMotes"],
  (items) => {
    // 1. Sound Notifications
    const soundEnabled = items.soundNotificationsEnabled !== false;
    const soundToggle = document.getElementById("sound-toggle");
    if (soundToggle) {
      soundToggle.checked = soundEnabled;
      updateSoundToggleUI(soundEnabled);
    }

    // 2. Sim Dust
    const simDustEl = document.getElementById("sim-dust");
    if (simDustEl && items.simDust !== undefined) {
      simDustEl.value = items.simDust;
    }

    // 3. Sim Motes
    const simMotesEl = document.getElementById("sim-motes");
    if (simMotesEl && items.simMotes !== undefined) {
      simMotesEl.value = items.simMotes;
    }

    // 4. Target Motes
    const targetMotesEl = document.getElementById("target-motes");
    if (targetMotesEl && items.targetMotes !== undefined) {
      targetMotesEl.value = items.targetMotes;
      syncTargetMotesWithTab(items.targetMotes);
    }

    updateSimulation();
  }
);
