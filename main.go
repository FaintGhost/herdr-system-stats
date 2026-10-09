package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, "System Stats:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	command := "status"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}
	configPath, stateDir, err := defaultPaths()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.StringVar(&configPath, "config", configPath, "Path to optional config.json")
	flags.StringVar(&stateDir, "state-dir", stateDir, "Directory for saved display and pause state")
	display := flags.String("display", "", "Override saved mode: percent or used")
	jsonOutput := flags.Bool("json", false, "Print one raw JSON sample")
	wait := flags.Bool("wait", false, "Keep setup instructions open until Enter")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "Usage: herdr-system-stats [status|once|watch|pause|resume|toggle-display|setup] [options]")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); errors.Is(err, flag.ErrHelp) {
		return nil
	} else if err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected argument %q", flags.Arg(0))
	}
	if *display != "" && *display != "percent" && *display != "used" {
		return errors.New("--display must be percent or used")
	}
	if stateDir == "" || configPath == "" {
		return errors.New("--config and --state-dir cannot be empty")
	}
	if command == "setup" {
		return setup(ctx, configPath, stateDir, *wait)
	}
	if command == "pause" || command == "resume" || command == "toggle-display" {
		result, err := changeState(stateDir, command)
		if err == nil {
			fmt.Println("System Stats:", result)
		}
		return err
	}
	if command != "status" && command != "once" && command != "watch" {
		return fmt.Errorf("unknown command %q; use --help", command)
	}
	if command == "status" {
		paused, err := markerExists(stateDir, "paused")
		if err != nil || paused {
			return err
		}
	}
	cfg, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	if command == "watch" && !*jsonOutput {
		return watch(ctx, cfg.Disks, stateDir, *display)
	}
	data, err := sample(ctx, cfg.Disks)
	if err != nil {
		return err
	}
	if *jsonOutput {
		return json.NewEncoder(os.Stdout).Encode(data)
	}
	mode, err := effectiveDisplay(stateDir, *display)
	if err != nil {
		return err
	}
	if command == "once" {
		columns, _, terminal := terminalSize(os.Stdout)
		fmt.Println(details(data, columns, colorsEnabled(terminal), mode))
	} else {
		fmt.Println(statusLine(data, mode, colorsEnabled(true)))
	}
	return nil
}

func effectiveDisplay(stateDir, override string) (string, error) {
	if override != "" {
		return override, nil
	}
	return displayMode(stateDir)
}

func colorsEnabled(terminal bool) bool {
	_, noColor := os.LookupEnv("NO_COLOR")
	return terminal && !noColor && os.Getenv("TERM") != "dumb"
}

func watch(ctx context.Context, disks []string, stateDir, override string) error {
	_, _, terminal := terminalSize(os.Stdout)
	if terminal {
		fmt.Print("\033[?1049h\033[?25l")
		defer fmt.Print("\033[?25h\033[?1049l")
	}
	ticks := time.Tick(2 * time.Second)
	for {
		data, err := sample(ctx, disks)
		if err != nil {
			return err
		}
		mode, err := effectiveDisplay(stateDir, override)
		if err != nil {
			return err
		}
		columns, _, _ := terminalSize(os.Stdout)
		var frame strings.Builder
		frame.Grow(2048)
		if terminal {
			frame.WriteString("\033[H")
		}
		body := details(data, columns, colorsEnabled(terminal), mode)
		for line := range strings.SplitSeq(body, "\n") {
			frame.WriteString(line)
			if terminal {
				frame.WriteString("\033[K")
			}
			frame.WriteByte('\n')
		}
		for _, line := range wrapCells("每 2 秒刷新 · Ctrl+C 关闭", max(1, columns-4)) {
			frame.WriteString("  ")
			frame.WriteString(line)
			if terminal {
				frame.WriteString("\033[K")
			}
			frame.WriteByte('\n')
		}
		if terminal {
			frame.WriteString("\033[J")
		}
		if _, err := fmt.Print(frame.String()); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticks:
		}
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func setup(ctx context.Context, configPath, stateDir string, wait bool) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	configPath, err = filepath.Abs(configPath)
	if err != nil {
		return err
	}
	stateDir, err = filepath.Abs(stateDir)
	if err != nil {
		return err
	}
	command := shellQuote(executable) + " status --config " + shellQuote(configPath) + " --state-dir " + shellQuote(stateDir)
	configHome, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	herdrConfig := cmp.Or(os.Getenv("HERDR_CONFIG_PATH"), filepath.Join(configHome, "herdr", "config.toml"))
	fmt.Printf("System Stats setup\n\nHerdr config: %s\nPlugin config (optional): %s\nSaved state: %s\n\n", herdrConfig, configPath, stateDir)
	fmt.Println("Merge the entry below into the existing [ui].tab_bar_right array.")
	fmt.Println("Keep existing entries; do not create a second [ui] table.")
	fmt.Printf("\n[ui]\ntab_bar_right = [\n  { type = \"command\", command = %s, interval_seconds = 5, timeout_seconds = 2 },\n]\n", strconv.Quote(command))
	fmt.Printf("\n# Optional shortcut (use a free key if U is already bound):\n[[keys.command]]\nkey = \"prefix+u\"\ntype = \"plugin_action\"\ncommand = \"%s.toggle-display\"\ndescription = \"Toggle stats percentage / used-total\"\n", pluginID)
	fmt.Println("\nReload from Herdr's menu, or run: herdr server reload-config")
	fmt.Println("Default prefix: Ctrl+B, then U toggles RAM/disk display.")
	fmt.Println("This plugin never edits your Herdr configuration automatically.")
	_, _, terminal := terminalSize(os.Stdin)
	if wait && terminal {
		fmt.Print("\nPress Enter to close.\n")
		closed := make(chan error, 1)
		go func() {
			var input [1]byte
			for {
				if _, err := os.Stdin.Read(input[:]); err != nil {
					closed <- err
					return
				}
				if input[0] == '\n' {
					closed <- nil
					return
				}
			}
		}()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-closed:
			return err
		}
	}
	return nil
}
