package main

import (
	"context"
	"errors"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestCPUCounterDeltas(t *testing.T) {
	before, err := parseCPUCounters([]byte("cpu 100 10 30 400 50 6 4 0 90 9\ncpu0 1 2 3 4\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name  string
		after string
		want  *float64
	}{
		{"guest excluded and iowait idle", "cpu 120 10 30 420 110 6 4 0 9000 900", new(20.0)},
		{"all cores busy", "cpu 200 10 30 400 50 6 4 0", new(100.0)},
		{"all cores idle", "cpu 100 10 30 500 50 6 4 0", new(0.0)},
		{"unchanged counters", "cpu 100 10 30 400 50 6 4 0", nil},
		{"rollback masked by growing total", "cpu 90 10 30 500 50 6 4 0", nil},
		{"idle rollback", "cpu 200 10 30 399 50 6 4 0", nil},
		{"iowait rollback", "cpu 200 10 30 400 49 6 4 0", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			after, err := parseCPUCounters([]byte(test.after))
			if err != nil {
				t.Fatal(err)
			}
			got := cpuPercent(before, after)
			if test.want == nil {
				if got != nil {
					t.Fatalf("anomalous counters returned %g%%", *got)
				}
			} else if got == nil || *got != *test.want {
				t.Fatalf("CPU percentage = %v, want %g", got, *test.want)
			}
		})
	}
	if _, err := parseCPUCounters([]byte("cpu 1 2 invalid 4")); err == nil {
		t.Fatal("malformed CPU counters accepted")
	}
}

func TestReclaimableMemoryAndReservedDisk(t *testing.T) {
	memory, err := memoryUsage([]byte("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 200 kB\nCached: 400 kB\nMemAvailable: 700 kB\n"))
	if err != nil {
		t.Fatal(err)
	}
	if memory.UsedBytes != 300*1024 || memory.TotalBytes != 1000*1024 || memory.Percent != 30 {
		t.Fatalf("reclaimable memory counted as used: %+v", memory)
	}
	for _, input := range []string{"MemTotal: 1000 kB\n", "MemTotal: 1000 kB\nMemAvailable: 1001 kB\n"} {
		if _, err := memoryUsage([]byte(input)); err == nil {
			t.Fatal("missing or impossible available memory accepted")
		}
	}
	disk := diskUsageFromStatfs("/reserved", syscall.Statfs_t{
		Blocks: 1000, Bfree: 400, Bavail: 300, Frsize: 4096, Bsize: 8192,
	})
	if disk.Percent == nil || *disk.Percent != 67 || disk.UsedBytes != 600*4096 || disk.FreeBytes != 300*4096 || disk.TotalBytes != 1000*4096 {
		t.Fatalf("disk must exclude reserved blocks and ceil Use%%: %+v", disk)
	}
	// Above float64's integer precision, 50% plus one block still rounds to 51%.
	const capacity = uint64(1 << 54)
	disk = diskUsageFromStatfs("/large", syscall.Statfs_t{
		Blocks: capacity, Bfree: capacity/2 - 1, Bavail: capacity/2 - 1, Frsize: 1,
	})
	if disk.Percent == nil || *disk.Percent != 51 {
		t.Fatalf("large filesystem rounded incorrectly: %+v", disk)
	}
}

func TestUnreadableDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing")
	disk := diskUsage(path)
	if disk.Path != path || disk.Percent != nil || disk.Error == "" || disk.UsedBytes != 0 || disk.FreeBytes != 0 || disk.TotalBytes != 0 {
		t.Fatalf("unreadable disk lost its unavailable row: %+v", disk)
	}
}

func TestSampleCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	timer := time.AfterFunc(10*time.Millisecond, cancel)
	defer timer.Stop()
	if _, err := sample(ctx, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled sample returned %v", err)
	}
}
