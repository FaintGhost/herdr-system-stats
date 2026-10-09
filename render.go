package main

import (
	"fmt"
	"math"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/width"
)

var byteUnits = [...]string{"B", "KiB", "MiB", "GiB", "TiB", "PiB"}

func statusLine(data Snapshot, display string, color bool) string {
	var out strings.Builder
	out.Grow(64 + len(data.Disks)*48)
	writeStatusMetric(&out, "CPU", data.CPUPercent, formatPercent(data.CPUPercent), color)
	out.WriteString("  ")
	writeStatusMetric(&out, "RAM", &data.Memory.Percent, formatReading(&data.Memory.Percent, data.Memory.UsedBytes, data.Memory.TotalBytes, display), color)
	for _, disk := range data.Disks {
		out.WriteString("  ")
		label := "DISK"
		if len(data.Disks) > 1 {
			label += " " + disk.Path
		}
		writeStatusMetric(&out, label, disk.Percent, formatReading(disk.Percent, disk.UsedBytes, disk.TotalBytes, display), color)
	}
	return out.String()
}

func writeStatusMetric(out *strings.Builder, label string, value *float64, reading string, color bool) {
	if color {
		_, code := usageLevel(value)
		switch code {
		case "32":
			out.WriteString("🟢 ")
		case "33":
			out.WriteString("🟡 ")
		case "31":
			out.WriteString("🔴 ")
		default:
			out.WriteString("○ ")
		}
	}
	out.WriteString(label)
	out.WriteByte(' ')
	writeMeter(out, value, 4, "▰", "▱")
	fmt.Fprintf(out, " %4s", reading)
}

func details(data Snapshot, columns int, color bool, display string) string {
	contentWidth := max(2, min(68, columns-4))
	var out strings.Builder
	out.Grow(512 + len(data.Disks)*400)
	writeWrapped(&out, "整机资源", contentWidth, "1;36", color)
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "主机名不可用"
	}
	writeWrapped(&out, hostname+" · "+time.Now().Format("15:04:05"), contentWidth, "", color)
	out.WriteByte('\n')
	writeDetailsMetric(&out, "CPU", data.CPUPercent, formatPercent(data.CPUPercent), "所有核心 · 250 ms 采样", contentWidth, color)

	ramCaption := "已用 " + formatSize(data.Memory.UsedBytes) + " / " + formatSize(data.Memory.TotalBytes)
	if display == "used" {
		available := data.Memory.TotalBytes - min(data.Memory.TotalBytes, data.Memory.UsedBytes)
		ramCaption = "可用 " + formatSize(available)
	}
	writeDetailsMetric(&out, "RAM", &data.Memory.Percent,
		formatReading(&data.Memory.Percent, data.Memory.UsedBytes, data.Memory.TotalBytes, display), ramCaption, contentWidth, color)

	for _, disk := range data.Disks {
		caption := disk.Path + " · "
		if disk.Percent == nil {
			if disk.Error != "" {
				caption += disk.Error
			} else {
				caption += "文件系统容量为零"
			}
		} else {
			caption += "可用 " + formatSize(disk.FreeBytes)
			if display != "used" {
				caption += " / 总计 " + formatSize(disk.TotalBytes)
			}
		}
		writeDetailsMetric(&out, "DISK", disk.Percent,
			formatReading(disk.Percent, disk.UsedBytes, disk.TotalBytes, display), caption, contentWidth, color)
	}
	return strings.TrimSuffix(out.String(), "\n")
}

func writeDetailsMetric(out *strings.Builder, label string, value *float64, reading, caption string, columns int, color bool) {
	state, code := usageLevel(value)
	writeWrapped(out, fmt.Sprintf("%-4s  %4s  %s", label, reading, state), columns, "1;"+code, color)
	out.WriteString("  ")
	if color {
		out.WriteString("\x1b[" + code + "m")
	}
	writeMeter(out, value, columns, "━", "─")
	if color {
		out.WriteString("\x1b[0m")
	}
	out.WriteByte('\n')
	writeWrapped(out, caption, columns, "", color)
	out.WriteByte('\n')
}

