// Checks the sampler and the formatting the two mods share. No herdr-app
// needed: a mod is one file, so its functions are loaded by stripping the
// three imports and the default export, and the shell part is run for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const PURE = ["SCRIPT", "parseSample", "formatPercent", "formatReading", "meterCount", "byteScale"];

async function load(name) {
  const file = new URL(`../mods/${name}/main.js`, import.meta.url);
  let source = await fs.readFile(file, "utf8");
  source = source.replace(/^import .*$/gm, "").replace("export default class", "class");
  source = `const View = class {};\n${source}\nexport { ${PURE.join(", ")} };`;
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

const strip = await load("sysstats");
const panel = await load("sysstats-panel");

// Two /proc/stat lines, /proc/meminfo, hostname, two mounts and a missing one.
const SAMPLE = [
  "C|cpu  100 20 300 4000 500 0 60 7 0 0",
  "C|cpu  200 20 400 4400 500 0 60 7 0 0",
  "M|16384000|8192000",
  "H|box",
  "D|/|100 300 400",
  "D|/data|50 50 100",
  "D|/missing|!",
].join("\n");

test("reads counters, memory, host and mounts", () => {
  const sample = strip.parseSample(SAMPLE);
  assert.equal(sample.host, "box");
  assert.equal(sample.mem.total, 16384000 * 1024);
  assert.equal(sample.mem.used, (16384000 - 8192000) * 1024);
  assert.equal(sample.mem.percent, 50);
  assert.equal(sample.disks.length, 3);
  assert.deepEqual(
    { path: sample.disks[0].path, used: sample.disks[0].used, free: sample.disks[0].free, total: sample.disks[0].total },
    { path: "/", used: 100, free: 300, total: 400 },
  );
  assert.equal(sample.disks[0].percent, 25); // ceil(100 / 400 * 100)
  assert.equal(sample.disks[1].percent, 50);
  assert.deepEqual(sample.disks[2], { path: "/missing", percent: null, error: "unavailable" });
});

test("cpu is busy time over total time, idle and iowait both idle", () => {
  // deltas: user 100, nice 0, system 100, idle 400, iowait 0, irq 0, softirq 0, steal 0
  const sample = strip.parseSample(SAMPLE);
  assert.equal(Number(sample.cpu.toFixed(6)), Number((100 * (600 - 400) / 600).toFixed(6)));
});

test("bad input reads as unavailable instead of throwing", () => {
  assert.equal(strip.parseSample("").cpu, null);
  assert.equal(strip.parseSample("").mem, null);
  assert.deepEqual(strip.parseSample("M|0|0").mem, null);
  assert.deepEqual(strip.parseSample("D|/|10 20 30").disks[0].percent, 34); // ceil(10/30*100)
  assert.deepEqual(strip.parseSample("D|/|x y z").disks[0].error, "invalid");
});

test("readings and meters match the TUI plugin", () => {
  assert.equal(strip.formatPercent(33.4), "33%");
  assert.equal(strip.formatPercent(null), "--");
  assert.equal(strip.formatReading(50, 8388608000, 16777216000, "percent"), "50%");
  assert.equal(strip.formatReading(50, 8388608000, 16777216000, "used"), "7.8/15.6 GiB");
  assert.deepEqual(strip.byteScale(512), [1, "B"]);
  assert.deepEqual(strip.byteScale(158097154048), [1073741824, "GiB"]);
  assert.deepEqual([0, 25, 50, 75, 100, null, -5, 150].map((v) => strip.meterCount(v, 4)), [0, 1, 2, 3, 4, 0, 0, 4]);
});

test("the two mods do not drift apart", () => {
  for (const name of PURE) {
    assert.equal(strip[name].toString(), panel[name].toString(), `${name} differs between the mods`);
  }
});

test("no line of the sampler leaves a shell string open", () => {
  // A raw newline inside a quoted awk/printf string is what breaks a sampler
  // somebody re-indented; every line must end with its quotes balanced.
  for (const line of strip.SCRIPT.split("\n")) {
    const quotes = line.split('"').length - 1;
    assert.equal(quotes % 2, 0, `unbalanced double quote: ${line}`);
  }
});

test("the sampler runs on this machine", { skip: process.platform !== "linux" }, () => {
  const output = execFileSync("sh", ["-c", strip.SCRIPT, "sh", "/"], { encoding: "utf8" });
  const sample = strip.parseSample(output);
  assert.ok(sample.cpu === null || (sample.cpu >= 0 && sample.cpu <= 100), `cpu ${sample.cpu}`);
  assert.ok(sample.mem.percent > 0 && sample.mem.percent <= 100, `mem ${sample.mem.percent}`);
  assert.ok(sample.disks[0].percent >= 0 && sample.disks[0].percent <= 100);
  assert.match(sample.host, /\S/);
});
