package reviewledger

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreCompactsReceiptsButKeepsDecisions(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	oldVisibleUntil := now.Add(-48 * time.Hour).Format(time.RFC3339Nano)
	recentVisibleUntil := now.Add(10 * time.Minute).Format(time.RFC3339Nano)

	snapshot, err := store.Save(Snapshot{
		Decisions: []Decision{
			{
				Path:        "src/app.ts",
				Fingerprint: "fingerprint-current",
				Reason:      "accepted_change",
				CreatedAt:   now.Format(time.RFC3339Nano),
			},
		},
		Receipts: []Receipt{
			{
				ID:           "old-receipt",
				Path:         "src/old.ts",
				Reason:       "threads_resolved",
				CreatedAt:    now.Add(-72 * time.Hour).Format(time.RFC3339Nano),
				VisibleUntil: oldVisibleUntil,
			},
			{
				ID:           "recent-receipt",
				Path:         "src/app.ts",
				Reason:       "accepted_change",
				CreatedAt:    now.Format(time.RFC3339Nano),
				VisibleUntil: recentVisibleUntil,
				Fingerprint:  "fingerprint-current",
			},
		},
	}, now)
	if err != nil {
		t.Fatal(err)
	}

	if len(snapshot.Decisions) != 1 {
		t.Fatalf("decisions = %#v, want one retained decision", snapshot.Decisions)
	}
	if len(snapshot.Receipts) != 1 || snapshot.Receipts[0].ID != "recent-receipt" {
		t.Fatalf("receipts = %#v, want only recent receipt", snapshot.Receipts)
	}
	contents, err := os.ReadFile(filepath.Join(filepath.Dir(store.path), "review-ledger.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(contents), "old-receipt") {
		t.Fatalf("compacted ledger still contains old receipt:\n%s", contents)
	}

	loaded, err := store.Snapshot(now)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Decisions) != 1 || len(loaded.Receipts) != 1 {
		t.Fatalf("loaded snapshot = %#v", loaded)
	}
}
