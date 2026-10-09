# Changelog

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
