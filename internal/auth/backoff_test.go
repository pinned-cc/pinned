package auth

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBackoffGrowsAndResets(t *testing.T) {
	now := time.Unix(1800000000, 0)
	b := NewBackoff()
	b.Now = func() time.Time { return now }
	for i := 1; i < BackoffFree; i++ {
		if w := b.Fail(); w != 0 {
			t.Fatalf("failure %d waits %v", i, w)
		}
	}
	for i, want := range []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute} {
		if w := b.Fail(); w != want {
			t.Fatalf("wait %d: %v, want %v", i, w, want)
		}
		if b.Waiting() != want {
			t.Fatalf("waiting %d: %v", i, b.Waiting())
		}
		now = now.Add(want)
		if b.Waiting() != 0 {
			t.Fatalf("still waiting after %v", want)
		}
	}
	for range 20 {
		b.Fail()
	}
	if w := b.Waiting(); w != BackoffMax {
		t.Fatalf("cap: %v", w)
	}
	b.Success()
	if b.Waiting() != 0 || b.Fail() != 0 {
		t.Fatal("a success did not clear the failures")
	}
}

// TestBackoffDailyBudget counts the guesses one guesser who always tries
// the moment a wait ends gets: 15 in the first day, then one a day.
func TestBackoffDailyBudget(t *testing.T) {
	start := time.Unix(1800000000, 0)
	now := start
	b := NewBackoff()
	b.Now = func() time.Time { return now }
	count := func(d time.Duration) int {
		n := 0
		for end := now.Add(d); now.Before(end); {
			if w := b.Waiting(); w > 0 {
				now = now.Add(w)
				continue
			}
			if now.Before(end) {
				b.Fail()
				n++
			}
		}
		return n
	}
	if n := count(24 * time.Hour); n != 15 {
		t.Errorf("first day: %d guesses, want 15", n)
	}
	if n := count(30 * 24 * time.Hour); n > 31 {
		t.Errorf("next 30 days: %d guesses, want at most 31", n)
	}
}

// TestBackoffCheckIsOneStep: checks that start together run no more often
// than the free failures allow, and a passing check clears the count.
func TestBackoffCheckIsOneStep(t *testing.T) {
	now := time.Unix(1800000000, 0)
	b := NewBackoff()
	b.Now = func() time.Time { return now }
	var ran atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			b.Check(func() bool { ran.Add(1); return false })
		}()
	}
	close(start)
	wg.Wait()
	if n := ran.Load(); n != BackoffFree {
		t.Errorf("%d checks ran, want %d", n, BackoffFree)
	}
	if ok, w := b.Check(func() bool { t.Error("check ran during the wait"); return true }); ok || w != BackoffFirst {
		t.Errorf("during the wait: %v %v", ok, w)
	}
	b = NewBackoff()
	b.Fail()
	if ok, w := b.Check(func() bool { return true }); !ok || w != 0 {
		t.Errorf("passing check: %v %v", ok, w)
	}
	for i := 1; i < BackoffFree; i++ {
		if b.Fail() != 0 {
			t.Fatal("a passing check did not clear the failures")
		}
	}
}
