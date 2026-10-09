# Herdr System Stats

**用 Go 编写的 Herdr 整机 CPU、内存和磁盘监控插件。**

[English](README.md)

```text
CPU ▰▰▰▱  68%  RAM ▰▰▱▱  47%  DISK ▰▰▰▱  82%

CPU ▰▰▰▱  68%  RAM ▰▰▱▱ 11.0/23.4 GiB  DISK ▰▰▰▱ 115.1/147.2 GiB
```

上面是两种显示模式的示例。配置快捷键后，**Ctrl+B，再按 U** 切换内存和磁盘的百分比／已用总量。CPU 始终使用百分比，进度条始终表示占用比例。

顶部状态栏由 Herdr 原生命令调度，每 5 秒采样；详情面板每 2 秒刷新，显示长进度条、剩余空间和占用状态。无需 Python、Node 或额外常驻进程，采样不启动系统命令，也不会自动修改你的 Herdr 配置。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Linux；CI 构建 amd64 和 arm64 |
| Herdr | 0.9.3 或更高 |
| 安装工具 | 运行 Herdr 服务的机器上需要 Go 1.26+ 和 Git |
| 运行 | 编译后的单个二进制，以及可读的 `/proc/stat`、`/proc/meminfo` |

安装时从源码编译，下载固定版本的 `golang.org/x/text` 处理终端字符宽度；不依赖 CGO。当前不支持 macOS、Windows。

## 安装并启用顶部状态栏

```sh
herdr plugin install FaintGhost/herdr-system-stats
herdr plugin pane open --plugin faintghost.system-stats --entrypoint setup
```

插件 ID 是 **`faintghost.system-stats`**。Herdr 会预览构建和运行命令；编译输出为 `bin/herdr-system-stats`。

Setup 面板打印本机实际可用的 TOML 配置，包含二进制、config 和 state 的绝对路径。将其 command 条目合并到已有 `[ui]` 的 `tab_bar_right` 数组中，保留其他条目；已有 `[ui]` 时不要再创建第二个同名表。没有该表时只创建一次。生成的命令会处理路径中的空格和单引号。

Setup 还打印可选的 U 快捷键；如果已经占用，请选一个空闲键。按 Enter 或 Ctrl+C 关闭 Setup，然后执行：

```sh
herdr config check
herdr server reload-config
```

如果当前客户端布局未更新，在 Herdr 菜单选择 **reload config**。无需重启。只安装插件不会自动添加顶部显示。

## 快捷键和操作

将以下配置追加到 `config.toml` 顶层：

```toml
[[keys.command]]
key = "prefix+u"
type = "plugin_action"
command = "faintghost.system-stats.toggle-display"
description = "切换资源百分比／用量"
```

保存快捷键后，先执行 `herdr config check`，再在 Herdr 菜单选择 **reload config**，刷新客户端快捷键。只重载服务器，不能激活另一客户端本地配置中新添加的绑定。

默认 prefix 是 Ctrl+B：按下并松开，再按 U。如果改过 prefix，使用你自己的组合。显示选择会保存，重启和更新后保留；共用同一 state 目录的 session 共用该选择。

```sh
# 打开实时详情面板，Ctrl+C 关闭
herdr plugin pane open --plugin faintghost.system-stats --entrypoint monitor

# 也可从插件动作菜单切换
herdr plugin action invoke faintghost.system-stats.toggle-display

# 暂停／恢复顶部显示
herdr plugin action invoke faintghost.system-stats.pause
herdr plugin action invoke faintghost.system-stats.resume
```

顶部最迟下一次 5 秒刷新生效，已经打开的详情面板下一次 2 秒刷新同步。默认使用百分比。Pause 状态同样保存；暂停只让状态栏输出为空，不会关闭详情面板，也不停止 Herdr 的 command 调度。

详情面板低于 75% 显示“正常”，75–89% 为“偏高”，90% 起为“高占用”。颜色使用终端调色板，并始终保留数字和文字。设置 `NO_COLOR` 禁用颜色，重定向输出不带 ANSI 样式。顶部使用主题原有样式，因为 Herdr 会过滤 command 输出的 ANSI 颜色。详情标签目前为中文，CLI 帮助和 Setup 为英文。

## 设置磁盘

查询插件配置目录：

```sh
herdr plugin config-dir faintghost.system-stats
```

在该目录创建 **`config.json`**：

```json
{
  "disks": ["/", "/mnt/data"]
}
```

不创建配置文件时默认监控 `/`。路径必须是绝对路径，路径所在的整个文件系统就是统计对象；同一文件系统的多个路径会重复显示，请每个文件系统只选一个。不存在或不可读取的路径显示 `--`，详情给出错误。

顶部下一次调用会重读配置；已打开的详情面板需重新打开以应用新的 disks。空数组、相对路径、未知字段和控制字符会报错。Herdr 会清除失败命令的显示，避免保留旧数据。Go 发布版的用户配置是 JSON，不读取先前本地 Python 原型的 `config.toml`。

## 独立运行

