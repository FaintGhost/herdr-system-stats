# Changelog

## Unreleased

- Sample macOS and Windows as well, with what each system ships: `iostat`, `sysctl` and `vm_stat` on macOS, PowerShell and the WMI classes (`Win32_PerfFormattedData_PerfOS_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`) on Windows. Linux is unchanged (`/proc`, `df`).
- Ask a machine once which shell it speaks and remember it: `sh` when it answers, PowerShell when it does not, plus a MINGW/CYGWIN/MSYS answer from a Windows that has Git's shell on `PATH`. Windows no longer needs a space on another machine to be readable.
- Report the macOS disk as the APFS container (`total − available`), like `diskutil apfs list`: `df /` alone reads the sealed system volume and reported a 256 GB Mac as 14 % full.
- Send memory in bytes on the wire instead of KiB, so all three samplers share one format; macOS and Windows report their own CPU percentage (`U` line) while Linux keeps its `/proc/stat` counter pair.
- On Windows, `disks` takes drive letters (`"C:"`, `"D:\"`), the default `"/"` means the system drive, and the panel labels it with the real letter.
- The panel's CPU caption names the window its number covers: `250 ms 采样` on Linux, `1 s 采样` on macOS, `WMI 计数` on Windows.
- Tests cover the shared scripts, the direct-percentage and byte-based samples, and run the sampler for real on Linux, macOS or Windows; the Windows script is asserted to carry no double quote, so `exec` never has to escape it.

## 2.0.0 - 2026-11-12

- Port to herdr-app as two mods, written in JavaScript on gpui-kit: `sysstats` (one line in the status bar) and `sysstats-panel` (the details pane, split like a terminal).
- Sample the machine a space lives on through `exec(..., { on })`, that is `hc exec --on <machine>`, so a window on Windows or macOS reports a Linux server's CPU, memory and disk.
- Keep the TUI plugin's thresholds (red at 90, yellow at 75), four-cell meter, percent / used-total readings, multi-disk labels and Chinese captions; click the strip instead of `prefix+u`.
- Drop the pieces that only made sense in the TUI: the `pause` / `resume` actions (sampling only happens while shown), the setup pane and the tab-bar command.
- Remove the Go implementation, its tests, the plugin manifest and the Go CI from this repository; they stay in the history, and 1.1.0 was the last Go version.
- Add `node --test` coverage for the sampler, the parser and the two mods' shared formatting, plus a CI job that parses both mods and runs it.

## 1.1.0 - 2026-10-10

- Add green/yellow/red Unicode status markers to top-bar CPU, RAM and disk readings, using the detail pane's existing severity thresholds.
- Keep numbers and gauges in Herdr's native light/dark theme colors; color glyph rendering depends on terminal/font support.
- Honor `NO_COLOR` and `TERM=dumb` for top-bar markers while preserving plain readings and raw JSON output.

## 1.0.0

- Publish the Linux Go implementation of the Herdr System Stats plugin.
- Show CPU, RAM and filesystem capacity in Herdr's native status area and live detail pane.
- Persist percentage/used-total selection and pause state in Herdr's plugin state directory.
- Provide a setup pane that generates safely quoted configuration without editing user files.
- Add Unicode-aware wrapping, terminal cleanup, focused regression checks and Linux amd64/arm64 CI builds.
- Document installation, configuration, metric definitions, update and removal in English and Chinese.
