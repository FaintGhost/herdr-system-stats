// System Stats details for herdr-app: the `watch` pane of the herdr TUI plugin
// `faintghost.system-stats`, as a mod you can split beside your terminals.
//
// Same metrics, thresholds, meters and captions as the TUI details view; the
// status-bar strip is the `sysstats` mod.
//
// props: { machine?: "<hc machine name>", disks?: ["/", "/data"] }
//   machine   pin a machine instead of following the shown space
//   disks     mount points to report (default: ["/"])
//
// Click anywhere to switch between percentages and used/total. The TUI plugin
// refreshed every 2 s; this keeps that.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, props, spaces, theme } from "herdr";

const INTERVAL = 2000;
const DISKS = ["/"];
const METER = 24;

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

function parseCounters(line) {
  const fields = String(line ?? "").trim().split(/\s+/);
  if (fields[0] !== "cpu" || fields.length < 5) return null;
  return fields.slice(1, 9).map(Number);
}

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

function formatSize(value) {
  const [scale, unit] = byteScale(value);
  return `${(value / scale).toFixed(1)} ${unit}`;
}

function meterCount(percent, columns) {
  if (percent === null || percent === undefined) return 0;
  return Math.round((Math.min(100, Math.max(0, percent)) * columns) / 100);
}

function clock() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// --- the mod ----------------------------------------------------------------

export default class SysStatsPanel extends View {
  init(_props, cx) {
    this.sample = null;
    this.error = "";
    this.busy = false;
    this.key = "";
    this.mode = localStorage.getItem("sysstats-panel.display") === "used" ? "used" : "percent";
    cx.timer.every(INTERVAL, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

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
        const result = await exec("sh", ["-c", SCRIPT, "sh", ...disks], { on, timeout: 10000 });
        if (result?.code === 0 && typeof result.stdout === "string" && result.stdout.trim() !== "") {
          this.sample = parseSample(result.stdout);
          this.error = "";
        } else {
          this.error = String(result?.stderr ?? "").trim().split("\n")[0] || "no sample";
        }
      } catch (error) {
        this.error = String(error?.message ?? error);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  level(t, percent) {
    if (percent === null || percent === undefined) return { color: t.dim, state: "不可用" };
    if (percent >= 90) return { color: t.ansi1, state: "高占用" };
    if (percent >= 75) return { color: t.ansi3, state: "偏高" };
    return { color: t.ansi2, state: "正常" };
  }

  bar(t, percent) {
    const color = this.error ? t.dim : this.level(t, percent).color;
    const filled = meterCount(percent, METER);
    const cells = [];
    for (let i = 0; i < METER; i += 1) {
      cells.push(div().flex_1().h(6).rounded(1).bg(i < filled ? color : t.border));
    }
    return h_flex().size_full().gap(2).items_center().children(cells);
  }

  metric(t, label, percent, reading, caption) {
    const level = this.level(t, percent);
    const color = this.error ? t.dim : level.color;
    return v_flex()
      .gap(4)
      .pt(12)
      .child(
        h_flex().items_center().gap(10)
          .child(div().w(42).flex_none().text_color(t.muted).child(label))
          .child(div().flex_none().font_semibold().text_color(color).child(reading))
          .child(div().flex_1())
          .child(div().text_size(11.8).text_color(t.dim).child(level.state)),
      )
      .child(this.bar(t, percent))
      .child(div().text_size(11.8).text_color(t.dim).child(caption));
  }

  render(cx) {
    const t = theme();
    const key = `${this.target() ?? ""}|${this.disks().join(",")}`;
    if (key !== this.key && this.sample) {
      this.key = key;
      this.refresh(cx);
    }
    const sample = this.sample;
    const root = v_flex()
      .size_full()
      .p(16)
      .gap(2)
      .bg(t.surface)
      .text_size(13)
      .cursor_pointer()
      .on_click((_event, cx) => {
        this.mode = this.mode === "used" ? "percent" : "used";
        localStorage.setItem("sysstats-panel.display", this.mode);
        cx.notify();
      });

    if (!sample) {
      return root.child(div().font_semibold().child("整机资源"))
        .child(div().text_size(11.8).text_color(t.dim).child(this.error || "正在采样…"));
    }

    const children = [
      div().font_semibold().child("整机资源"),
      div().text_size(11.8).text_color(t.dim).child(`${sample.host || "本机"} · ${clock()}`),
      this.metric(t, "CPU", sample.cpu, formatPercent(sample.cpu), "所有核心 · 250 ms 采样"),
    ];

    if (sample.mem) {
      const caption =
        this.mode === "used"
          ? `可用 ${formatSize(sample.mem.total - Math.min(sample.mem.total, sample.mem.used))}`
          : `已用 ${formatSize(sample.mem.used)} / ${formatSize(sample.mem.total)}`;
      children.push(
        this.metric(
          t,
          "RAM",
          sample.mem.percent,
          formatReading(sample.mem.percent, sample.mem.used, sample.mem.total, this.mode),
          caption,
        ),
      );
    } else {
      children.push(this.metric(t, "RAM", null, "--", "内存计数不可读"));
    }

    for (const disk of sample.disks) {
      const caption =
        disk.percent === null
          ? `${disk.path} · ${disk.error === "invalid" ? "文件系统容量为零" : "不可用"}`
          : this.mode === "used"
            ? `${disk.path} · 可用 ${formatSize(disk.free)}`
            : `${disk.path} · 可用 ${formatSize(disk.free)} / 总计 ${formatSize(disk.total)}`;
      children.push(
        this.metric(
          t,
          sample.disks.length > 1 ? `DISK ${disk.path}` : "DISK",
          disk.percent,
          disk.percent === null ? "--" : formatReading(disk.percent, disk.used, disk.total, this.mode),
          caption,
        ),
      );
    }

    return root.children(children);
  }
}
