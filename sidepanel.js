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
  if (delta === -999) return '<span class="neutral-delta">—</span>';
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

    // Update KPI: Time to Floor / Softcap
    const ttf = Math.floor(state.timeToFloor);
    const ttfEl = document.getElementById('time-to-floor');
    const timeEstEl = document.getElementById('time-estimate');
    const kpiLabel = document.getElementById('kpi-label');
    
    if (state.hasReachedE308) {
      // Post-e308: show productive runway (ticks to softcap) + crystallize badge
      if (ttf > 0) {
        // Pre-softcap: timeToFloor = ticks remaining to softcap
        kpiLabel.textContent = "Ticks to Softcap";
        ttfEl.textContent = ttf.toLocaleString();
        ttfEl.style.color = "#b39ddb";
        timeEstEl.innerHTML = `<span style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px;">${formatTime(ttf)}<span style="color: #65b086; font-size: 0.85em; border: 1px solid rgba(101,176,134,0.4); padding: 1px 6px; border-radius: 3px; white-space: nowrap;">⬡ CRYSTALLIZE AVAILABLE</span></span>`;
      } else {
        // Post-softcap: nothing left to optimize
        kpiLabel.textContent = "Ticks to Crystallize (e308)";
        ttfEl.textContent = "0";
        ttfEl.style.color = "#65b086";
        timeEstEl.innerHTML = '<span style="color: #65b086; font-size: 0.85em;">CRYSTALLIZE AVAILABLE</span>';
      }
    } else {
      kpiLabel.textContent = "Ticks to Crystallize (e308)";
      ttfEl.textContent = ttf > 0 ? ttf.toLocaleString() : "0";
      ttfEl.style.color = ""; // Reset to default
      timeEstEl.innerHTML = ttf > 0 ? formatTime(ttf) : "";
    }

    const softcap = state.softcap || 30760;
    const progress = Math.min(100, (state.activeTicks / softcap) * 100);
    document.getElementById('softcap-bar').style.width = `${progress}%`;
    document.getElementById('softcap-text').textContent = `Active Ticks: ${state.activeTicks.toLocaleString()} / ${softcap.toLocaleString()} (Softcap)`;
    const softcapRemainingTicks = Math.max(0, softcap - state.activeTicks);
    const softcapRemText = document.getElementById('softcap-remaining');
    if (softcapRemainingTicks > 0) {
      let softcapHtml = `Softcap in: ${softcapRemainingTicks.toLocaleString()} ticks ${formatTime(softcapRemainingTicks)}`;
      
      // Show max dust estimate before softcap when post-e308 and pre-softcap
      if (state.maxDustBeforeSoftcap !== null && state.maxDustBeforeSoftcap !== undefined) {
        const maxExp = Math.floor(state.maxDustBeforeSoftcap);
        const maxMantissa = Math.pow(10, state.maxDustBeforeSoftcap - maxExp).toFixed(2);
        softcapHtml += `<div style="margin-top: 4px; color: #b39ddb; font-size: 0.9em; text-transform: none;">⟫ Max Dust/Tick at softcap: ~${maxMantissa}e${maxExp}</div>`;
      }
      
      softcapRemText.innerHTML = softcapHtml;
      softcapRemText.style.color = "#48bbea";
    } else {
      softcapRemText.textContent = `Softcap active. Base production penalized.`;
      softcapRemText.style.color = "#e27e5d";
    }

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
    let remainingTc = 0;
    if (state.activeTicks === 0) {
      remainingTc = Math.max(0, (state.tcStart || 0) - (state.ticksThisRun || 0));
    }
    
    if (remainingTc > 0) {
      tcRemEl.innerHTML = `(in ${formatTime(remainingTc).replace(/[()~]/g, '').trim()})`;
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
      
      const others = state.affordableTargets ? state.affordableTargets.filter(t => t !== bestTarget) : [];
      const othersHtml = others.length > 0 ? `<div style="color:#e27e5d; font-size: 0.85em; margin-top: 4px; font-weight: normal; text-transform: none; letter-spacing: 0;">[+ ${others.join(', ')} READY]</div>` : '';
      
      if (state.bestPurchaseWait > 0) {
        const timeStr = formatTime(state.bestPurchaseWait).replace(/[()~]/g, '').trim();
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
              ${othersHtml}
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
              ${othersHtml}
            </div>
          </div>
        `;
      }

      // Feature #3: Append chain suggestion below primary recommendation
      if (state.chainSequence) {
        const chain = state.chainSequence;
        const chainSteps = chain.steps.join(' + ');
        const chainTarget = chain.target;
        const waitColor = chain.wait > 0 ? '#48bbea' : '#65b086';
        const chainWaitStr = chain.wait > 0 ? `(${formatTime(chain.wait).replace(/[()~]/g, '').trim()})` : '';
        finalStr += `
          <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(81, 96, 121, 0.2); font-size: 0.72em; color: #516079; letter-spacing: 0.3px;">
            <div style="text-transform: uppercase; margin-bottom: 4px; opacity: 0.7;">Optimal Chain</div>
            <div style="margin-bottom: 2px;">
              <span style="color: #65b086;">①</span>
              <span style="color: #65b086;"> BUY ${chainSteps}</span>
            </div>
            <div>
              <span style="color: ${waitColor};">②</span>
              <span style="color: ${waitColor};"> BUY ${chainTarget}</span>
              <span style="color: #516079; opacity: 0.7;"> ${chainWaitStr}</span>
            </div>
          </div>
        `;
      }

      recEl.innerHTML = finalStr;
      recEl.style.color = "unset";
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
