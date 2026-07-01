package reviewledger

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const DefaultReceiptRetention = 24 * time.Hour

type Store struct {
	path      string
	mu        sync.Mutex
	retention time.Duration
}

type Snapshot struct {
	Decisions []Decision `json:"decisions"`
	Receipts  []Receipt  `json:"receipts"`
}

type Decision struct {
	Path        string `json:"path"`
	Fingerprint string `json:"fingerprint"`
	Reason      string `json:"reason"`
	CreatedAt   string `json:"createdAt"`
}

type Receipt struct {
	ID           string   `json:"id"`
	Path         string   `json:"path"`
	Reason       string   `json:"reason"`
	CreatedAt    string   `json:"createdAt"`
	VisibleUntil string   `json:"visibleUntil"`
	Fingerprint  string   `json:"fingerprint,omitempty"`
	ThreadIDs    []string `json:"threadIds,omitempty"`
}

func NewStore(dataDir string) (*Store, error) {
	return &Store{
		path:      filepath.Join(dataDir, "review-ledger.jsonl"),
		retention: DefaultReceiptRetention,
	}, nil
}

func (store *Store) Snapshot(now time.Time) (Snapshot, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	snapshot, err := store.read()
	if err != nil {
		return Snapshot{}, err
	}
	compacted := compact(snapshot, now, store.retention)
	if !equalSnapshot(snapshot, compacted) {
		if err := store.write(compacted); err != nil {
			return Snapshot{}, err
		}
	}
	return compacted, nil
}

func (store *Store) Save(snapshot Snapshot, now time.Time) (Snapshot, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	compacted := compact(snapshot, now, store.retention)
	if err := store.write(compacted); err != nil {
		return Snapshot{}, err
	}
	return compacted, nil
}

func (store *Store) read() (Snapshot, error) {
	file, err := os.Open(store.path)
	if err != nil {
		if os.IsNotExist(err) {
			return Snapshot{}, nil
		}
		return Snapshot{}, err
	}
	defer file.Close()

	snapshot := Snapshot{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var event ledgerEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		if event.Type == "review_decision" && validDecision(event.Decision) {
			snapshot.Decisions = append(snapshot.Decisions, event.Decision)
		}
		if event.Type == "review_receipt" && validReceipt(event.Receipt) {
			snapshot.Receipts = append(snapshot.Receipts, event.Receipt)
		}
	}
	if err := scanner.Err(); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (store *Store) write(snapshot Snapshot) error {
	if err := os.MkdirAll(filepath.Dir(store.path), 0o755); err != nil {
		return err
	}
	tempPath := store.path + ".tmp"
	file, err := os.Create(tempPath)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	for _, decision := range snapshot.Decisions {
		if err := encoder.Encode(ledgerEvent{Type: "review_decision", Decision: decision}); err != nil {
			_ = file.Close()
			return err
		}
	}
	for _, receipt := range snapshot.Receipts {
		if err := encoder.Encode(ledgerEvent{Type: "review_receipt", Receipt: receipt}); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, store.path)
}

type ledgerEvent struct {
	Type     string   `json:"type"`
	Decision Decision `json:"decision,omitempty"`
	Receipt  Receipt  `json:"receipt,omitempty"`
}

func compact(snapshot Snapshot, now time.Time, retention time.Duration) Snapshot {
	decisions := map[string]Decision{}
	for _, decision := range snapshot.Decisions {
		if !validDecision(decision) {
			continue
		}
		decisions[decision.Path+"\x1f"+decision.Fingerprint] = decision
	}
	receipts := map[string]Receipt{}
	cutoff := now.Add(-retention)
	for _, receipt := range snapshot.Receipts {
		if !validReceipt(receipt) {
			continue
		}
		visibleUntil, err := time.Parse(time.RFC3339Nano, receipt.VisibleUntil)
		if err != nil || visibleUntil.Before(cutoff) {
			continue
		}
		receipts[receipt.ID] = receipt
	}
	return Snapshot{
		Decisions: mapValues(decisions),
		Receipts:  mapValues(receipts),
	}
}

func validDecision(decision Decision) bool {
	return decision.Path != "" && decision.Fingerprint != "" && decision.CreatedAt != "" && (decision.Reason == "accepted_change" || decision.Reason == "threads_resolved")
}

func validReceipt(receipt Receipt) bool {
	return receipt.ID != "" && receipt.Path != "" && receipt.CreatedAt != "" && receipt.VisibleUntil != "" && (receipt.Reason == "accepted_change" || receipt.Reason == "threads_resolved" || receipt.Reason == "drafts_cleared" || receipt.Reason == "change_disappeared")
}

func mapValues[T any](items map[string]T) []T {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	values := make([]T, 0, len(items))
	for _, key := range keys {
		values = append(values, items[key])
	}
	return values
}

func equalSnapshot(left, right Snapshot) bool {
	leftJSON, _ := json.Marshal(left)
	rightJSON, _ := json.Marshal(right)
	return string(leftJSON) == string(rightJSON)
}
