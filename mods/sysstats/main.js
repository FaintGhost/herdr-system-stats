// System Stats for herdr-app: CPU, RAM and disk of a machine, in the status bar.
//
// This is the herdr-app mod replica of the herdr TUI plugin
// `faintghost.system-stats`: the same thresholds (75 % / 90 %), the same
// four-cell meter, the same percent / used-total display modes, the same
// "unavailable" reading. The details pane of the TUI plugin is the
// `sysstats-panel` mod.
//
// The window runs on your computer, the numbers come from the machine the
// space lives on: exec(..., { on: machine }) runs the sampler there. Linux,
// macOS and Windows are all sampled with what those systems ship: /proc,
// iostat + vm_stat, WMI through PowerShell.
//
// props: { machine?: "<hc machine name>", disks?: ["/", "/data"] }
//   machine   pin a machine instead of following the shown space
//   disks     mount points to report (default: ["/"]); on Windows a drive
//             ("C:", "D:\") and "/" means the system drive. With more than one
//             the path is shown next to DISK, as in the TUI plugin
//
// Click the strip to switch between percentages and used/total.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, props, spaces, theme } from "herdr";

// One sample: the plugin's tab-bar entry ran every 5 s, with a 250 ms window
// to turn /proc/stat counters into a CPU percentage. Windows answers its first
// WMI call slowly (a cold performance archive), so the timeout is roomy.
const INTERVAL = 5000;
const DISKS = ["/"];
const METER = 4;
const TIMEOUT = 15000;

// --- the sampler ------------------------------------------------------------

// One wire format for every system: O (which one answered), U (a CPU
// percentage the system reports directly), C (two /proc/stat counter lines),
// M (total and available memory in bytes), H (host name) and D (a mount point:
// used, available, size in bytes). Each sampler emits the lines its system can
// answer; the reader below takes whichever it finds.

// Linux and macOS: the POSIX shell and the tools both systems ship. /proc on
// Linux; iostat, sysctl and vm_stat on macOS; df for the mounts. No sudo,
// nothing to install, no daemon.
const POSIX = `os=$(uname -s)
printf 'O|%s\\n' "$os"
case "$os" in
  Darwin)
    printf 'U|%s\\n' "$(iostat -c 2 -w 1 | tail -n 1 | awk '{printf "%.2f", $(NF-5)+$(NF-4)}')"
    total=$(sysctl -n hw.memsize)
    page=$(sysctl -n hw.pagesize)
    vm_stat | awk -v ps="$page" -v total="$total" '
      /^Pages free:/ {free=$3}
      /^Pages inactive:/ {inactive=$3}
      /^Pages speculative:/ {speculative=$3}
      END {
        gsub(/\\./, "", free)
        gsub(/\\./, "", inactive)
        gsub(/\\./, "", speculative)
        printf "M|%.0f|%.0f\\n", total, (free+inactive+speculative)*ps
      }'
    printf 'H|%s\\n' "$(hostname)"
    # df on / reads the sealed system volume (13 GB there); what the disk holds
    # is the APFS container, as diskutil apfs list puts it: total less free.
    for p in "$@"; do
      line=$(df -k -- "$p" 2>/dev/null | tail -n 1)
      if [ -n "$line" ]; then
        printf 'D|%s|%s\\n' "$p" "$(printf '%s\\n' "$line" | awk '{printf "%.0f %.0f %.0f", ($2-$4)*1024, $4*1024, $2*1024}')"
      else
        printf 'D|%s|!\\n' "$p"
      fi
    done
    ;;
  *)
    cpu1=$(head -n 1 /proc/stat); sleep 0.25; cpu2=$(head -n 1 /proc/stat)
    printf 'C|%s\\nC|%s\\n' "$cpu1" "$cpu2"
    awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{printf "M|%.0f|%.0f\\n", t*1024, a*1024}' /proc/meminfo
    printf 'H|%s\\n' "$(uname -n)"
    for p in "$@"; do
      if line=$(df -B1 --output=used,avail,size -- "$p" 2>/dev/null | tail -n 1) && [ -n "$line" ]; then
        printf 'D|%s|%s\\n' "$p" "$line"
      else
        printf 'D|%s|!\\n' "$p"
      fi
    done
    ;;
esac`;

