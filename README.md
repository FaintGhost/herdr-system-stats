# Herdr System Stats

[![CI](https://github.com/FaintGhost/herdr-system-stats/actions/workflows/ci.yml/badge.svg)](https://github.com/FaintGhost/herdr-system-stats/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Whole-machine CPU, RAM and disk usage in [Herdr](https://herdr.dev), written in Go.**

[简体中文](README.zh-CN.md)

```text
🟢 CPU ▰▰▰▱  68%  🟢 RAM ▰▰▱▱  47%  🟡 DISK ▰▰▰▱  82%

🟢 CPU ▰▰▰▱  68%  🟢 RAM ▰▰▱▱ 11.0/23.4 GiB  🟡 DISK ▰▰▰▱ 115.1/147.2 GiB
```

Example readings above illustrate the two display modes. Press **Ctrl+B, then U** after adding the optional binding to switch RAM and disk between percentage and used/total. CPU stays a percentage; the gauges always show the usage ratio.

The top bar samples every five seconds using Herdr's native command entries. An optional live detail pane refreshes every two seconds with long gauges, available space and severity labels. No polling daemon, Python runtime, subprocess-based resource sampling, or automatic edits to your Herdr configuration.

## Requirements

| Requirement | Supported |
| --- | --- |
| Host OS | Linux; amd64 and arm64 builds checked in CI |
| Herdr | 0.9.3 or later |
| Build tools | Go 1.26+ and Git on the machine running the Herdr server |
| Runtime | One compiled binary; readable `/proc/stat` and `/proc/meminfo` |

Installation compiles the binary from source. The only Go dependency is `golang.org/x/text`, used for terminal cell widths; installation downloads the pinned module version. There are no pip packages, Node dependencies, or CGO requirements. macOS and Windows are not supported.

## Install

```sh
herdr plugin install FaintGhost/herdr-system-stats
```

Review Herdr's installation preview. The build command creates `bin/herdr-system-stats`; the plugin ID is **`faintghost.system-stats`**.

### Add the top bar

Open the setup pane:

```sh
herdr plugin pane open --plugin faintghost.system-stats --entrypoint setup
```

It prints a ready-to-copy TOML entry with the actual binary, config and state paths. Merge that entry into `tab_bar_right` under your existing `[ui]` table in the Herdr config path printed by setup. Preserve any existing status entries and do not add a second `[ui]` table. If the table does not exist, add it once. The generated command quotes paths safely, including spaces and apostrophes.

Setup also prints an optional `prefix+u` shortcut. Choose another unused key if U is already bound. Press Enter or Ctrl+C to close the setup pane, then reload:

```sh
herdr config check
herdr server reload-config
```

Use Herdr's **reload config** menu action if the current client's layout does not update. Nothing needs to restart. Linking or installing the plugin alone does not add the top-bar entry.

### Optional keyboard shortcut

Append this to the top level of `config.toml`, outside other array-of-table entries:

```toml
[[keys.command]]
key = "prefix+u"
type = "plugin_action"
command = "faintghost.system-stats.toggle-display"
description = "Toggle stats percentage / used-total"
```

After saving this binding, run `herdr config check`, then choose **reload config** from Herdr's menu to refresh the client's keybindings. A server-only reload does not activate a binding added to a separate client's local configuration.

With Herdr's default prefix, press Ctrl+B and release it, then press U. If you changed the prefix, use yours. The new value appears at the next refresh: within five seconds in the top bar and two seconds in an already-open monitor.

## Use

```sh
# Open the live detail pane; Ctrl+C closes it
herdr plugin pane open --plugin faintghost.system-stats --entrypoint monitor

# Change percentage / used-total, also available in the plugin action menu
herdr plugin action invoke faintghost.system-stats.toggle-display

# Hide / restore the top-bar reading
herdr plugin action invoke faintghost.system-stats.pause
herdr plugin action invoke faintghost.system-stats.resume
```

Default display mode is percentage. Display mode and pause state survive restarts, updates and reinstallations because they live in Herdr's plugin state directory, not the source checkout. Sessions that use the same state directory share these choices. Pausing hides the top-bar output at its next refresh; it does not close a detail pane or stop Herdr from invoking the configured command.

Top-bar readings start with green, yellow or red status markers at the same thresholds as the detail pane: below 75% is **正常** (normal), 75–89% is **偏高** (elevated), and 90% or more is **高占用** (high). An unavailable reading uses a neutral `○` and `--`. Numbers and gauges inherit Herdr's theme, so they follow its light/dark appearance without a separate plugin theme setting. Colored markers are Unicode emoji; their color rendering depends on your terminal and font. Herdr strips ANSI styling from command entries, so the plugin does not try to color the top-bar text with escape sequences.

The detail pane uses the terminal's green/yellow/red palette with numbers and text labels. `NO_COLOR` (including an empty value) or `TERM=dumb` suppresses both top-bar markers and detail colors. Redirected output never contains ANSI styles; `status` keeps its Unicode markers unless colors are disabled. The detail UI currently uses Chinese labels; CLI help and setup instructions are English.

## Choose disks

Locate the configuration directory:

```sh
herdr plugin config-dir faintghost.system-stats
```

Create **`config.json`** in that directory:

```json
{
  "disks": ["/", "/mnt/data"]
}
```

Configuration is optional; the default is `{"disks":["/"]}`. Paths must be absolute, and any path inside a filesystem selects that filesystem. Two paths on the same filesystem produce two readings; use one path per filesystem to avoid duplicates. Missing or unreadable paths display `--`, with an error in the detail pane.

A new top-bar invocation reads configuration again. Reopen an existing monitor to apply changed disk paths. Empty disk lists, relative paths, unknown fields and control characters are rejected with a useful error; a failed status command is cleared by Herdr rather than showing a stale reading.

The published version uses JSON for user configuration and TOML for the Herdr manifest. It does not read the earlier local Python prototype's `config.toml`.

## Standalone CLI

After building, the binary can run without Herdr:

```sh
./bin/herdr-system-stats status
./bin/herdr-system-stats once --display used
./bin/herdr-system-stats watch
./bin/herdr-system-stats once --json
./bin/herdr-system-stats --help
```

Flags follow the subcommand:

| Flag | Meaning |
| --- | --- |
| `--config PATH` | Optional JSON configuration file |
| `--state-dir DIR` | Directory holding persistent pause/display markers |
| `--display percent\|used` | Override the saved mode for this invocation |
| `--json` | Print one raw sample, even with `watch`; no styles or unit conversion |
| `--wait` | Keep `setup` open until Enter or Ctrl+C in a terminal |

In a plugin pane/action, paths come from `HERDR_PLUGIN_CONFIG_DIR` and `HERDR_PLUGIN_STATE_DIR`. Otherwise, they follow `$XDG_CONFIG_HOME/herdr/plugins/config/faintghost.system-stats/config.json` and `$XDG_STATE_HOME/herdr/plugins/faintghost.system-stats`, defaulting to `~/.config` and `~/.local/state`. The top-bar command printed by setup passes explicit paths so it shares the same saved choices as plugin actions.

## What the numbers mean

| Metric | Calculation and scope |
| --- | --- |
| CPU | All-core `/proc/stat` deltas over 250 ms, normalized to 0–100%. Idle and iowait are idle; guest time is not counted twice. Counter rollback or no advance produces `--`. |
| RAM | `MemTotal − MemAvailable`. Reclaimable cache is available, not treated as used memory. |
| Disk percentage | `ceil(used / (used + available) × 100)`, matching `df`'s `Use%` and excluding reserved blocks. |
| Disk used/total | Filesystem used bytes / full filesystem capacity; available bytes appear separately in details. Reserved blocks mean this fraction may differ from the displayed percentage. |
| Units | Binary units selected from capacity: KiB, MiB, GiB, etc. One GiB is 1024³ bytes. |

These are host-wide readings, not workspace/process attribution. CPU shows the 250 ms sampling window, not a rolling five-second average. Disk reports capacity, not I/O throughput. In containers, `/proc` may expose host totals; values are not normalized against cgroup limits.

JSON preserves raw bytes and percentages independently of display mode. Unavailable CPU or disk percentages are `null`. For an unreadable disk, byte fields are zero placeholders and must not be treated as measured capacity; check `percent` and `error` first.

## Remote machines and narrow terminals

Commands sample the machine running the Herdr server. For SSH setups, install the plugin and Go toolchain on that machine. Use the remote setup pane to obtain server paths and place the generated status entry in the client's presentation configuration; do not substitute local paths. Herdr's command entries execute on the server.

On narrow tab rows or Herdr's mobile layout, the native status area may yield to tabs or disappear. Open the detail pane to see readings there. It wraps by terminal cells and has been exercised at 32×24 and 80-column sizes, including Chinese paths and repeated long-to-short redraws. There is no automatic scroll/pagination for arbitrarily many disks or very short panes; open the monitor in a larger pane or use `once` output.

## Update or remove

Update a GitHub-managed installation by reinstalling:

```sh
herdr plugin install FaintGhost/herdr-system-stats
```

Config/state are retained. Rerun setup if the binary path changes. There is no separate `herdr plugin update` command.

Before removing the plugin, remove only its entry from `tab_bar_right` and its optional `[[keys.command]]` binding, then reload Herdr:

```sh
herdr config check
herdr server reload-config
herdr plugin uninstall faintghost.system-stats
```

Herdr does not automatically remove a manually configured command when you disable or uninstall a plugin. Use the plugin's `pause` action to hide its reading; remove the entry to stop scheduled invocations. A locally linked checkout is unregistered with `herdr plugin unlink faintghost.system-stats`. Config/state are retained by Herdr; delete them separately only if you want to discard your choices.

## Develop

```sh
git clone https://github.com/FaintGhost/herdr-system-stats.git
cd herdr-system-stats
go build -trimpath -ldflags='-s -w' -o bin/herdr-system-stats .
herdr plugin link "$PWD"

go test -race ./...
go vet ./...
```

`plugin link` does not run manifest build commands, so build first. A locally linked plugin cannot be overwritten by `plugin install`; unlink it first.

| File | Responsibility |
| --- | --- |
| `metrics_linux.go` | `/proc` CPU/RAM and Linux `statfs` sampling |
| `render.go` | Compact meters, detail layout and Unicode wrapping |
| `state.go` | Validated JSON configuration and locked state changes |
| `main.go`, `terminal_linux.go` | CLI, cancellation, terminal cleanup, sizing and setup |
| `herdr-plugin.toml` | Linux support, build command, actions and panes |

Tests cover guest/iowait accounting, counter anomalies, reclaimable RAM, reserved disk capacity, Unicode wrapping, durable/concurrent display toggles and configuration boundaries. CI runs the race detector and vet, then builds Linux amd64/arm64 binaries. The plugin reads OS counters, stores only its own markers and invokes no Herdr control API; Herdr owns scheduling and pane lifecycle.

## Marketplace and license

This public repository carries the `herdr-plugin` topic and a root manifest for [automatic marketplace discovery](https://herdr.dev/docs/marketplace/). The marketplace refreshes about every 30 minutes; a listing is community discovery, not Herdr review or endorsement.

[MIT](LICENSE). Bug reports and contributions: [GitHub Issues](https://github.com/FaintGhost/herdr-system-stats/issues).
