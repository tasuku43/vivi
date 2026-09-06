package attention

import (
	"testing"
	"time"
)

func TestSharedWindowAndDismissal(t *testing.T) {
	dir := t.TempDir()
	a, b := New(dir), New(dir)
	now := time.Now().Truncate(time.Millisecond)
	add := func(s *Store, e Event) {
		t.Helper()
		if err := s.Append(e); err != nil {
			t.Fatal(err)
		}
	}
	add(a, Event{Path: "guide.md", At: now.Add(-29 * time.Minute).UnixMilli(), Reason: "Updated"})
	got, err := b.Snapshot(now)
	if err != nil || len(got) != 1 {
		t.Fatalf("shared snapshot: %v %v", got, err)
	}
	got, _ = b.Snapshot(now.Add(time.Minute))
	if len(got) != 0 {
		t.Fatal("30-minute boundary retained")
	}
	add(b, Event{Path: "guide.md", At: now.UnixMilli(), Reason: "hidden"})
	got, _ = a.Snapshot(now)
	if len(got) != 0 {
		t.Fatal("dismissal not shared")
	}
	add(a, Event{Path: "guide.md", At: now.Add(-29 * time.Minute).UnixMilli(), Reason: "Updated"})
	got, _ = a.Snapshot(now)
	if len(got) != 0 {
		t.Fatal("old replay undid dismissal")
	}
	add(b, Event{Path: "guide.md", At: now.Add(time.Millisecond).UnixMilli(), Reason: "Opened"})
	got, _ = a.Snapshot(now.Add(time.Millisecond))
	if len(got) != 1 || got[0].Reason != "Opened" {
		t.Fatal("new event did not restore")
	}
}

func TestNewIntentInSameMillisecondRestoresDismissedDocument(t *testing.T) {
	s := New(t.TempDir())
	now := time.Now().Truncate(time.Millisecond)
	for _, e := range []Event{{Path: "a.md", At: now.UnixMilli(), Order: 1, Reason: "Updated"}, {Path: "a.md", At: now.UnixMilli(), Order: 2, Reason: "hidden"}, {Path: "a.md", At: now.UnixMilli(), Order: 3, Reason: "Opened"}, {Path: "a.md", At: now.UnixMilli(), Reason: "Updated"}} {
		if err := s.Append(e); err != nil {
			t.Fatal(err)
		}
	}
	events, err := s.Snapshot(now)
	if err != nil || len(events) != 1 || events[0].Reason != "Opened" {
		t.Fatalf("same-millisecond ordering: %v %v", events, err)
	}
}
