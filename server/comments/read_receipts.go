package comments

import "time"

// ReadReceipt is the first agent observation of the current human feedback.
// Reading the journal also recovers receipts written by older server processes.
type ReadReceipt struct {
	Path string
	At   time.Time
}

func (store *Store) RecentReadReceipts(since time.Time) ([]ReadReceipt, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	records, err := store.readAll()
	if err != nil {
		return nil, err
	}
	threads, err := store.projectThreads(records)
	if err != nil {
		return nil, err
	}
	paths := map[string]string{}
	latest := map[string]time.Time{}
	for _, thread := range threads {
		if stringValue(thread["status"]) != "open" {
			continue
		}
		id := stringValue(thread["id"])
		items, _ := thread["comments"].([]map[string]any)
		for _, c := range items {
			if stringValue(actorForComment(c)["kind"]) != "human" {
				continue
			}
			stamp := stringValue(c["updatedAt"])
			if stamp == "" {
				stamp = stringValue(c["createdAt"])
			}
			at, err := time.Parse(time.RFC3339Nano, stamp)
			if err == nil && at.After(latest[id]) {
				latest[id] = at
				paths[id] = stringValue(thread["path"])
			}
		}
	}
	events, err := store.readThreadEvents()
	if err != nil {
		return nil, err
	}
	first := map[string]time.Time{}
	for _, e := range events {
		id := stringValue(e["threadId"])
		if stringValue(e["type"]) != "thread.read" || paths[id] == "" {
			continue
		}
		actor, _ := e["actor"].(map[string]any)
		kind := stringValue(normalizeActor(actor)["kind"])
		if kind != "codex" && kind != "claude_code" {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, stringValue(e["at"]))
		if err != nil || at.Before(latest[id]) {
			continue
		}
		if first[id].IsZero() || at.Before(first[id]) {
			first[id] = at
		}
	}
	result := []ReadReceipt{}
	for id, at := range first {
		if at.After(since) {
			result = append(result, ReadReceipt{Path: paths[id], At: at})
		}
	}
	return result, nil
}

// threadSeenBy compares receipts with the latest human feedback, so a follow-up
// becomes unseen again while agent-authored history does not reset attention.
func threadSeenBy(thread map[string]any, events []map[string]any, actorID string) bool {
	latest := time.Time{}
	items, _ := thread["comments"].([]map[string]any)
	for _, c := range items {
		if stringValue(actorForComment(c)["kind"]) != "human" {
			continue
		}
		stamp := stringValue(c["updatedAt"])
		if stamp == "" {
			stamp = stringValue(c["createdAt"])
		}
		at, err := time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			return false
		}
		if at.After(latest) {
			latest = at
		}
	}
	if latest.IsZero() {
		return false
	}
	for _, e := range events {
		if e["threadId"] != thread["id"] || e["type"] != "thread.read" {
			continue
		}
		actor, _ := e["actor"].(map[string]any)
		if stringValue(normalizeActor(actor)["id"]) != actorID {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, stringValue(e["at"]))
		if err == nil && !at.Before(latest) {
			return true
		}
	}
	return false
}