// Windows: PowerShell and the WMI classes Windows already has. The formatted
// performance class is a counter Windows keeps for itself (no sampling
// window), its logical disks answer the drives. No module, no service, nothing
// installed; the drive list is embedded because exec takes no environment.
function windowsScript(disks) {
  const list = disks.map((path) => `'${String(path).replace(/'/g, "''")}'`).join(", ");
  return `$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -eq '_Total' }).PercentProcessorTime
if (-not $cpu) { $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average }
'O|Windows'
'U|' + $cpu
'M|' + ($os.TotalVisibleMemorySize * 1024) + '|' + ($os.FreePhysicalMemory * 1024)
'H|' + $env:COMPUTERNAME
$disks = Get-CimInstance Win32_LogicalDisk
foreach ($p in @(${list})) {
  $id = if ($p -match '^([A-Za-z]):') { $matches[1].ToUpper() + ':' } else { $env:SystemDrive }
  $label = if ($p -match '^[A-Za-z]:') { $p } else { $id }
  $d = $disks | Where-Object { $_.DeviceID -eq $id } | Select-Object -First 1
  if ($d -and $d.Size -gt 0) { 'D|' + $label + '|' + ($d.Size - $d.FreeSpace) + ' ' + $d.FreeSpace + ' ' + $d.Size } else { 'D|' + $label + '|!' }
}
`;
}

// Which shell a machine speaks is asked once and then remembered: `sh` missing
// means Windows, and a `sh` that calls itself MINGW/CYGWIN/MSYS means a Windows
// with Git's shell on PATH. Every other machine keeps the POSIX sampler.
const windowsMachines = new Set();

const NO_SH = /cannot run sh|program not found/i;
const WINDOWS_SH = /^(MINGW|MSYS|CYGWIN|UCRT64|CLANG64|MINGW64)/i;

function osOf(text) {
  for (const line of String(text ?? "").split("\n")) {
    if (line.slice(0, 2) === "O|") return line.slice(2).trim();
  }
  return "";
}

async function sample(on, disks, timeout) {
  const key = on ?? "";
  if (!windowsMachines.has(key)) {
    let missing = false;
    let result = null;
    try {
      result = await exec("sh", ["-c", POSIX, "sh", ...disks], { on, timeout });
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!NO_SH.test(message)) throw error;
      missing = true;
    }
    if (!missing && !WINDOWS_SH.test(osOf(result?.stdout))) {
      if (result?.code === 0 && String(result.stdout ?? "").trim() !== "") return result.stdout;
      throw new Error(String(result?.stderr ?? "").trim().split("\n")[0] || "no sample");
    }
    windowsMachines.add(key);
  }
  const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript(disks)], {
    on,
    timeout,
  });
  if (result?.code === 0 && String(result.stdout ?? "").trim() !== "") return result.stdout;
  throw new Error(String(result?.stderr ?? "").trim().split("\n")[0] || "no sample");
}

// --- reading the sample -----------------------------------------------------

// The aggregate line of /proc/stat: user nice system idle iowait irq softirq steal.
function parseCounters(line) {
  const fields = String(line ?? "").trim().split(/\s+/);
  if (fields[0] !== "cpu" || fields.length < 5) return null;
  return fields.slice(1, 9).map(Number);
}

// Idle and iowait are both idle time, as in the plugin.
function cpuPercent(before, after) {
  if (!before || !after) return null;
  let total = 0;
  let idle = 0;
  for (let i = 0; i < before.length; i += 1) {
    const delta = after[i] - before[i];
    if (!(delta >= 0)) return null;
    total += delta;
    if (i === 3 || i === 4) idle += delta;
  }
  return total === 0 ? null : (100 * (total - idle)) / total;
}

function parseSample(text) {
  const sample = { os: "", cpu: null, mem: null, host: "", disks: [] };
  const counters = [];
  let direct = null;
  for (const line of String(text ?? "").split("\n")) {
    const field = line.split("|");
    if (field[0] === "O") {
      sample.os = String(field[1] ?? "").trim();
    } else if (field[0] === "U") {
      const percent = Number(String(field[1] ?? "").trim());
      if (percent >= 0 && percent <= 100) direct = percent;
    } else if (field[0] === "C") {
      counters.push(parseCounters(field[1]));
    } else if (field[0] === "M") {
      const total = Number(String(field[1] ?? "").trim());
      const available = Number(String(field[2] ?? "").trim());
      if (total > 0 && available >= 0 && available <= total) {
        const used = total - available;
        sample.mem = { used, total, percent: (100 * used) / total };
      }
    } else if (field[0] === "H") {
      sample.host = String(field[1] ?? "").trim();
    } else if (field[0] === "D") {
      const path = field[1] ?? "";
      if (field[2] === "!" || field[2] === undefined) {
        sample.disks.push({ path, percent: null, error: "unavailable" });
        continue;
      }
      const [used, free, total] = String(field[2]).trim().split(/\s+/).map(Number);
      if (!(used >= 0) || !(free >= 0) || !(total > 0)) {
        sample.disks.push({ path, percent: null, error: "invalid" });
        continue;
      }
      // df's capacity column: reserved blocks are not part of it, rounded up.
      const capacity = used + free;
      sample.disks.push({ path, used, free, total, percent: capacity === 0 ? null : Math.ceil((used * 100) / capacity) });
    }
  }
  // /proc gives two counter lines; macOS and Windows give the percentage itself.
  sample.cpu = counters.length >= 2 ? cpuPercent(counters[0], counters[1]) : direct;
  return sample;
}

