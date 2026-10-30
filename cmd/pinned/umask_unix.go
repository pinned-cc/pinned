//go:build unix

package main

import "syscall"

// privateUmask makes every file and folder the process creates from now on
// readable by its own user only, SQLite's database, WAL and shared memory
// files included.
func privateUmask() { syscall.Umask(0o077) }
