package server

import (
	"testing"
	"time"
)

func TestWatchIntervalBacksOffAfterIdleScans(t *testing.T) {
	cases := []struct {
		idleScans int
		want      time.Duration
	}{
		{idleScans: 0, want: 750 * time.Millisecond},
		{idleScans: 1, want: 1500 * time.Millisecond},
		{idleScans: 2, want: 2 * time.Second},
		{idleScans: 8, want: 2 * time.Second},
	}

	for _, tt := range cases {
		if got := watchInterval(tt.idleScans); got != tt.want {
			t.Fatalf("watchInterval(%d) = %s, want %s", tt.idleScans, got, tt.want)
		}
	}
}