```sh
./bin/herdr-system-stats status
./bin/herdr-system-stats once --display used
./bin/herdr-system-stats watch
./bin/herdr-system-stats once --json
./bin/herdr-system-stats --help
```

参数放在子命令之后：

| 参数 | 用途 |
| --- | --- |
| `--config PATH` | 指定可选 JSON 配置 |
| `--state-dir DIR` | 指定持久化状态目录 |
| `--display percent\|used` | 临时覆盖保存的显示模式 |
| `--json` | 输出一次原始采样；即使子命令是 watch 也只输出一次 |
| `--wait` | Setup 在终端中等待 Enter 或 Ctrl+C |

插件 action/pane 使用 Herdr 注入的 `HERDR_PLUGIN_CONFIG_DIR` 和 `HERDR_PLUGIN_STATE_DIR`。独立运行时，配置位于 `$XDG_CONFIG_HOME/herdr/plugins/config/faintghost.system-stats/config.json`，状态位于 `$XDG_STATE_HOME/herdr/plugins/faintghost.system-stats`；默认根目录为 `~/.config` 和 `~/.local/state`。Setup 的顶部命令显式传入这两个路径，使它与插件动作共用状态。

## 统计口径

| 指标 | 计算方法 |
| --- | --- |
| CPU | `/proc/stat` 两次采样，间隔 250 ms；所有核心合计归一化到 0–100%，iowait 计为空闲，guest 不重复计算。计数器回退或未前进显示 `--`。 |
| 内存 | `MemTotal − MemAvailable`，可回收缓存视为可用。 |
| 磁盘百分比 | `ceil(used / (used + available) × 100)`，与 `df Use%` 一致，排除保留块。 |
| 磁盘用量 | 已用字节／文件系统全部容量；可用空间另外显示。保留块导致该分数可能与百分比不完全相等。 |
| 单位 | 按总容量选择统一的二进制单位，1 GiB = 1024³ 字节。 |

统计整机，不归属到各 workspace 或进程。CPU 是 250 ms 窗口，不是过去 5 秒均值；磁盘是容量，不是 I/O 速度。容器中的 `/proc` 可能显示主机总量，不按 cgroup 限额重新归一化。

JSON 保留原始字节和百分比，不随显示模式换算。不可用 CPU／磁盘百分比为 `null`；不可读磁盘的字节字段为零占位，不能作为真实容量使用，应先判断 `percent` 和 `error`。

## 远程与窄窗口

插件采样运行 Herdr 服务的机器。SSH 使用时，将插件和 Go 工具链安装在远端。打开远端 Setup 面板取得服务端路径，再将生成的状态栏条目放入客户端的显示配置；不要替换成本机路径。Herdr 的 command 在服务端执行。

窄顶部栏或 Herdr 移动布局可能隐藏原生 status 区域，可以打开详情面板查看。已验证 32×24 和 80 列窗口，包括中文路径和长短文字来回切换。任意数量磁盘或特别矮的面板没有自动滚动／分页，请放大面板或用 `once` 输出查看。

## 更新与卸载

GitHub 安装版重新安装即可更新，保留配置和状态：

```sh
herdr plugin install FaintGhost/herdr-system-stats
```

二进制路径改变时重新运行 Setup。Herdr 没有单独的 `plugin update`。

卸载前，先从 `tab_bar_right` 移除本插件 command 条目，删除本插件可选快捷键，保留其他配置，再执行：

```sh
herdr config check
herdr server reload-config
herdr plugin uninstall faintghost.system-stats
```

Herdr 的 disable/uninstall 不会清除你手动添加的 command。只想隐藏读数时用 pause；想停止周期调用时删除 command 条目。本地 link 开发版用 `herdr plugin unlink faintghost.system-stats` 取消注册。Herdr 保留 config/state；仅在确实想丢弃设置时自行删除。

## 开发与验证

```sh
git clone https://github.com/FaintGhost/herdr-system-stats.git
cd herdr-system-stats
go build -trimpath -ldflags='-s -w' -o bin/herdr-system-stats .
herdr plugin link "$PWD"

go test -race ./...
go vet ./...
```

`plugin link` 不执行构建命令，所以先 build。不能用 `plugin install` 覆盖本地 link 的插件，需先 unlink。

采样在 `metrics_linux.go`，渲染在 `render.go`，配置和锁定状态操作在 `state.go`，CLI 和终端生命周期在 `main.go`／`terminal_linux.go`。测试覆盖 CPU guest/iowait、计数器异常、可回收内存、磁盘保留块、Unicode 换行、并发状态切换和配置边界；CI 跑 race detector、vet，并构建 amd64/arm64。

插件只读操作系统计数器、写自身状态标记，不调用 Herdr 控制 API；Herdr 负责调度和面板生命周期。

## 市场与许可

公开仓库的 `herdr-plugin` topic 和根目录 manifest 满足 [Herdr 市场自动发现规则](https://herdr.dev/docs/marketplace/)。市场约每 30 分钟刷新；收录属于社区发现，不代表 Herdr 审核或背书。

[MIT License](LICENSE)。反馈问题：[GitHub Issues](https://github.com/FaintGhost/herdr-system-stats/issues)。
