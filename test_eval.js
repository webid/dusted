const fs = require('fs');
const contentJs = fs.readFileSync('content.js', 'utf8');

// I will extract the exact logic for DC1
const mathStr = `
const timeToFloor = 29793.8;
const P_tick_log10 = 51.767;
const P_new_log10 = 51.767 + Math.log10(3);
const t_floor_after = (308 - P_new_log10) / Math.log10(1.02);
const t_wait = 0;
const total_time_if_buy = t_wait + t_floor_after;
const time_saved = timeToFloor - total_time_if_buy;
const efficiencyDelta = timeToFloor > 0 ? (time_saved / timeToFloor) * 100 : 0;
console.log("time_saved:", time_saved);
console.log("efficiencyDelta:", efficiencyDelta);
`;
eval(mathStr);