// --- formatting, as in the plugin -------------------------------------------

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

function byteScale(value) {
  let scale = 1;
  let unit = 0;
  while (unit < UNITS.length - 1 && value / scale >= 1024) {
    scale *= 1024;
    unit += 1;
  }
  return [scale, UNITS[unit]];
}

function formatPercent(percent) {
  return percent === null || percent === undefined ? "--" : `${Math.round(percent)}%`;
}

function formatReading(percent, used, total, mode) {
  if (mode !== "used" || percent === null || percent === undefined) return formatPercent(percent);
  const [scale, unit] = byteScale(total);
  return `${(used / scale).toFixed(1)}/${(total / scale).toFixed(1)} ${unit}`;
}

function meterCount(percent, columns) {
  if (percent === null || percent === undefined) return 0;
  return Math.round((Math.min(100, Math.max(0, percent)) * columns) / 100);
}

// The window the CPU number covers, per system: a counter pair, a sampled
// interval, or a counter Windows keeps by itself.
function sampleWindow(os) {
  if (os === "Windows") return "WMI 计数";
  if (os === "Darwin") return "1 s 采样";
  return "250 ms 采样";
}

// --- the mod ----------------------------------------------------------------

export default class SysStats extends View {
  init(_props, cx) {
    this.sample = null;
    this.error = "";
    this.busy = false;
    this.key = "";
    this.mode = localStorage.getItem("sysstats.display") === "used" ? "used" : "percent";
    cx.timer.every(INTERVAL, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // Where the numbers come from: a pinned machine, else the shown space's.
  target() {
    return props()?.machine ?? spaces().find((space) => space.active)?.machine ?? null;
  }

  disks() {
    const configured = props()?.disks;
    return Array.isArray(configured) && configured.length > 0 ? configured : DISKS;
  }

  refresh(cx) {
    if (this.busy) return;
    const on = this.target();
    const disks = this.disks();
    this.key = `${on ?? ""}|${disks.join(",")}`;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        this.sample = parseSample(await sample(on, disks, TIMEOUT));
        this.error = "";
      } catch (error) {
        // Unreachable machine, no shell at all, a timeout.
        this.error = String(error?.message ?? error);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Green under 75 %, yellow from 75 %, red from 90 %; dim when unknown.
  level(t, percent) {
    if (percent === null || percent === undefined) return { color: t.dim, state: "不可用" };
    if (percent >= 90) return { color: t.ansi1, state: "高占用" };
    if (percent >= 75) return { color: t.ansi3, state: "偏高" };
    return { color: t.ansi2, state: "正常" };
  }

  metric(t, label, percent, reading) {
    const level = this.level(t, percent);
    const color = this.error ? t.dim : level.color;
    const filled = meterCount(percent, METER);
    const cells = [];
    for (let i = 0; i < METER; i += 1) {
      cells.push(div().w(4).h(8).rounded(1).bg(i < filled ? color : t.border));
    }
    return h_flex()
      .flex_none()
      .gap(5)
      .items_center()
      .child(div().size(7).flex_none().rounded(4).bg(color))
      .child(div().text_color(t.muted).child(label))
      .child(h_flex().flex_none().gap(1).items_center().children(cells))
      .child(div().text_color(color).child(reading));
  }

  render(cx) {
    const t = theme();
    // The shown space changed machine or disks: sample again without waiting.
    const key = `${this.target() ?? ""}|${this.disks().join(",")}`;
    if (key !== this.key && this.sample) {
      this.key = key;
      this.refresh(cx);
    }
    const sample = this.sample;
    // Metrics hug the right edge, the way the status bar's own label and the
    // palette hint do: a percentage-only strip is narrower than its block, and
    // the gap belongs on the left, not between the last reading and the window.
    const strip = h_flex()
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
      .justify_end()
      .text_size(11.8)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .cursor_pointer()
      .on_click((_event, cx) => {
        this.mode = this.mode === "used" ? "percent" : "used";
        localStorage.setItem("sysstats.display", this.mode);
        cx.notify();
      });

    if (!sample) {
      const note = this.error ? `system stats: ${this.error.slice(0, 60)}` : "system stats";
      return strip.child(div().text_color(t.dim).child(note));
    }

    const disks = sample.disks;
    const single = disks.length === 1;
    return strip.children([
      this.metric(t, "CPU", sample.cpu, formatPercent(sample.cpu)),
      this.metric(
        t,
        "RAM",
        sample.mem ? sample.mem.percent : null,
        sample.mem ? formatReading(sample.mem.percent, sample.mem.used, sample.mem.total, this.mode) : "--",
      ),
      ...disks.map((disk) =>
        this.metric(
          t,
          single ? "DISK" : `DISK ${disk.path}`,
          disk.percent,
          disk.percent === null
            ? "--"
            : formatReading(disk.percent, disk.used, disk.total, this.mode),
        ),
      ),
    ]);
  }
}
