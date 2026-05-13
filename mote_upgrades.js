var Ef = [{
  id: 0,
  tier: 1,
  cost: 1,
  prereqs: [],
  name: `Particle Lens`,
  effect: `×2 all DC`
}, {
  id: 1,
  tier: 1,
  cost: 1,
  prereqs: [],
  name: `Compression Insight`,
  effect: `compression power ×1.5`
}, {
  id: 2,
  tier: 1,
  cost: 2,
  prereqs: [0],
  name: `Dust Affinity`,
  effect: `base dust/tick ×3`
}, {
  id: 3,
  tier: 1,
  cost: 2,
  prereqs: [0],
  name: `DC1 Channeling`,
  effect: `×4 DC1`
}, {
  id: 4,
  tier: 1,
  cost: 3,
  prereqs: [0],
  name: `DC2 Resonance`,
  effect: `×4 DC2`
}, {
  id: 5,
  tier: 1,
  cost: 4,
  prereqs: [1],
  name: `Compression Surge`,
  effect: `compression power ×1.5`
}, {
  id: 6,
  tier: 2,
  cost: 6,
  prereqs: [2, 3],
  name: `Crystalline Echo`,
  effect: `×4 all DC`
}, {
  id: 7,
  tier: 2,
  cost: 8,
  prereqs: [4],
  name: `DC3 Amplifier`,
  effect: `×4 DC3`
}, {
  id: 8,
  tier: 2,
  cost: 10,
  prereqs: [3, 4],
  name: `Mote Prism`,
  effect: `×2 motes on crystallise`
}, {
  id: 9,
  tier: 2,
  cost: 12,
  prereqs: [6, 7],
  name: `Tier Harmony`,
  effect: `×4 DC1, DC3, DC5, DC7`
}, {
  id: 10,
  tier: 2,
  cost: 15,
  prereqs: [7],
  name: `DC4 Amplifier`,
  effect: `×4 DC4`
}, {
  id: 11,
  tier: 2,
  cost: 18,
  prereqs: [5],
  name: `Compression Flow`,
  effect: `compression power ×2`
}, {
  id: 12,
  tier: 2,
  cost: 20,
  prereqs: [6, 9],
  name: `Momentum`,
  effect: `×8 all DC`
}, {
  id: 13,
  tier: 2,
  cost: 25,
  prereqs: [12],
  name: `Break-Infinity I`,
  effect: `mote formula ÷307`
}, {
  id: 14,
  tier: 3,
  cost: 35,
  prereqs: [13],
  name: `Mote Resonance I`,
  effect: `×2 motes on crystallise`
}, {
  id: 15,
  tier: 3,
  cost: 40,
  prereqs: [10],
  name: `DC5 Amplifier`,
  effect: `×4 DC5`
}, {
  id: 16,
  tier: 3,
  cost: 50,
  prereqs: [8, 12],
  name: `Fracture I`,
  effect: `DC2 fractures into DC3 (10%)`
}, {
  id: 17,
  tier: 3,
  cost: 60,
  prereqs: [15],
  name: `DC6 Amplifier`,
  effect: `×4 DC6`
}, {
  id: 18,
  tier: 3,
  cost: 75,
  prereqs: [12, 11],
  name: `Grand Cascade`,
  effect: `×32 all DC`
}, {
  id: 19,
  tier: 3,
  cost: 80,
  prereqs: [13, 14],
  name: `Break-Infinity II`,
  effect: `mote formula ÷306`
}, {
  id: 20,
  tier: 3,
  cost: 100,
  prereqs: [11, 18],
  name: `Compression Mastery`,
  effect: `compression power ×2`
}, {
  id: 21,
  tier: 3,
  cost: 100,
  prereqs: [17],
  name: `DC7 Amplifier`,
  effect: `×4 DC7`
}, {
  id: 22,
  tier: 3,
  cost: 125,
  prereqs: [18, 20],
  name: `Temporal Echo`,
  effect: `×64 all DC`
}, {
  id: 23,
  tier: 3,
  cost: 150,
  prereqs: [21],
  name: `DC8 Amplifier`,
  effect: `×4 DC8`
}, {
  id: 24,
  tier: 3,
  cost: 175,
  prereqs: [23, 14],
  name: `Void Shimmer`,
  effect: `DC8 scales with motes^0.1`
}, {
  id: 25,
  tier: 4,
  cost: 200,
  prereqs: [19, 14],
  name: `Mote Resonance II`,
  effect: `×4 motes on crystallise`
}, {
  id: 26,
  tier: 4,
  cost: 250,
  prereqs: [19],
  name: `Break-Infinity III`,
  effect: `mote formula ÷305`
}, {
  id: 27,
  tier: 4,
  cost: 300,
  prereqs: [22, 24],
  name: `Purchase Synergy`,
  effect: `all DC × (1 + purchases/100)`
}, {
  id: 28,
  tier: 4,
  cost: 400,
  prereqs: [16, 22],
  name: `Fracture II`,
  effect: `DC3 fractures into DC4 (10%)`
}, {
  id: 29,
  tier: 4,
  cost: 450,
  prereqs: [20, 22],
  name: `Temporal Cascade`,
  effect: `each compression +×1.001 all DC`
}, {
  id: 30,
  tier: 4,
  cost: 500,
  prereqs: [22, 27],
  name: `Dimensional Surge`,
  effect: `×256 all DC`
}, {
  id: 31,
  tier: 4,
  cost: 600,
  prereqs: [25, 26],
  name: `Mote Resonance III`,
  effect: `×8 motes on crystallise`
}, {
  id: 32,
  tier: 4,
  cost: 750,
  prereqs: [26],
  name: `Break-Infinity IV`,
  effect: `mote formula ÷304`
}, {
  id: 33,
  tier: 5,
  cost: 1e3,
  prereqs: [29, 32],
  name: `Compression Singularity`,
  effect: `compression power ×3`
}, {
  id: 34,
  tier: 5,
  cost: 1250,
  prereqs: [30, 28],
  name: `Grand Supremacy`,
  effect: `×1024 all DC`
}, {
  id: 35,
  tier: 5,
  cost: 1500,
  prereqs: [30, 31],
  name: `Crystalline Memory`,
  effect: `all DC × (1 + purchases/50)`
}, {
  id: 36,
  tier: 5,
  cost: 2e3,
  prereqs: [32, 31],
  name: `Break-Infinity V`,
  effect: `mote formula ÷303`
}, {
  id: 37,
  tier: 5,
  cost: 2500,
  prereqs: [31, 36],
  name: `Mote Amplification`,
  effect: `×16 motes on crystallise`
}, {
  id: 38,
  tier: 5,
  cost: 3e3,
  prereqs: [34, 35],
  name: `Void Preparation`,
  effect: `unlocks sacrifice`
}, {
  id: 39,
  tier: 5,
  cost: 5e3,
  prereqs: [34, 37, 38],
  name: `Ascendancy`,
  effect: `×4096 all DC + ×32 motes`
}, {
  id: 40,
  tier: 1,
  cost: 0,
  prereqs: [5],
  name: `Harmonic Acquisition`,
  effect: `unlocks MAX ALL`
}, {
  id: 41,
  tier: 2,
  cost: 0,
  prereqs: [13],
  name: `Total Acquisition`,
  effect: `MAX ALL + compression`
}]
  , Df = [``, `first light`, `resonance`, `expansion`, `deep accumulation`, `ascendancy`]
  , Of = (e, t) => (e & 1n << BigInt(t)) != 0n
  , kf = `#ff40ff`
  , Af = `#bb00bb`
  , jf = `#5a7a90`;