func writeWrapped(out *strings.Builder, text string, columns int, code string, color bool) {
	for _, line := range wrapCells(text, columns) {
		out.WriteString("  ")
		if color && code != "" {
			out.WriteString("\x1b[" + code + "m")
		}
		out.WriteString(line)
		if color && code != "" {
			out.WriteString("\x1b[0m")
		}
		out.WriteByte('\n')
	}
}

func formatPercent(value *float64) string {
	if value == nil {
		return "--"
	}
	return fmt.Sprintf("%.0f%%", *value)
}

func formatReading(value *float64, used, total uint64, display string) string {
	if display != "used" || value == nil {
		return formatPercent(value)
	}
	scale, unit := byteScale(total)
	return fmt.Sprintf("%.1f/%.1f %s", float64(used)/scale, float64(total)/scale, unit)
}

func formatSize(value uint64) string {
	scale, unit := byteScale(value)
	return fmt.Sprintf("%.1f %s", float64(value)/scale, unit)
}

func byteScale(value uint64) (float64, string) {
	scale := uint64(1)
	unit := 0
	for unit < len(byteUnits)-1 && value/scale >= 1024 {
		scale *= 1024
		unit++
	}
	return float64(scale), byteUnits[unit]
}

func writeMeter(out *strings.Builder, value *float64, columns int, filled, empty string) {
	count := 0
	if value != nil {
		count = int(math.RoundToEven(min(100, max(0, *value)) * float64(columns) / 100))
	}
	for range count {
		out.WriteString(filled)
	}
	for range columns - count {
		out.WriteString(empty)
	}
}

func usageLevel(value *float64) (string, string) {
	if value == nil {
		return "不可用", "39"
	}
	if *value >= 90 {
		return "高占用", "31"
	}
	if *value >= 75 {
		return "偏高", "33"
	}
	return "正常", "32"
}

func cellWidth(r rune) int {
	if unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r) || unicode.Is(unicode.Cf, r) {
		return 0
	}
	switch width.LookupRune(r).Kind() {
	case width.EastAsianWide, width.EastAsianFullwidth:
		return 2
	default:
		return 1
	}
}

// Wrap at whitespace before splitting a token that cannot fit on its own.
// Slices retain every byte of long paths, including their combining marks.
func wrapCells(text string, columns int) []string {
	columns = max(2, columns)
	var lines []string
	for paragraph := range strings.SplitSeq(text, "\n") {
		lineStart, lineEnd, cells := -1, 0, 0
		for pos := 0; pos < len(paragraph); {
			r, size := utf8.DecodeRuneInString(paragraph[pos:])
			if unicode.IsSpace(r) {
				pos += size
				continue
			}
			wordStart, wordCells := pos, 0
			for pos < len(paragraph) {
				r, size = utf8.DecodeRuneInString(paragraph[pos:])
				if unicode.IsSpace(r) {
					break
				}
				wordCells += cellWidth(r)
				pos += size
			}
			gapCells := 0
			if lineStart >= 0 {
				for _, gap := range paragraph[lineEnd:wordStart] {
					gapCells += cellWidth(gap)
				}
			}
			if lineStart >= 0 && cells+gapCells+wordCells <= columns {
				lineEnd = pos
				cells += gapCells + wordCells
				continue
			}
			if lineStart >= 0 {
				lines = append(lines, paragraph[lineStart:lineEnd])
			}
			lineStart, lineEnd, cells = wordStart, pos, wordCells
			if wordCells <= columns {
				continue
			}
			cells = 0
			for offset, char := range paragraph[wordStart:pos] {
				charCells := cellWidth(char)
				if cells+charCells > columns {
					boundary := wordStart + offset
					lines = append(lines, paragraph[lineStart:boundary])
					lineStart, cells = boundary, 0
				}
				cells += charCells
			}
		}
		if lineStart >= 0 {
			lines = append(lines, paragraph[lineStart:lineEnd])
		} else {
			lines = append(lines, "")
		}
	}
	return lines
}
