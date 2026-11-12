// System Stats for herdr-app: CPU, RAM and disk of a machine, in the status bar.
//
// This is the herdr-app mod replica of the herdr TUI plugin
// `faintghost.system-stats`: the same thresholds (75 % / 90 %), the same
// four-cell meter, the same percent / used-total display modes, the same
// "unavailable" reading. The details pane of the TUI plugin is the
// `sysstats-panel` mod.
//
// The window runs on your computer, the numbers come from the machine the
// space lives on: exec(..., { on: machine }) runs the sampler there.
//
// props: { machine?: "<hc machine name>", disks?: ["/", "/data"] }
//   machine   pin a machine instead of following the shown space
//   disks     mount points to report (default: ["/"]); with more than one the
//             path is shown next to DISK, as in the TUI plugin
//
// Click the strip to switch between percentages and used/total.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, props, spaces, theme } from "herdr";

// One sample: the plugin's tab-bar entry ran every 5 s, with a 250 ms window
// to turn /proc/stat counters into a CPU percentage.
const INTERVAL = 5000;
const DISKS = ["/"];
const METER = 4;

// Runs on the machine the space lives on (Linux): counters, memory, mounts.
const SCRIPT = `cpu1=$(head -n1 /proc/stat); sleep 0.25; cpu2=$(head -n1 /proc/stat)
printf 'C|%s\\nC|%s\\n' "$cpu1" "$cpu2"
awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{printf "M|%s|%s\\n", t, a}' /proc/meminfo
printf 'H|%s\\n' "$(cat /proc/sys/kernel/hostname 2>/dev/null)"
for p in "$@"; do
  if line=$(df -B1 --output=used,avail,size -- "$p" 2>/dev/null | tail -n1) && [ -n "$line" ]; then
    printf 'D|%s|%s\\n' "$p" "$line"
  else
    printf 'D|%s|!\\n' "$p"
  fi
done`;

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
  const sample = { cpu: null, mem: null, host: "", disks: [] };
  const counters = [];
  for (const line of String(text ?? "").split("\n")) {
    const field = line.split("|");
    if (field[0] === "C") {
      counters.push(parseCounters(field[1]));
    } else if (field[0] === "M") {
      const totalKb = Number(field[1]);
      const availableKb = Number(field[2]);
      if (totalKb > 0 && availableKb >= 0 && availableKb <= totalKb) {
        const total = totalKb * 1024;
        const used = (totalKb - availableKb) * 1024;
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
  sample.cpu = counters.length >= 2 ? cpuPercent(counters[0], counters[1]) : null;
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
    const key = `${on ?? ""}|${disks.join(",")}`;
    this.key = key;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const result = await exec("sh", ["-c", SCRIPT, "sh", ...disks], { on, timeout: 10000 });
        if (result?.code === 0 && typeof result.stdout === "string" && result.stdout.trim() !== "") {
          this.sample = parseSample(result.stdout);
          this.error = "";
        } else {
          this.error = String(result?.stderr ?? "").trim().split("\n")[0] || "no sample";
        }
      } catch (error) {
        // Unreachable machine, a machine without sh, a timeout.
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
    const strip = h_flex()
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
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
