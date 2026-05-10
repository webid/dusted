# Dust Protocol Optimizer: Strategy & Knowledge Base

This document serves as the foundational knowledge base for the `Dusted` extension's strategy evaluation engine. It outlines the known game mechanics, mathematical formulas, current forecasting rules, and the roadmap for future development.

---

## 1. Core Game Mechanics & Multipliers

### Dust Compounding & Temporal Acceleration
*   **Base Growth:** Production velocity (`Dust/Tick` or `P_tick`) naturally compounds over time once the Temporal Compression threshold is crossed.
*   **Active Ticks:** The number of ticks you have spent *past* the activation threshold. 
*   **Speed Bonus:** Before hitting the softcap, the multiplier applied to production is `1.02 ^ activeTicks`.

### Temporal Compression (TC)
TC is the most complex and powerful mechanic in the game. Buying a TC does two things:
1.  **Base Multiplier:** It applies a permanent base multiplier to production. The mathematical base is `1.0583 * MotePower`.
2.  **Threshold Reduction:** It reduces the `TC Eff. Start` threshold by exactly **100 ticks**. 
    *   *Why this matters:* If you are currently active, lowering the threshold instantly grants you `100` extra Active Ticks. Since compounding is `1.02x` per tick, buying a TC instantly multiplies your production by `1.02 ^ 100` (which is **~7.24x**), *on top* of the base multiplier.

### Dust Condensers (DC)
Condensers provide massive, flat multipliers to `P_tick` upon purchase. The current known base multipliers are:
*   DC1: `3x`
*   DC2: `4x`
*   DC3: `5x`
*   DC4: `6x`
*   DC5: `8x`
*   DC6: `10x`
*   DC7: `12x`
*   DC8: `15x`

---

## 2. The Three Temporal Phases

The engine categorizes the current run into three distinct phases to determine its recommendations:

1.  **Pre-Active (`activeTicks === 0`):**
    *   You have not yet reached `TC Eff. Start`. 
    *   *Strategy:* Buying TCs here projects massive future value because it lowers the threshold, bringing the active phase (and its compounding) closer.
2.  **Active Compounding (`0 < activeTicks < softcap`):**
    *   The sweet spot. Production is exponentially growing by `1.02x` per tick. 
    *   *Strategy:* Prioritize highest `Time Saved` multipliers. Upgrades bought here have extreme leverage.
3.  **Softcap (`activeTicks >= softcap`):**
    *   The exponential growth is severely penalized. The multiplier exponent drops from `1.0` to `0.500`. 
    *   *Strategy:* The engine currently employs a **Hard Exit Rule**. If you hit the softcap, the recommendation immediately switches to `CRITICAL: SOFTCAP HIT! BUY MAX DC THEN CRYSTALLISE`.

---

## 3. Current Forecasting Rules & Best Practices

*   **The "Time Saved" Metric:** 
    The engine calculates the theoretical time required to reach the `e308` floor at your *current* `P_tick`. It then simulates the wait time required to afford an upgrade, calculates the new `P_tick` after the multiplier is applied, and finds the new time to floor. The difference is the `% Time Saved`.
*   **The "Instant Payback" Rule:**
    If an upgrade's cost is completely dwarfed by your current bank (e.g., you have massive Unclaimed Dust, so `t_wait === 0`), the engine immediately recommends `NOW`. Even if a condenser costs more than your `Dust/Tick`, if you have the bank for it, buying it instantly multiplies your production and pays for itself within a single tick.

---

## 4. Next Steps & Proposed Approaches (The Roadmap)

To evolve the engine from a "Floor Reacher" into a true **Post-e308 Mote Optimizer**, the following complex decisions need to be programmed.

### Next Step 1: Dynamic Post-e308 Crystallization Logic
Currently, the engine just says "Pushing to Target" once past `e308`. It needs a dynamic formula to answer the question: *"Should I keep grinding for the next Mote, or crystallize now and start fresh?"*

*   **What is needed:**
    1.  **Mote Cost Formula:** We need to parse or reverse-engineer the exact `Dust` requirement for the *next* sequential Mote.
    2.  **Distance Calculation:** Calculate `Dust Needed = (Next Mote Dust Requirement) - (Current Dust)`.
    3.  **Time-to-Mote vs. Time-to-Floor:** 
        *   Calculate how long it will take to reach the next Mote using current `P_tick`.
        *   Compare that against: `(Time to reach e308 from 0 dust on a fresh run using the new pending Mote power) + (Time to grind that specific Mote again)`.
    4.  **Actionable Output:** If pushing for the next Mote takes longer than an entire fresh run, recommend `CRYSTALLIZE EARLY`.

### Next Step 2: Accurate Softcap Forecasting
If the user is very close to the softcap, simulating a purchase that takes 1,000 ticks of waiting might cross the softcap boundary. The current forecast assumes linear exponential growth.

*   **Proposed Approach:**
    Update the `P_new_estimated` calculation in `evaluateStrategy()`. If `activeTicks + t_wait > softcap`, the mathematical forecast must branch. The ticks spent *before* the softcap calculate at `1.02x`, and the ticks spent *after* calculate using the `0.5` power modifier. This will prevent the engine from falsely recommending a long wait if the payoff occurs inside the "dead zone" of the softcap.

### Next Step 3: Multi-Step "Chain" Forecasting
The engine currently evaluates upgrades in a vacuum (e.g., "Wait for DC5"). It does not evaluate "Buy DC3 now to speed up the wait for DC5".

*   **Proposed Approach:**
    Implement a greedy simulation tree. 
    1. Check all upgrades that have `t_wait === 0`.
    2. Simulate buying the best one, updating `P_tick`.
    3. Re-evaluate the `t_wait` for the high-tier targets. 
    If the sequence `[Buy DC3 -> Wait -> Buy DC5]` yields a higher overall `Time Saved` than `[Wait -> Buy DC5]`, the engine will explicitly command the optimal sequence.
