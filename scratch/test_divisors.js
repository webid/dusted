const Decimal = require('../break_infinity.js');

const estimateMotes = (maxDust, multiplier, divisor, constant) => {
  const dustDecimal = new Decimal(maxDust);
  if (dustDecimal.lt("1e308")) return new Decimal(0);
  const logDust = dustDecimal.log10();
  const exponent = (logDust - constant) / divisor;
  return Decimal.pow(10, exponent).times(multiplier);
};

const dust = "1.562e476";
const multiplier = 4;
const target = 25.601;

console.log("Dust:", dust);
console.log("Target motes:", target);

for (let c = 225; c <= 235; c += 0.1) {
  const est = estimateMotes(dust, multiplier, 306, c);
  const diff = est.toNumber() - target;
  if (Math.abs(diff) < 0.05) {
    console.log(`C: ${c.toFixed(2)}, Divisor 306: ${est.toNumber().toFixed(6)} (diff: ${diff.toFixed(6)})`);
  }
}
