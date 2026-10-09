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
