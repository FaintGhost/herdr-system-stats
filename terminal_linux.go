package main

import (
	"os"
	"syscall"
	"unsafe"
)

func terminalSize(file *os.File) (columns, rows int, terminal bool) {
	var size struct {
		Rows, Columns, X, Y uint16
	}
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, file.Fd(), syscall.TIOCGWINSZ, uintptr(unsafe.Pointer(&size)))
	if errno != 0 {
		return 80, 24, false
	}
	return max(1, int(size.Columns)), max(1, int(size.Rows)), true
}
