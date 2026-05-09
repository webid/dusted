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

- **Time to Floor (e308):** Real-time countdown tracking exactly how many active ticks remain until you hit the crystallization threshold, derived using the game's native $1.02^t$ natural growth acceleration.
- **Efficiency $\Delta$ (%):** The backbone of the HUD. Evaluates every single condenser and Temporal Compression based on its raw multiplier impact versus the time ($t_{wait}$) it takes to afford it. 
  - **<span style="color:#00ff00;">Green</span>**: Optimal purchase. Accelerates your run.
  - **<span style="color:#ff0000;">Red</span>**: Noob trap. Do not buy; waiting for it is actively slowing you down.
- **Path Simulation Engine:** Analyzes all Efficiency Deltas every second and highlights the single best tactical move to make next.
- **The Hard Exit Warning:** The moment you cross $e308$ Dust and $40,000,000$ Motes, the HUD immediately alarms you to crystallise.

## 🔧 File Structure

- `manifest.json`: Configuration for the Chrome Side Panel API.
- `content.js`: The MutationObserver and math simulation engine running stealthily in the game's background.
- `sidepanel.js` & `sidepanel.html`: The UI renderer for the Decision Support System.
- `styles.css`: The sleek, glassmorphic Cyberpunk styling.
- `break_infinity.js`: Natively ported from the game's source to ensure no numbers overflow `Infinity`.
