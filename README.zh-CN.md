# Herdr System Stats

[English](README.md) · 中文

[![mods](https://github.com/FaintGhost/herdr-system-stats/actions/workflows/mods.yml/badge.svg)](https://github.com/FaintGhost/herdr-system-stats/actions/workflows/mods.yml)
[![release](https://img.shields.io/github/v/release/FaintGhost/herdr-system-stats?display_name=tag)](https://github.com/FaintGhost/herdr-system-stats/releases)

![Herdr 详情面板里的 CPU / 内存 / 磁盘，以及状态栏里同样的数字](docs/app.png)

Herdr 的 CPU / 内存 / 磁盘显示：状态栏一行，外加一个可以 split 在终端旁边的详情面板。报的是**当前
space 所在那台机器**——Linux、macOS 或 Windows——用的是那台系统本来就有的工具。

- **被看的机器上什么都不用装。** Linux 读 `/proc` 和 `df`，macOS 用 `iostat`、`sysctl`、`vm_stat`，
  Windows 用自带的 PowerShell 和 WMI 类。不要 sudo、不要守护进程、不要 agent。
- **数字是远端那台机器的。** Windows 上的窗口照样报 Linux 服务器的 CPU / 内存 / 磁盘，macOS 的
  space 就报那台 Mac。
- **点一下统计条**在百分比和已用/总计之间切换。

## 需要

- Herdr，它把这份代码当 mod 跑——不用编译器、不用 Go、不用构建。
- 被看的机器上不需要任何东西：每个采样都是一行 shell，用的都是系统自带的命令。

## 安装

mod 放在 Herdr 的家目录里：Windows 是 `%USERPROFILE%\.config\herdr-app`，macOS / Linux 是
`~/.config/herdr-app`（是 app 的 `.config`，不是 `AppData`）。把两个文件夹拷进 `mods`：

```
.config/herdr-app/
  mods/
    sysstats/        main.js  mod.json  jsconfig.json
    sysstats-panel/  main.js  mod.json  jsconfig.json
```

最省事：从 [Releases][releases] 下载 `herdr-system-stats-<version>.zip`，解压到 `mods` 里。

从本仓库的 checkout 安装，三个系统都是同一套：

```sh
MODS="$HOME/.config/herdr-app/mods"      # Windows: %USERPROFILE%\.config\herdr-app\mods
mkdir -p "$MODS"
cp -r mods/sysstats mods/sysstats-panel "$MODS/"
```

然后让 app 加载一次。mod 是热重载的，不用重启：

```sh
herdr-app check "$MODS/sysstats"
herdr-app check "$MODS/sysstats-panel"
```

两条都打印 `check passed: …` 就是好的；失败会指出文件和行号。

## 放进状态栏

Herdr 每次启动都会重写自带布局，所以先克隆一个：

- 在 app 里：`Ctrl+Shift+P` → **Duplicate layout**（得到 `main-copy`），或者
- 命令行：`herdr-app do layout.clone --name main --as my-main`

然后编辑 `main-copy.json`（`my-main.json`），把文件末尾附近的状态栏：

```json
{ "id": "status", "type": "block", "size": { "px": 28 },
  "content": { "mod": "workspace-status" } }
```

换成一行两块：

```json
{ "id": "status", "type": "row", "size": { "px": 28 }, "children": [
    { "id": "status-bar",   "type": "block", "content": { "mod": "workspace-status" } },
    { "id": "status-stats", "type": "block", "size": { "px": 520 }, "content": { "mod": "sysstats" } } ] }
```

存盘，窗口一秒内跟上。

`520` 够放百分比加一块磁盘的已用/总计（`1.5/1.8 TiB`）。只要百分比的话 `430` 左右就行；每多一块
磁盘会多一组 `DISK /data`，大概再加 90。

## 详情面板

像终端一样 split 出来：

```sh
herdr-app do pane.split --direction right --mod sysstats-panel
```

Windows 上用 `--flag` 形式的参数：PowerShell 5.1 容易把 JSON 参数的引号吃掉。

## 配置

两个 mod 都认同样两个 props，写在布局的块上，或者写在 split 出来的 pane 上：

```json
{ "id": "status-stats", "type": "block", "size": { "px": 520 },
  "content": { "mod": "sysstats", "props": { "machine": "vps", "disks": ["/", "/data"] } } }
```

| prop | 默认 | 含义 |
|---|---|---|
| `machine` | 当前 space 所在的机器 | `hc machine ls` 里的名字；填了就固定看这台，不再跟随 space |
| `disks` | `["/"]` | 要报的挂载点。Windows 上写盘符（`"C:"`、`"D:\\"`），`"/"` 表示系统盘 |

点统计条或点面板，切换百分比 ⇄ 已用/总计；两个 mod 各记各的选择。

## 各平台读的是什么

| | CPU | 内存 | 磁盘 |
|---|---|---|---|
| **Linux** | `/proc/stat`，隔 250 ms 读两次 | `/proc/meminfo`（`MemAvailable`） | `df -B1` |
| **macOS** | `iostat -c 2 -w 1`，取第二个样本的 user + system（1 秒） | `sysctl hw.memsize`，加上 `vm_stat` 的 `free + inactive + speculative` 页 | `df -k` |
| **Windows** | `Win32_PerfFormattedData_PerfOS_Processor`（`_Total`），Windows 自己维护的计数器 | `Win32_OperatingSystem`（`TotalVisibleMemorySize`、`FreePhysicalMemory`） | `Win32_LogicalDisk`（`Size`、`FreeSpace`） |

两个决定读数含义的细节：

- **macOS 的磁盘是整个 APFS 容器。** `df /` 只列那个密封的系统卷——干净系统上就 13 GB——所以采样
  用 `总量 − 可用` 当已用，和 `diskutil apfs list` 的数一致。256 GB 的 Mac 因此读作
  `245.1 GB` / `228.3 GiB`，已用约 65%。Finder 显示的“可用”可能比 `df` 多一点，因为 macOS 把
  purgeable 空间也算成可用。
- **Windows 的磁盘是盘符。** `disks: ["C:", "D:"]`；默认的 `"/"` 指系统盘，面板上标真实盘符。

## 它怎么工作

mod 让 Herdr 在**当前 space 所在的那台机器**上跑一条命令——`exec(..., { on: machine })`，也就是
`hc exec --on <machine>`——然后把命令打印的行画出来。这个设计带来三件事：

- 远端除了 Herdr 已经在用的那条连接，不需要任何客户端。
- 每台机器只会被问一次“你说哪种 shell”，之后记住：有 `sh` 用 `sh`，没有用 PowerShell。PATH 里带
  了 Git `sh` 的 Windows 会自称 MINGW，照样走 PowerShell，所以 Windows 的 space 不会被 POSIX shell
  骗出假的 `/proc`。
- 一次采样就是一次 exec：采样脚本打印 `O`（哪套系统应答的）、`U`（系统直接给的 CPU 百分比）、`C`
  （两行 `/proc/stat` 计数器）、`M`（内存，字节）、`H`（主机名）、`D`（一个挂载点）。解析器拿到哪
  几行就用哪几行，于是三套采样共用同一个解析和同一套格式化。

一个 mod 就是一个文件，因为 Herdr 只保证 `import "gpui-kit" | "gpui-base" | "herdr"`。所以采样和
格式化的代码在 `sysstats` 和 `sysstats-panel` 里各有一份，`tests/logic.test.mjs` 会在两份漂移时
失败。

## 和 TUI 插件对应

这是旧 TUI 插件 `faintghost.system-stats` 的复刻（Go 实现还在历史里）。

| 旧 TUI 插件 | 现在 |
|---|---|
| `[ui].tab_bar_right` 里每 5 秒跑 `status` | `sysstats` mod，5 秒采样 |
| `watch` 详情面板（2 秒刷新） | `sysstats-panel` mod，2 秒采样 |
| ≥90 红 / ≥75 黄 / 其余绿 | 主题的 `ansi1` / `ansi3` / `ansi2` |
| 4 格 `▰▱` 计量条 | 4 个圆角小块，颜色同上 |
| `prefix+u` 切百分比 / 已用总计 | 点一下那一条 |
| 读数不可用显示 `--` / `○` | 一样 |
| `pause` / `resume` 动作 | 没搬：可见才采样，暂停没意义 |
| `setup` 面板（打印 config.toml 片段） | 没搬：那是写给 TUI 的 |

文案沿用插件：`整机资源`、`正常 / 偏高 / 高占用 / 不可用`、`已用 x / y`、`可用 x / 总计 y`。
CPU 那句话说的是数字覆盖的窗口：Linux 是 `所有核心 · 250 ms 采样`，macOS 是 `1 s 采样`，
Windows 是 `WMI 计数`。

## 出问题

- `herdr-app status` 会打印窗口状态和 `errors`，mod 的 JS 报错在那里。
- 统计条显示 `system stats: …`：那是 `exec` 的报错——机器不可达、没有 shell、超时。采集中断时保留
  上一次读数，整行变暗。
- Windows 上第一次读数慢是正常的：第一次 WMI 调用要加载性能计数器库（几秒）。之后每次约 1 秒。
  没有 PowerShell 或被策略挡了，统计条会说；采样只需要 `Get-CimInstance`。
- 怀疑数字不对？采样就是一段普通的 shell，自己跑一遍：

  ```sh
  hc exec --on <machine> sh -c '<POSIX 采样脚本>' sh /
  hc exec --on <machine> powershell.exe -NoProfile -Command '<Windows 采样脚本>'
  ```

## 开发

```sh
node --check mods/sysstats/main.js
node --check mods/sysstats-panel/main.js
node --test tests/*.test.mjs      # 解析、格式化、两套采样；不需要 herdr-app
herdr-app check mods/sysstats     # 在真 app 里加载并渲染一次
```

测试会在 Linux / macOS 上真跑 POSIX 采样，在 Windows 上真跑 PowerShell 采样，不适用的平台跳过。

发版也是同一套：推一个 `v<version>` tag，`.github/workflows/release.yml` 会重跑这些检查，把
`sysstats/` 和 `sysstats-panel/` 打成 `herdr-system-stats-<version>.zip`，并用 `CHANGELOG.md` 里该
版本那一节当 release notes 发出去。
`gpui-kit.d.ts` 是 app 生成给编辑器用的，不入库。

## 卸载

删掉 `mods/sysstats` 和 `mods/sysstats-panel`，再把布局里那两块删掉（或者
`herdr-app do layout.switch --name main` 切回自带的）。

## 许可

MIT，见 [LICENSE](LICENSE)。

[releases]: https://github.com/FaintGhost/herdr-system-stats/releases
