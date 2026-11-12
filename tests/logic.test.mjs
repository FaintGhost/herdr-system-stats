// Checks the sampler and the formatting the two mods share. No herdr-app
// needed: a mod is one file, so its functions are loaded by stripping the
// three imports and the default export, and the shell part is run for real on
// the system the test runs on.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const PURE = [
  "POSIX",
  "windowsScript",
  "osOf",
  "parseSample",
  "sampleWindow",
  "formatPercent",
  "formatReading",
  "meterCount",
  "byteScale",
];

async function load(name) {
  const file = new URL(`../mods/${name}/main.js`, import.meta.url);
  let source = await fs.readFile(file, "utf8");
  source = source.replace(/^import .*$/gm, "").replace("export default class", "class");
  source = `const View = class {};\n${source}\nexport { ${PURE.join(", ")} };`;
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

const strip = await load("sysstats");
const panel = await load("sysstats-panel");

// What Linux answers: two /proc/stat lines, /proc/meminfo in bytes, hostname,
// two mounts and a missing one.
const SAMPLE = [
  "O|Linux",
  "C|cpu  100 20 300 4000 500 0 60 7 0 0",
  "C|cpu  200 20 400 4400 500 0 60 7 0 0",
  "M|16777216000|8388608000",
  "H|box",
  "D|/|100 300 400",
  "D|/data|50 50 100",
  "D|/missing|!",
].join("\n");

// What macOS and Windows answer: a percentage instead of counters, and the
// Windows sampler's own line endings and drive letters.
const DIRECT = ["O|Darwin", "U|42.5", "M|17179869184|8589934592", "H|mac", "D|/|100 300 400"].join("\n");
const WINDOWS = ["O|Windows", "U|7", "M|20000000000|10000000000", "H|LAPTOP", "D|C:|100 300 400"].join("\r\n");

test("reads counters, memory, host and mounts", () => {
  const sample = strip.parseSample(SAMPLE);
  assert.equal(sample.os, "Linux");
  assert.equal(sample.host, "box");
  assert.equal(sample.mem.total, 16777216000);
  assert.equal(sample.mem.used, 8388608000);
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

test("a system that reports its own percentage is read as it comes", () => {
  for (const [text, os, cpu] of [
    [DIRECT, "Darwin", 42.5],
    [WINDOWS, "Windows", 7],
  ]) {
    const sample = strip.parseSample(text);
    assert.equal(sample.os, os);
    assert.equal(sample.cpu, cpu);
    assert.equal(sample.host, os === "Darwin" ? "mac" : "LAPTOP");
    assert.equal(sample.mem.percent, 50);
    assert.equal(sample.disks[0].percent, 25);
  }
});

test("bad input reads as unavailable instead of throwing", () => {
  assert.equal(strip.parseSample("").cpu, null);
  assert.equal(strip.parseSample("").mem, null);
  assert.deepEqual(strip.parseSample("M|0|0").mem, null);
  assert.deepEqual(strip.parseSample("D|/|10 20 30").disks[0].percent, 34); // ceil(10/30*100)
  assert.deepEqual(strip.parseSample("D|/|x y z").disks[0].error, "invalid");
  assert.equal(strip.parseSample("U|notanumber").cpu, null);
  assert.equal(strip.parseSample("U|140").cpu, null);
  assert.equal(strip.osOf("C|cpu 1\nO|MINGW64_NT-10.0\n"), "MINGW64_NT-10.0");
  assert.equal(strip.osOf(""), "");
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

test("the panel names the window each system's CPU number covers", () => {
  assert.equal(strip.sampleWindow("Linux"), "250 ms 采样");
  assert.equal(strip.sampleWindow("Darwin"), "1 s 采样");
  assert.equal(strip.sampleWindow("Windows"), "WMI 计数");
  assert.equal(strip.sampleWindow(""), "250 ms 采样");
});

test("the two mods do not drift apart", () => {
  for (const name of PURE) {
    assert.equal(strip[name].toString(), panel[name].toString(), `${name} differs between the mods`);
  }
});

test("no line of the sampler leaves a shell string open", () => {
  // A raw newline inside a quoted awk/printf string is what breaks a sampler
  // somebody re-indented; every line must end with its quotes balanced.
  for (const line of strip.POSIX.split("\n")) {
    const quotes = line.split('"').length - 1;
    assert.equal(quotes % 2, 0, `unbalanced double quote: ${line}`);
  }
});

test("the PowerShell sampler carries no double quote and no ${", () => {
  // exec hands the script over as one argument: Windows quoting survives
  // anything, but single quotes keep it plain and `${` would be read by the
  // template literal instead of PowerShell.
  const script = strip.windowsScript(["/", "D:\\", "it's"]);
  assert.equal(script.includes('"'), false);
  assert.equal(script.includes("${"), false);
  assert.match(script, /'\/', 'D:\\', 'it''s'/);
});

test("the sampler runs on this machine", { skip: !["linux", "darwin"].includes(process.platform) }, () => {
  const output = execFileSync("sh", ["-c", strip.POSIX, "sh", "/"], { encoding: "utf8" });
  const sample = strip.parseSample(output);
  assert.equal(sample.os, process.platform === "darwin" ? "Darwin" : "Linux");
  assert.ok(sample.cpu === null || (sample.cpu >= 0 && sample.cpu <= 100), `cpu ${sample.cpu}`);
  assert.ok(sample.mem.percent > 0 && sample.mem.percent <= 100, `mem ${sample.mem.percent}`);
  assert.ok(sample.disks[0].percent >= 0 && sample.disks[0].percent <= 100);
  assert.match(sample.host, /\S/);
});

test("the Windows sampler runs on this machine", { skip: process.platform !== "win32" }, () => {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", strip.windowsScript(["/"])], {
    encoding: "utf8",
    timeout: 60000,
  });
  const sample = strip.parseSample(output);
  assert.equal(sample.os, "Windows");
  assert.ok(sample.cpu === null || (sample.cpu >= 0 && sample.cpu <= 100), `cpu ${sample.cpu}`);
  assert.ok(sample.mem.percent > 0 && sample.mem.percent <= 100, `mem ${sample.mem.percent}`);
  assert.ok(sample.disks[0].percent >= 0 && sample.disks[0].percent <= 100);
  assert.match(sample.host, /\S/);
});
