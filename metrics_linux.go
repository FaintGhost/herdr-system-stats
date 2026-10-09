package main

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"math/bits"
	"os"
	"strconv"
	"syscall"
	"time"
)

type MemoryUsage struct {
	UsedBytes  uint64  `json:"used_bytes"`
	TotalBytes uint64  `json:"total_bytes"`
	Percent    float64 `json:"percent"`
}

type DiskUsage struct {
	Path       string   `json:"path"`
	Percent    *float64 `json:"percent"`
	UsedBytes  uint64   `json:"used_bytes"`
	FreeBytes  uint64   `json:"free_bytes"`
	TotalBytes uint64   `json:"total_bytes"`
	Error      string   `json:"error,omitempty"`
}

type Snapshot struct {
	CPUPercent *float64    `json:"cpu_percent"`
	Memory     MemoryUsage `json:"memory"`
	Disks      []DiskUsage `json:"disks"`
}

// Linux includes guest and guest_nice in user and nice already.
// Keep individual counters so a rollback cannot hide behind other increments.
type cpuCounters [8]uint64

func parseCPUCounters(data []byte) (cpuCounters, error) {
	var counters cpuCounters
	line, _, _ := bytes.Cut(data, []byte("\n"))
	count := -1
	for field := range bytes.FieldsSeq(line) {
		if count == -1 {
			if !bytes.Equal(field, []byte("cpu")) {
				return counters, fmt.Errorf("missing aggregate CPU counters in /proc/stat")
			}
			count = 0
			continue
		}
		if count == len(counters) {
			break
		}
		value, err := strconv.ParseUint(string(field), 10, 64)
		if err != nil {
			return counters, fmt.Errorf("invalid /proc/stat CPU counter: %w", err)
		}
		counters[count] = value
		count++
	}
	if count < 4 {
		return counters, fmt.Errorf("incomplete /proc/stat CPU counters")
	}
	return counters, nil
}

func readCPUCounters() (cpuCounters, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuCounters{}, fmt.Errorf("read CPU counters: %w", err)
	}
	return parseCPUCounters(data)
}

func cpuPercent(before, after cpuCounters) *float64 {
	var total, idle uint64
	for i, previous := range before {
		if after[i] < previous {
			return nil
		}
		delta := after[i] - previous
		if delta > math.MaxUint64-total {
			return nil
		}
		total += delta
		if i == 3 || i == 4 { // Both idle and iowait are idle time.
			idle += delta
		}
	}
	if total == 0 {
		return nil
	}
	return new(100 * float64(total-idle) / float64(total))
}

func memoryUsage(data []byte) (MemoryUsage, error) {
	var total, available uint64
	var haveTotal, haveAvailable bool
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		key, value, found := bytes.Cut(line, []byte(":"))
		if !found || (!bytes.Equal(key, []byte("MemTotal")) && !bytes.Equal(key, []byte("MemAvailable"))) {
			continue
		}
		var number []byte
		for field := range bytes.FieldsSeq(value) {
			number = field
			break
		}
		kilobytes, err := strconv.ParseUint(string(number), 10, 64)
		if err != nil {
			return MemoryUsage{}, fmt.Errorf("invalid /proc/meminfo %s: %w", key, err)
		}
		if kilobytes > math.MaxUint64/1024 {
			return MemoryUsage{}, fmt.Errorf("/proc/meminfo %s exceeds byte capacity", key)
		}
		if bytes.Equal(key, []byte("MemTotal")) {
			total, haveTotal = kilobytes*1024, true
		} else {
			available, haveAvailable = kilobytes*1024, true
		}
	}
	if !haveTotal || !haveAvailable || total == 0 || available > total {
		return MemoryUsage{}, fmt.Errorf("missing or invalid /proc/meminfo memory counters")
	}
	used := total - available
	return MemoryUsage{UsedBytes: used, TotalBytes: total, Percent: 100 * float64(used) / float64(total)}, nil
}

func diskUsageFromStatfs(path string, info syscall.Statfs_t) DiskUsage {
	usage := DiskUsage{Path: path}
	blockSize := info.Frsize
	if blockSize == 0 {
		blockSize = info.Bsize
	}
	if blockSize <= 0 || info.Bfree > info.Blocks || info.Bavail > info.Bfree || info.Blocks > math.MaxUint64/uint64(blockSize) {
		usage.Error = "invalid filesystem capacity counters"
		return usage
	}
	used := info.Blocks - info.Bfree
	usage.UsedBytes = used * uint64(blockSize)
	usage.FreeBytes = info.Bavail * uint64(blockSize)
	usage.TotalBytes = info.Blocks * uint64(blockSize)
	capacity := used + info.Bavail
	if capacity != 0 {
		// df excludes reserved blocks and rounds upward. Integer division
		// preserves that rounding even for capacities above float64 precision.
		hi, lo := bits.Mul64(used, 100)
		percent, remainder := bits.Div64(hi, lo, capacity)
		if remainder != 0 {
			percent++
		}
		usage.Percent = new(float64(percent))
	}
	return usage
}

func diskUsage(path string) DiskUsage {
	var info syscall.Statfs_t
	if err := syscall.Statfs(path, &info); err != nil {
		return DiskUsage{Path: path, Error: err.Error()}
	}
	return diskUsageFromStatfs(path, info)
}

func sample(ctx context.Context, disks []string) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	before, err := readCPUCounters()
	if err != nil {
		return Snapshot{}, err
	}
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return Snapshot{}, ctx.Err()
	case <-timer.C:
	}
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	after, err := readCPUCounters()
	if err != nil {
		return Snapshot{}, err
	}
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return Snapshot{}, fmt.Errorf("read memory counters: %w", err)
	}
	memory, err := memoryUsage(data)
	if err != nil {
		return Snapshot{}, err
	}
	result := Snapshot{CPUPercent: cpuPercent(before, after), Memory: memory, Disks: make([]DiskUsage, 0, len(disks))}
	for _, path := range disks {
		if err := ctx.Err(); err != nil {
			return Snapshot{}, err
		}
		result.Disks = append(result.Disks, diskUsage(path))
	}
	return result, nil
}
