const P_tick_log10 = 51.767675;
const t_floor_before = (308 - P_tick_log10) / Math.log10(1.02);
console.log("t_floor_before:", t_floor_before);

const P_new_log10 = P_tick_log10 + Math.log10(3);
const t_floor_after = (308 - P_new_log10) / Math.log10(1.02);
console.log("t_floor_after:", t_floor_after);

const time_saved = t_floor_before - t_floor_after;
const efficiencyDelta = (time_saved / t_floor_before) * 100;
console.log("efficiencyDelta DC1:", efficiencyDelta);

const P_tc_new_log10 = P_tick_log10 * 1.058; // if it was exponent
console.log("tc exp efficiency:", (t_floor_before - (308 - P_tc_new_log10)/Math.log10(1.02)) / t_floor_before * 100);
