document.getElementById('target-motes').addEventListener('input', (e) => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_TARGET_MOTES', value: parseFloat(e.target.value) || 0 }).catch(()=>{});
    }
  });
});

document.getElementById('cheapest-upgrade-link').addEventListener('click', (e) => {
  e.preventDefault();
  const val = parseFloat(e.target.textContent);
  document.getElementById('target-motes').value = val;
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_TARGET_MOTES', value: val }).catch(()=>{});
    }
  });
});

function formatTime(ticks) {
  if (!ticks || ticks <= 0) return "";
  const totalSeconds = Math.round(ticks);
  if (totalSeconds === 0) return "(< 1s)";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const unit = (u) => `<span style="text-transform: lowercase; font-size: 0.9em; opacity: 0.7; margin-left: 1px;">${u}</span>`;
  
  if (h > 0) return `(~${h}${unit('h')} ${m}${unit('m')} ${s}${unit('s')})`;
  if (m > 0) return `(~${m}${unit('m')} ${s}${unit('s')})`;
  return `(~${s}${unit('s')})`;
}

function formatDelta(delta) {
  if (delta === undefined || delta === null || Number.isNaN(delta)) return '<span class="neutral-delta">--</span>';
  if (delta === -999) return '<span class="neutral-delta">Filtered</span>';
  if (delta < -999) return '<span class="negative-delta">< -999%</span>';
  const val = delta.toFixed(2);
  if (delta > 0) return `<span class="positive-delta">+${val}%</span>`;
  if (delta < 0) return `<span class="negative-delta">${val}%</span>`;
  return `<span class="neutral-delta">0.00%</span>`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HUD_UPDATE') {
    const state = message.payload;
    
    // Init Checklist
    const initBox = document.getElementById('init-checklist');
    let showChecklist = false;

    if (!state.hasScannedTC || !state.hasScannedUpgrades || !state.hasScannedStats) {
      showChecklist = true;
      
      const tcCheck = document.getElementById('check-tc');
      if (state.hasScannedTC) {
        tcCheck.textContent = "[OK] Temporal Matrix Online.";
        tcCheck.style.color = "#516079";
      } else {
        tcCheck.textContent = "[-] Calibrating Temporal Matrix... (Visit TC Tab)";
        tcCheck.style.color = "#e27e5d";
      }
      
      const upCheck = document.getElementById('check-up');
      if (state.hasScannedUpgrades) {
        upCheck.textContent = "[OK] Expansion Trees Online.";
        upCheck.style.color = "#516079";
      } else {
        upCheck.textContent = "[-] Calibrating Expansion Trees... (Visit Upgrades Tab)";
        upCheck.style.color = "#e27e5d";
      }

      const stCheck = document.getElementById('check-st');
      if (state.hasScannedStats) {
        stCheck.textContent = "[OK] Telemetry Online.";
        stCheck.style.color = "#516079";
      } else {
        stCheck.textContent = "[-] Calibrating Telemetry... (Visit Stats Tab)";
        stCheck.style.color = "#e27e5d";
      }
    }

    const crCheck = document.getElementById('check-cr');
    if (state.needsCRScan) {
      showChecklist = true;
      crCheck.style.display = 'block';
      crCheck.textContent = "[-] Calibrating Post-e308 Motes... (Visit CR Tab)";
      crCheck.style.color = "#e27e5d";
    } else {
      crCheck.style.display = 'none';
    }

    if (showChecklist) {
      initBox.style.display = 'block';
    } else {
      initBox.style.display = 'none';
    }

    // Update KPI: Time to Floor
    const ttf = Math.floor(state.timeToFloor);
    document.getElementById('time-to-floor').textContent = ttf > 0 ? ttf.toLocaleString() : "0";
    document.getElementById('time-estimate').innerHTML = ttf > 0 ? formatTime(ttf) : "";
    const softcap = state.softcap || 30760;
    const progress = Math.min(100, (state.activeTicks / softcap) * 100);
    document.getElementById('softcap-bar').style.width = `${progress}%`;
    document.getElementById('softcap-text').textContent = `Ticks to Softcap: ${state.activeTicks.toLocaleString()} / ${softcap.toLocaleString()}`;

    // Update global stats
    document.getElementById('dust').textContent = new Decimal(state.dust).toExponential(3);
    document.getElementById('dust-per-tick').textContent = new Decimal(state.dustPerTick).toExponential(3);
    document.getElementById('motes').textContent = state.motes.toLocaleString();
    document.getElementById('pending-motes').textContent = state.pendingMotes ? state.pendingMotes.toLocaleString() : "0";
    document.getElementById('total-motes').textContent = state.totalMotes ? state.totalMotes.toLocaleString() : state.motes.toLocaleString();
    
    if (state.cheapestUpgrade) {
      document.getElementById('cheapest-upgrade-container').style.display = 'block';
      document.getElementById('cheapest-upgrade-link').textContent = state.cheapestUpgrade;
    }

    // Update Telemetry
    document.getElementById('ticks-this-run').textContent = (state.ticksThisRun || 0).toLocaleString();
    document.getElementById('active-ticks').textContent = (state.activeTicks || 0).toLocaleString();
    document.getElementById('tc-start').textContent = (state.tcStart || 0).toLocaleString();
    
    // TC Eff Remaining
    const tcRemEl = document.getElementById('tc-eff-remaining');
    const remainingTc = (state.tcStart || 0) - (state.activeTicks || 0);
    if (remainingTc > 0) {
      tcRemEl.innerHTML = formatTime(remainingTc);
      tcRemEl.style.color = "#516079";
    } else {
      tcRemEl.textContent = `[ACTIVE]`;
      tcRemEl.style.color = "#65b086";
    }

    document.getElementById('softcap-limit').textContent = (state.softcap || 30760).toLocaleString();

    // Update recommendation
    const recEl = document.getElementById('recommendation');
    
    if (state.recommendation.includes("CRITICAL: MOTE")) {
      recEl.textContent = state.recommendation;
      recEl.style.color = "#65b086";
    } else if (state.recommendation.includes("CRITICAL")) {
      recEl.textContent = state.recommendation;
      recEl.style.color = "#e27e5d";
    } else if (state.recommendation.includes("Target Acquisition")) {
      const bestTarget = state.recommendation.replace("Target Acquisition: ", "");
      let finalStr = "";
      if (state.bestPurchaseWait > 0) {
        const timeStr = formatTime(state.bestPurchaseWait).replace(/[()~]/g, '').trim();
        finalStr = `BUY ${bestTarget} IN ${timeStr}`;
        if (state.affordableTargets && state.affordableTargets.length > 0) {
          const others = state.affordableTargets.filter(t => t !== bestTarget);
          if (others.length > 0) {
            finalStr += ` <span style="color:#e27e5d; font-size: 0.8em;">[+ ${others.join(', ')} READY]</span>`;
          }
        }
      } else {
        finalStr = `BUY ${bestTarget} NOW`;
      }
      recEl.innerHTML = finalStr;
      recEl.style.color = "#48bbea";
    } else {
      recEl.textContent = state.recommendation;
      recEl.style.color = "#8b9bb4";
    }

    // Update TC
    if (new Decimal(state.nextTcCost).eq(0)) {
      document.getElementById('compressions').textContent = "Pending...";
      document.getElementById('next-tc-cost').textContent = "(Visit TC tab to scan)";
      document.getElementById('tc-delta').innerHTML = "--";
    } else {
      document.getElementById('compressions').textContent = state.compressions;
      document.getElementById('next-tc-cost').textContent = new Decimal(state.nextTcCost).toExponential(3);
      document.getElementById('tc-delta').innerHTML = formatDelta(state.tc_efficiencyDelta);
    }

    // Update grid
    const grid = document.getElementById('grid-status');
    grid.innerHTML = '';
    state.condensers.forEach(c => {
      const row = document.createElement('div');
      row.className = 'grid-row';
      row.innerHTML = `<span>${c.tier}</span><span>${new Decimal(c.nextCost).toExponential(3)}</span><span>${formatDelta(c.efficiencyDelta)}</span>`;
      grid.appendChild(row);
    });
  }
});
