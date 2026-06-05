# Dusted: Mote Upgrades Strategy Guide (Tiers 4 & 5)

This guide outlines the optimal purchase priority and economic strategies for **Tier 4 (Deep Accumulation)** and **Tier 5 (Ascendancy)** mote upgrades in *Dusted*. 

---

## 🌌 Baseline Stats & Mechanics

Before purchasing any Tier 4 upgrades (having completed Tiers 1–3), your global mote stats are:
*   **Mote Multiplier:** **`×4`** (from *Mote Prism* [ID 8] and *Mote Resonance I* [ID 14])
*   **Mote Divisor:** **`306`** (from *Break-Infinity I* [ID 13] and *Break-Infinity II* [ID 19])
*   **Mote Yield Formula:**
    $$\text{Motes} = 10^{\left(\frac{\log_{10}(\text{maxDust})}{\text{divisor}} - 0.75\right)} \times \text{multiplier}$$

> [!TIP]
> At this stage, a standard run to the $10^{308}$ crystallization floor yields **$\approx 7.22$ motes**, while a softcap push to $10^{405}$ yields **$\approx 15$ motes**. 
> Because Tier 4 upgrades cost up to $750$ motes, **optimizing your mote economy and run speed first** is the fastest path to late-game progression.

---

## ⚡ Tier 4 Upgrade Priorities

| Priority | Upgrade Name (ID) | Cost | Prereqs | Effect | Rationale |
| :---: | :--- | :---: | :---: | :--- | :--- |
| **1** | **Mote Resonance II** (25) | **`200`** | `19, 14` | `×4 motes on crystallise` | **The Economy Catalyst.** Your very first purchase. It has no Tier 4 prereqs and quadruples your mote yield instantly. Floor runs jump to **$\approx 28.8$ motes**, reducing the grind for all subsequent upgrades by **75%**. |
| **2** | **Purchase Synergy** (27) | **`300`** | `22, 24` | `all DC × (1 + purchases/100)` | **Run Velocity.** Multiplies the output of all Dimension Condensers (DCs). For a typical 500-purchase setup, this compounds to a massive boost across all 8 tiers of condensers, accelerating runs to the crystallization floor. |
| **3** | **Break-Infinity III** (26) | **`250`** | `19` | `mote formula ÷305` | **Progression Key.** The divisor decrease from $306 \to 305$ has negligible direct impact on its own, but this upgrade is **required** to unlock the ultimate Tier 4 upgrade, *Mote Resonance III*. |
| **4** | **Dimensional Surge** (30) | **`500`** | `22, 27` | `×256 all DC` | **Depth Expander.** Multiplies all DC production by `×256`. Since condensers compound down the chain, this compounds to $256^8 \approx 1.8 \times 10^{19}$ total acceleration! You will easily push to $10^{500}\text{--}10^{600}$ dust, boosting baseline floor yields to **$>250$ motes per run**. |
| **5** | **Mote Resonance III** (31) | **`600`** | `25, 26` | `×8 motes on crystallise` | **End-Game Setup.** Elevates your total mote multiplier to **`×128`** ($4 \times 4 \times 8$). Combined with deep runs from *Dimensional Surge*, you will pull in thousands of motes per run. |

### 🛠️ Low-Priority Tier 4 Clean-up
Buy these only after the core five are secured, before advancing to Tier 5:
*   **Temporal Cascade** (29) (Cost: `450` | Prereqs: `20, 22`): `each compression +×1.001 all DC`. Nice late-run scaling, but far weaker than the flat `×256` from *Dimensional Surge*.
*   **Fracture II** (28) (Cost: `400` | Prereqs: `16, 22`): `DC3 fractures into DC4 (10%)`. Solid utility, but secondary.
*   **Break-Infinity IV** (32) (Cost: `750` | Prereqs: `26`): `mote formula ÷304`. Buy this last to unlock Tier 5's pathway.

---

## ⏱️ Run Playstyle: Active Setup vs. Passive Growth

Dusted runs do not require continuous active play. Passive compounding handles the majority of your dust accumulation, but early setup yields massive returns.

### The 15-Minute Setup Rule
In compounding loops, early actions scale exponentially over time. 
* **Action Window:** Spend only the **first 10–15 minutes** of any run (including the short run) actively purchasing Dimension Condensers (DCs) and Temporal Compressions (TCs). 
* **Passive Cruising:** Once the wait time for the next recommended purchase exceeds a few minutes, you have hit your run's baseline velocity ($P_0$). Close the tab/game; passive compounding ($1.02\times$ pre-softcap, $1.02^{0.5}\times$ post-softcap) will run automatically.

### TC vs. DC Priorities
* **Temporal Compressions (TCs):** Early in a run, TCs are extremely cost-effective because their base multiplier scales linearly with your current mote count (e.g., $\times 428$ per purchase with $\approx 405$ motes).
* **Dimension Condensers (DCs):** Essential for building the chain-compounding pipeline.
* **HUD Recommendation:** Instead of guessing, check the Custom HUD (`content.js`). Buy whatever is displayed in the **`Target Acquisition`** recommendation (which dynamically simulates the exact tick-saving math of TC vs. DC) during your active setup window.

---

## 👑 Tier 5 Upgrade Priorities

Entering Tier 5, your baseline divisor is **`304`** and your multiplier is **`32`** (or **`128`** with T4 completely finished). The cost of upgrades jumps significantly, starting at $1,000$ and peaking at $5,000$ motes.

| Priority | Upgrade Name (ID) | Cost | Prereqs | Effect | Rationale |
| :---: | :--- | :---: | :---: | :--- | :--- |
| **1** | **Grand Supremacy** (34) | **`1250`** | `30, 28` | `×1024 all DC` | **Compounding Overlord.** A massive flat `×1024` to all DCs. Through the 8-tier chain, this compounding effect explodes your dust production velocity, allowing you to push 25+ orders of magnitude deeper in dust, resulting in massive base mote yields. |
| **2** | **Crystalline Memory** (35) | **`1500`** | `30, 31` | `all DC × (1 + purchases/50)` | **Speed Amplification.** Further doubles your purchase synergy multiplier across all DCs. Keeps run times extremely short as you save for the bigger upgrades. |
| **3** | **Break-Infinity V** (36) | **`2000`** | `32, 31` | `mote formula ÷303` | **Path to Glory.** Decreases the formula divisor to $303$. Necessary stepping stone to unlock *Mote Amplification*. |
| **4** | **Mote Amplification** (37) | **`2500`** | `31, 36` | `×16 motes on crystallise` | **The Economy King.** Multiplies all mote gains by another **`×16`**, skyrocketing your income. At this stage, you will be earning tens of thousands of motes per run. |
| **5** | **Void Preparation** (38) | **`3000`** | `34, 35` | `unlocks sacrifice` | **New Horizon.** Unlocks the vital "Sacrifice" mechanic, crucial for pushing past the limits of normal dust accumulation and entering true endgame progression. |
| **6** | **Ascendancy** (39) | **`5000`** | `34, 37, 38` | `×4096 all DC + ×32 motes` | **The Ultimate Pinnacle.** The final upgrade in the game. Provides a gigantic final multiplier to both your production speed and mote economy. |

### 🛠️ Low-Priority Tier 5 Clean-up
*   **Compression Singularity** (33) (Cost: `1000` | Prereqs: `29, 32`): `compression power ×3`. A strong multiplier for late-run push power, but you should buy it after *Grand Supremacy* has secured your raw production speeds.
