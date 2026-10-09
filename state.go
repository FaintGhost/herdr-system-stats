package main

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

const pluginID = "faintghost.system-stats"

type config struct {
	Disks []string `json:"disks"`
}

func defaultPaths() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	configRoot := cmp.Or(os.Getenv("XDG_CONFIG_HOME"), filepath.Join(home, ".config"))
	stateRoot := cmp.Or(os.Getenv("XDG_STATE_HOME"), filepath.Join(home, ".local", "state"))
	configDir := cmp.Or(os.Getenv("HERDR_PLUGIN_CONFIG_DIR"), filepath.Join(configRoot, "herdr", "plugins", "config", pluginID))
	stateDir := cmp.Or(os.Getenv("HERDR_PLUGIN_STATE_DIR"), filepath.Join(stateRoot, "herdr", "plugins", pluginID))
	configPath, err := filepath.Abs(filepath.Join(configDir, "config.json"))
	if err != nil {
		return "", "", err
	}
	stateDir, err = filepath.Abs(stateDir)
	return configPath, stateDir, err
}

func loadConfig(path string) (config, error) {
	cfg := config{Disks: []string{"/"}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, fmt.Errorf("read configuration: %w", err)
	}
	if data = bytes.TrimSpace(data); len(data) == 0 || data[0] != '{' {
		return cfg, errors.New("configuration must be a JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("parse configuration: %w", err)
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return cfg, errors.New("configuration must contain exactly one JSON object")
	}
	if len(cfg.Disks) == 0 {
		return cfg, errors.New("disks must contain at least one absolute path")
	}
	for _, path := range cfg.Disks {
		if !filepath.IsAbs(path) {
			return cfg, fmt.Errorf("disk path must be absolute: %q", path)
		}
		for _, r := range path {
			if r < 32 || r == 127 {
				return cfg, errors.New("disk paths cannot contain terminal control characters")
			}
		}
	}
	return cfg, nil
}

func markerExists(stateDir, name string) (bool, error) {
	_, err := os.Stat(filepath.Join(stateDir, name))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

func displayMode(stateDir string) (string, error) {
	used, err := markerExists(stateDir, "display-used")
	if used {
		return "used", err
	}
	return "percent", err
}

func setMarker(path string, enabled bool) error {
	if !enabled {
		err := os.Remove(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	return file.Close()
}

func changeState(stateDir, command string) (string, error) {
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return "", err
	}
	lock, err := os.OpenFile(filepath.Join(stateDir, "actions.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return "", err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return "", err
	}
	switch command {
	case "pause", "resume":
		return command, setMarker(filepath.Join(stateDir, "paused"), command == "pause")
	case "toggle-display":
		used, err := markerExists(stateDir, "display-used")
		if err != nil {
			return "", err
		}
		if err := setMarker(filepath.Join(stateDir, "display-used"), !used); err != nil {
			return "", err
		}
		if used {
			return "percent", nil
		}
		return "used", nil
	default:
		return "", fmt.Errorf("unknown state action %q", command)
	}
}
