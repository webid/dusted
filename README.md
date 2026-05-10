# Dust Protocol Intelligence HUD

A premium Manifest V3 Chrome Extension that transforms the game "Dust Protocol" on Etherlink Shadownet into a high-stakes strategy game. Instead of mindless automation, this extension injects a Decision Support System directly into a Chrome Side Panel. 

It parses scientific notation up to the $e308$ crystallization floor flawlessly using `break_infinity.js`, calculates real-time efficiency metrics, and simulates the optimal path forward.

## 🚀 Installation Guide (Local Browser)

Since this is a custom-built, unpackaged extension, you will load it into your browser using Developer Mode. Follow these steps:

1. **Open Extension Management:**
   Open Google Chrome (or any Chromium browser like Brave/Edge) and navigate to the Extensions page by typing this exactly into your URL bar:
   ```text
   chrome://extensions/
   ```

2. **Enable Developer Mode:**
   In the top-right corner of the Extensions page, toggle the switch that says **"Developer mode"** to ON.

3. **Load the HUD:**
   Click the **"Load unpacked"** button that appeared in the top-left corner.

4. **Select the Directory:**
   A file dialog will appear. Navigate to your workspace directory:
   `/Users/opeculiar/work/dusted`
   Select this `dusted` folder and click **Select**.

5. **Pin & Launch:**
   - Click the puzzle piece icon 🧩 in your Chrome toolbar and **pin** the "Dust Protocol Optimizer" extension.
   - Open the game in your browser.
   - Click the pinned extension icon. It will seamlessly slide out the Chrome Side Panel displaying the **Intelligence HUD**.

## 📊 HUD Features

- **Time to Floor (e308):** Softcap-aware countdown tracking exactly how many active ticks remain until you hit the crystallization threshold. Correctly splits the calculation across the softcap boundary — pre-softcap ticks compound at `1.02x`, post-softcap at `1.02^0.5 ≈ 1.00995x`.
- **Time Saved (%):** The backbone of the HUD. Evaluates every condenser and Temporal Compression based on its raw multiplier impact versus the time it takes to afford it.
  - **Green**: Optimal purchase. Accelerates your run.
  - **Red**: Noob trap. Waiting for it is actively slowing you down.
- **Recommendation Engine:** Analyzes all Time Saved deltas every second and highlights the single best tactical move to make next — with a clock icon and countdown or a checkmark for immediate purchases.
- **Chain Forecasting:** Below the primary recommendation, the engine simulates buying all affordable upgrades, then re-evaluates the best remaining target. If the chain path is faster, it shows a numbered two-step plan.
- **Hard Exit Warnings:**
  - **Target Reached:** When your projected total motes (current + pending) reach your configurable Target Motes, the HUD immediately alarms you to buy max DCs and crystallise.
  - **Softcap Hit:** When your active ticks cross the softcap threshold and growth is penalized, the HUD triggers the same critical alarm.
- **Temporal Telemetry:** Tracks ticks this run, active ticks, TC activation threshold, and softcap limit with a live progress bar and countdown.

## 🔧 File Structure

- `manifest.json`: Configuration for the Chrome Side Panel API.
- `content.js`: The DOM parser and strategy simulation engine running in the game tab.
- `sidepanel.js` & `sidepanel.html`: The UI renderer for the Decision Support System.
- `styles.css`: Sleek, glassmorphic Cyberpunk styling.
- `break_infinity.js`: Handles numbers beyond `Number.MAX_VALUE` for the game's exponential growth.
- `STRATEGY_ENGINE.md`: Knowledge base documenting game mechanics, formulas, and the development roadmap.
- `IMPLEMENTATION_PLAN.md`: Impact/effort analysis and detailed plans for future features.
