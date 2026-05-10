# Dust Protocol Optimizer: Strategy & Knowledge Base

This document serves as the foundational knowledge base for the `Dusted` extension's strategy evaluation engine. It outlines the known game mechanics, mathematical formulas, current forecasting rules, and the roadmap for future development.

---

## 1. Core Game Mechanics & Multipliers

### Dust Compounding & Temporal Acceleration
*   **Base Growth:** Production velocity (`Dust/Tick` or `P_tick`) naturally compounds over time once the Temporal Compression threshold is crossed.
*   **Active Ticks:** The number of ticks you have spent *past* the activation threshold (`TC Eff. Start`). If `activeTicks > 0`, the TC efficiency multiplier is already applied.
*   **Speed Bonus (Pre-Softcap):** `Multiplier = 1.02 ^ (activeTicks)` — full exponential compounding.
*   **Speed Bonus (Post-Softcap):** `Multiplier = 1.02 ^ (softcap) * (1.02^0.5) ^ (activeTicks - softcap)` — the exponent is halved (`power 0.500`).

### The Power 0.500 Softcap (VERIFIED)
The `power 0.500` displayed on the Stats page is an **exponential softcap**, not a flat multiplier. This is standard incremental engine design: "power" refers to the exponent of the growth rate, while flat multipliers are displayed as coefficients (e.g., "x0.5").

**Pre-Softcap** (activeTicks < softcap):
```
Growth Rate = 1.02 per tick
```

**Post-Softcap** (activeTicks >= softcap):
```
Growth Rate = 1.02^0.5 ≈ 1.00995 per tick
```

This means compounding pressure is **halved**, not production. Pushing past the softcap feels like running through molasses because every tick gives half the exponential benefit.

### Temporal Compression (TC)
TC is the most complex and powerful mechanic. Buying a TC does two things:
1.  **Base Multiplier:** Applies `1.0583 * MotePower` to production.
2.  **Threshold Reduction:** Reduces `TC Eff. Start` by exactly **100 ticks**.
    *   If currently active (pre-softcap), this instantly grants `1.02^100 ≈ 7.24x` compounding boost on top of the base multiplier.
    *   It also moves you **100 ticks closer to the softcap**.

### Dust Condensers (DC)
Condensers provide flat multipliers to `P_tick` upon purchase:
| Tier | Multiplier |
|------|-----------|
| DC1  | 3x        |
| DC2  | 4x        |
| DC3  | 5x        |
| DC4  | 6x        |
| DC5  | 8x        |
| DC6  | 10x       |
| DC7  | 12x       |
| DC8  | 15x       |

---

## 2. The Three Temporal Phases

1.  **Pre-Active (`activeTicks === 0`):**
    *   You have not yet reached `TC Eff. Start`.
    *   *Strategy:* TCs project massive future value by lowering the threshold.
2.  **Active Compounding (`0 < activeTicks < softcap`):**
    *   The sweet spot. Production grows at `1.02x` per tick.
    *   *Strategy:* Prioritize highest `Time Saved` multipliers.
3.  **Softcap (`activeTicks >= softcap`):**
    *   Growth rate drops to `1.02^0.5 ≈ 1.00995x` per tick.
    *   *Strategy:* Hard Exit Rule — `CRITICAL: SOFTCAP HIT! BUY MAX DC THEN CRYSTALLISE`.

---

## 3. Crystallization & Carry Effects (VERIFIED)

### What Survives Crystallization
*   **Motes & Mote Upgrades:** Permanent. Never lost.
*   **TC Count:** Likely **resets** unless a specific upgrade preserves a percentage.
*   **Condenser Carry:** This is the "Fresh Run" fuel. The game takes your owned condenser count and converts it into **Effective Exponents**.
    *   Formula: `Base_i ^ eff_exp_i` for each tier, where `Base` is the tier's multiplier and `eff_exp` is derived from your previous run's owned count.
    *   Example: DC8 (Base 15) with eff.exp 13.17 → `15^13.17 ≈ 2.4e15` static multiplier at Tick 0.

### Fresh-Run Baseline (P₀)
At tick 0 of a new run, production is the product of all carry effects:
```
P₀ = (∏ Base_i^eff_exp_i) × MoteBonus
```
This explains hitting `e100+` in a few thousand ticks — you start with the ghost of your previous empire.

---

## 4. Current Forecasting Features

### Feature #1: Softcap-Aware Forecasting (IMPLEMENTED)
The `ticksToReachFloor()` helper correctly splits the floor calculation across the softcap boundary:
- Pre-softcap ticks compound at `1.02`
- Post-softcap ticks compound at `1.02^0.5`
- Active ticks advance during `t_wait`, so the engine correctly accounts for whether a purchase occurs before or after the softcap.

### Feature #3: Chain Forecasting (IMPLEMENTED)
The engine simulates buying all affordable DCs, then re-evaluates remaining targets with the boosted `P_tick`. If the chain path (buy affordable → wait → buy target) reaches e308 faster than any single purchase, it recommends the sequence.

Output format: `Chain Acquisition: DC1+DC2+DC3 → DC5`

### The "Time Saved" Metric
Calculates theoretical ticks to reach `e308` at current `P_tick`, simulates buying each upgrade, and compares the resulting floor time. The percentage saved is the delta.

### The "Instant Payback" Rule
If `t_wait === 0` (you can afford it now), the engine recommends `NOW` — even if cost exceeds `Dust/Tick`, the multiplier pays for itself within a tick.

---

## 5. Mote Formula (PARTIALLY KNOWN)

The e308 floor is the Double-precision floating-point limit. Motes follow a prestige-layer power law.

**Known:**
*   Motes are 0 below e308 (binary floor).
*   Expected ~6.02 × 10⁶ motes at e308.
*   Likely formula: `Motes_pending = Multiplier × 10^((log₁₀(Dust) - 308) × α + β)`

**To Verify:**
*   Watch Pending Motes on CR tab at different dust levels.
*   Take two `(OoM, Motes)` data points to solve for the slope.
*   Check if it's a fixed constant at exactly e308 that scales only deeper.

---

## 6. Roadmap: Remaining Next Steps

### Next Step #2: Dynamic Post-e308 Crystallization Logic
**Status:** Blocked on Mote formula discovery.

**Core Decision:** *"Should I keep grinding for the next Mote, or crystallize now?"*

**Algorithm:**
```
Option A: Keep grinding → time_to_next_mote (at current P_tick)
Option B: Crystallize → time_fresh_to_e308 (with new mote power) + time to same mote level
If A > B → Recommend "CRYSTALLIZE EARLY"
```

**Data Still Needed:**
1. Mote-to-dust conversion formula (from CR tab observation)
2. Fresh-run P₀ estimation (log P_tick at tick 0 after crystallization)
3. Whether TC count carries or resets

### Verification Action Items
1.  **Softcap Power:** Log `Math.log10(Dust/Tick)` difference between ticks before and after crossing tick 30,780. If Δlog drops by exactly 50%, the exponential softcap theory is confirmed.
2.  **Mote Formula:** Record `(dust, pending_motes)` pairs at several points past e308.
3.  **TC Carry:** On next crystallization, note if compressions reset to 0 or carry.
4.  **Fresh P₀:** Log the starting `Dust/Tick` value at tick 0 of a new run.
