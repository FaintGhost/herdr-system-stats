package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestDisplayStatePersistsAcrossConcurrentActions(t *testing.T) {
	directory := t.TempDir()
	if mode, err := changeState(directory, "toggle-display"); err != nil || mode != "used" {
		t.Fatalf("first toggle: %s, %v", mode, err)
	}
	if mode, err := displayMode(directory); err != nil || mode != "used" {
		t.Fatalf("saved mode: %s, %v", mode, err)
	}
	var actions sync.WaitGroup
	for range 20 {
		actions.Go(func() {
			if _, err := changeState(directory, "toggle-display"); err != nil {
				t.Error(err)
			}
		})
	}
	actions.Wait()
	if mode, err := displayMode(directory); err != nil || mode != "used" {
		t.Fatalf("concurrent actions lost a toggle: %s, %v", mode, err)
	}
	if _, err := changeState(directory, "pause"); err != nil {
		t.Fatal(err)
	}
	if paused, err := markerExists(directory, "paused"); err != nil || !paused {
		t.Fatalf("pause state not persisted: %t, %v", paused, err)
	}
	if _, err := changeState(directory, "resume"); err != nil {
		t.Fatal(err)
	}
	if mode, err := displayMode(directory); err != nil || mode != "used" {
		t.Fatalf("resume changed display mode: %s, %v", mode, err)
	}
}

func TestConfigRejectsUnsafeOrAmbiguousPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	for _, input := range []string{
		`{"disks": []}`, `{"disks": null}`, `{"disks": ["relative"]}`,
		`{"disks": ["/bad\u001b[2J"]}`, `{"disk": ["/"]}`,
		`{"disks": ["/"]} {}`, `null`,
	} {
		if err := os.WriteFile(path, []byte(input), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadConfig(path); err == nil {
			t.Fatalf("invalid configuration accepted: %s", input)
		}
	}
	input := `{"disks": ["/数据/space and 'quote'"]}`
	if err := os.WriteFile(path, []byte(input), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := loadConfig(path)
	if err != nil || len(cfg.Disks) != 1 || !strings.Contains(cfg.Disks[0], "'quote'") {
		t.Fatalf("valid absolute path rejected: %+v, %v", cfg, err)
	}
}
