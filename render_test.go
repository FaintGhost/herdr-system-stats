package main

import (
	"slices"
	"strings"
	"testing"
)

func TestWrapCellsKeepsPathsAndNumericTokens(t *testing.T) {
	for _, tc := range []struct {
		text    string
		columns int
		want    []string
	}{
		{"RAM   123456789.0/234567890.0 GiB  正常", 28, []string{"RAM", "123456789.0/234567890.0 GiB", "正常"}},
		{"/数据/界e\u0301界e\u0301", 4, []string{"/数", "据/", "界e\u0301", "界e\u0301"}},
		{"ＡＡe\u0301界", 4, []string{"ＡＡ", "e\u0301界"}},
	} {
		if got := wrapCells(tc.text, tc.columns); !slices.Equal(got, tc.want) {
			t.Errorf("wrapCells(%q, %d) = %q, want %q", tc.text, tc.columns, got, tc.want)
		}
	}

	path := "/数据/" + strings.Repeat("界e\u0301", 40)
	if got := strings.Join(wrapCells(path, 28), ""); got != path {
		t.Errorf("wrapping dropped path text: got %q, want %q", got, path)
	}
}

func TestStatusIndicatorsFollowUsage(t *testing.T) {
	for _, tc := range []struct {
		percent *float64
		marker  string
	}{
		{nil, "○"},
		{new(0.0), "🟢"},
		{new(74.9), "🟢"},
		{new(75.0), "🟡"},
		{new(89.9), "🟡"},
		{new(90.0), "🔴"},
		{new(100.0), "🔴"},
	} {
		data := Snapshot{
			CPUPercent: tc.percent,
			Memory:     MemoryUsage{Percent: 80, UsedBytes: 8 << 30, TotalBytes: 10 << 30},
			Disks:      []DiskUsage{{Path: "/", Percent: new(92.0), UsedBytes: 92 << 30, TotalBytes: 100 << 30}},
		}
		for _, mode := range []string{"percent", "used"} {
			line := statusLine(data, mode, true)
			for _, want := range []string{tc.marker + " CPU", "🟡 RAM", "🔴 DISK"} {
				if !strings.Contains(line, want) {
					t.Errorf("mode %s: missing %q in %q", mode, want, line)
				}
			}
			if tc.percent == nil && !strings.Contains(line, "--") {
				t.Errorf("unavailable CPU must retain its reading: %q", line)
			}
			if plain := statusLine(data, mode, false); strings.ContainsAny(plain, "🟢🟡🔴○\x1b") {
				t.Errorf("colors disabled: unexpected indicator or ANSI in %q", plain)
			}
		}
	}
}
