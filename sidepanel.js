document.getElementById('target-motes').addEventListener('input', (e) => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_TARGET_MOTES', value: parseFloat(e.target.value) || 0 }).catch(()=>{});
    }
  });
});

function formatDelta(delta) {
  if (delta === -999) return '<span class="neutral-delta">Filtered</span>';
  const val = delta.toFixed(2);
  if (delta > 0) return `<span class="positive-delta">+${val}%</span>`;
  if (delta < 0) return `<span class="negative-delta">${val}%</span>`;
  return `<span class="neutral-delta">0.00%</span>`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HUD_UPDATE') {
    const state = message.payload;
    
    // Update KPI: Time to Floor
    const ttf = Math.floor(state.timeToFloor);
    document.getElementById('time-to-floor').textContent = ttf > 0 ? ttf.toLocaleString() : "0";

    const softcap = state.softcap || 30760;
    const progress = Math.min(100, (state.activeTicks / softcap) * 100);
    document.getElementById('softcap-bar').style.width = `${progress}%`;
    document.getElementById('softcap-text').textContent = `Ticks to Softcap: ${state.activeTicks.toLocaleString()} / ${softcap.toLocaleString()}`;

    // Update global stats
    document.getElementById('dust').textContent = new Decimal(state.dust).toExponential(3);
    document.getElementById('dust-per-tick').textContent = new Decimal(state.dustPerTick).toExponential(3);
    document.getElementById('motes').textContent = state.motes.toLocaleString();
    
    // Update recommendation
    const recEl = document.getElementById('recommendation');
    recEl.textContent = state.recommendation;
    if (state.recommendation.includes("CRITICAL")) {
      recEl.style.color = "#f85149";
    } else if (state.recommendation.includes("Target")) {
      recEl.style.color = "#3fb950";
    } else {
      recEl.style.color = "#58a6ff";
    }

    // Update TCs
    document.getElementById('compressions').textContent = state.compressions;
    document.getElementById('next-tc-cost').textContent = new Decimal(state.nextTcCost).toExponential(3);
    document.getElementById('tc-delta').innerHTML = formatDelta(state.tc_efficiencyDelta);

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
