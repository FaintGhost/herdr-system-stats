# Herdr System Stats

[English](README.md) · [中文](README.zh-CN.md)

[![mods](https://github.com/FaintGhost/herdr-system-stats/actions/workflows/mods.yml/badge.svg)](https://github.com/FaintGhost/herdr-system-stats/actions/workflows/mods.yml)
[![release](https://img.shields.io/github/v/release/FaintGhost/herdr-system-stats?display_name=tag)](https://github.com/FaintGhost/herdr-system-stats/releases)

![CPU, memory and disk of a Mac in Herdr's details pane, and the same numbers in the status bar](docs/app.png)

CPU, memory and disk for Herdr: one line in the status bar, plus a details pane you can split beside
your terminals. It reports the machine the shown space lives on — Linux, macOS or Windows — with the
tools that machine already has.

- **Nothing to install where you watch.** Linux is read through `/proc` and `df`, macOS through
  `iostat`, `sysctl` and `vm_stat`, Windows through PowerShell and the WMI classes it ships with. No
  sudo, no daemon, no agent.
- **The numbers are the remote machine's.** A window on Windows reports a Linux server's CPU, memory
  and disk; a macOS space reports the Mac.
- **Click the strip** to switch between percentages and used/total.

## Requirements

- Herdr, which runs this as a mod — no compiler, no Go, nothing to build.
- Nothing on the machines you watch: every sampler is a shell one-liner over tools the system
  already ships.

## Install

A mod lives in Herdr's home: `%USERPROFILE%\.config\herdr-app` on Windows, `~/.config/herdr-app` on
macOS and Linux (the app's `.config`, not `AppData`). Copy the two folders into `mods`:

```
.config/herdr-app/
  mods/
    sysstats/        main.js  mod.json  jsconfig.json
    sysstats-panel/  main.js  mod.json  jsconfig.json
```

Easiest: download `herdr-system-stats-<version>.zip` from [Releases][releases] and unpack it into
`mods`.

From a checkout of this repository, on any of the three systems:

```sh
MODS="$HOME/.config/herdr-app/mods"      # Windows: %USERPROFILE%\.config\herdr-app\mods
mkdir -p "$MODS"
cp -r mods/sysstats mods/sysstats-panel "$MODS/"
```

Then let the app load them. Mods hot-reload, so no restart is needed:

```sh
herdr-app check "$MODS/sysstats"
herdr-app check "$MODS/sysstats-panel"
```

Both print `check passed: …`. A failure names the file and the line.

## Put it in the status bar

Herdr rewrites its shipped layouts on every start, so clone one first:

- in the app: `Ctrl+Shift+P` → **Duplicate layout** (gives you `main-copy`), or
- on the command line: `herdr-app do layout.clone --name main --as my-main`

Then edit `main-copy.json` (`my-main.json`) and replace the status bar near the end of the file:

```json
{ "id": "status", "type": "block", "size": { "px": 28 },
  "content": { "mod": "workspace-status" } }
```

with a row of two blocks:

```json
{ "id": "status", "type": "row", "size": { "px": 28 }, "children": [
    { "id": "status-bar",   "type": "block", "content": { "mod": "workspace-status" } },
    { "id": "status-stats", "type": "block", "size": { "px": 520 }, "content": { "mod": "sysstats" } } ] }
```

Save the file: the window follows within a second.

`520` fits percentages and one disk in used/total mode (`1.5/1.8 TiB`). Percentages alone fit in
about `430`; every extra disk adds a `DISK /data` group, so add roughly 90 per disk.

## The details pane

Split it like a terminal:

```sh
herdr-app do pane.split --direction right --mod sysstats-panel
```

Use `--flag` arguments on Windows: PowerShell 5.1 tends to eat the quotes of a JSON argument.

## Configure

Both mods take the same two props, on a block in the layout or on a split pane:

```json
{ "id": "status-stats", "type": "block", "size": { "px": 520 },
  "content": { "mod": "sysstats", "props": { "machine": "vps", "disks": ["/", "/data"] } } }
```

| prop | default | meaning |
|---|---|---|
| `machine` | the shown space's machine | a name from `hc machine ls`; pins the readings to that machine instead of following the space |
| `disks` | `["/"]` | mount points to report. On Windows a drive (`"C:"`, `"D:\\"`), where `"/"` means the system drive |

One click on the strip or the pane switches percentages ⇄ used/total; each mod remembers its own
choice.

## What it reads, per system

| | CPU | memory | disk |
|---|---|---|---|
| **Linux** | `/proc/stat`, two reads 250 ms apart | `/proc/meminfo` (`MemAvailable`) | `df -B1` |
| **macOS** | `iostat -c 2 -w 1`, user + system of the second sample (1 s) | `sysctl hw.memsize`, plus `free + inactive + speculative` pages from `vm_stat` | `df -k` |
| **Windows** | `Win32_PerfFormattedData_PerfOS_Processor` (`_Total`), the counter Windows keeps itself | `Win32_OperatingSystem` (`TotalVisibleMemorySize`, `FreePhysicalMemory`) | `Win32_LogicalDisk` (`Size`, `FreeSpace`) |

Two details that decide what a reading means:

- **A macOS disk is its APFS container.** `df /` lists the sealed system volume only — 13 GB on a
  clean Mac — so the sampler reports `total − available` as used, the number `diskutil apfs list`
  prints. A 256 GB Mac therefore reads `245.1 GB` / `228.3 GiB`, about 65 % used. Finder may show a
  little more *available* than `df` does, because macOS counts purgeable space as free.
- **A Windows disk is a drive.** `disks: ["C:", "D:"]`; the default `"/"` is the system drive, and
  the pane labels it with the real letter.

## How it works

A mod asks Herdr to run a command **on the machine the shown space lives on** —
`exec(..., { on: machine })`, which is `hc exec --on <machine>` — and renders the lines the command
prints. Three things follow from that design:

- The window needs no client on the remote side beyond what Herdr already connects with.
- Each machine is asked once which shell it speaks, and remembered: `sh` where it exists, PowerShell
  otherwise. A Windows that has Git's `sh` on `PATH` answers as MINGW and is sampled through
  PowerShell anyway, so a Windows space never reports a POSIX shell's idea of `/proc`.
- A sample is one exec: the sampler prints `O` (which system answered), `U` (a CPU percentage, where
  the system reports one), `C` (two `/proc/stat` counter lines), `M` (memory, bytes), `H` (host name)
  and `D` (a mount point). The parser takes whichever lines it finds, so the three samplers share one
  reader and one formatter.

A mod is a single file, because Herdr only promises `import "gpui-kit" | "gpui-base" | "herdr"`.
The sampling and formatting code is therefore duplicated between `sysstats` and `sysstats-panel`,
and `tests/logic.test.mjs` fails if the two copies drift apart.

## How it maps to the TUI plugin

This is the old TUI plugin `faintghost.system-stats`, rebuilt for the Herdr window (the Go
implementation is still in the history).

| TUI plugin | Here |
|---|---|
| `[ui].tab_bar_right` running `status` every 5 s | the `sysstats` mod, sampling every 5 s |
| the `watch` details pane (2 s) | the `sysstats-panel` mod, sampling every 2 s |
| red at ≥90, yellow at ≥75, green below | the theme's `ansi1` / `ansi3` / `ansi2` |
| four-cell `▰▱` meter | four rounded cells in the same colors |
| `prefix+u` toggles percent / used-total | click the strip |
| `--` / `○` when a reading is unavailable | the same |
| `pause` / `resume` actions | dropped: it only samples while shown |
| the `setup` pane (prints a config.toml snippet) | dropped: that one was for the TUI |

Wording follows the plugin: `整机资源`, `正常 / 偏高 / 高占用 / 不可用`, `已用 x / y`,
`可用 x / 总计 y`. The CPU caption names the window its number covers: `所有核心 · 250 ms 采样` on
Linux, `1 s 采样` on macOS, `WMI 计数` on Windows.

## Troubleshooting

- `herdr-app status` prints what the window shows and its `errors`; a mod's JavaScript errors land
  there.
- A strip that reads `system stats: …` is showing the `exec` error — machine unreachable, no shell,
  a timeout. While sampling fails the last numbers stay, dimmed.
- A slow first reading on Windows is normal: the first WMI call loads the performance archive (a few
  seconds). Later samples take about a second. A missing or policy-blocked PowerShell says so in the
  strip; the sampler needs nothing beyond `Get-CimInstance`.
- Suspect the numbers? The samplers are plain shell, so run them by hand:

  ```sh
  hc exec --on <machine> sh -c '<the POSIX sampler>' sh /
  hc exec --on <machine> powershell.exe -NoProfile -Command '<the Windows sampler>'
  ```

## Development

```sh
node --check mods/sysstats/main.js
node --check mods/sysstats-panel/main.js
node --test tests/*.test.mjs      # parser, formatting, both samplers; no herdr-app needed
herdr-app check mods/sysstats     # load and render once in the real app
```

The tests run the POSIX sampler for real on Linux and macOS, and the PowerShell sampler on Windows;
each is skipped where it does not apply.

Publishing is the same commands in CI: push a `v<version>` tag and `.github/workflows/release.yml`
re-runs the checks, packs `sysstats/` and `sysstats-panel/` into `herdr-system-stats-<version>.zip`
and creates the release, with that version's section of `CHANGELOG.md` as its notes. `gpui-kit.d.ts` is generated by the app for your editor and
is not committed.

## Uninstall

Delete `mods/sysstats` and `mods/sysstats-panel`, and take the two blocks out of your layout (or
switch back to `main` with `herdr-app do layout.switch --name main`).

## License

MIT, see [LICENSE](LICENSE).

[releases]: https://github.com/FaintGhost/herdr-system-stats/releases
