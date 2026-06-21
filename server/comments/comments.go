package comments

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Store struct {
	path       string
	threadPath string
	draftPath  string
	mu         sync.Mutex
}

type Filters struct {
	Path   string
	Status string
}

type ActivityFilters struct {
	ThreadID string
	After    string
	First    int
}

func NewStore(dataDir string) (*Store, error) {
	if dataDir == "" {
		dataDir = defaultDataDir()
	}
	return &Store{path: filepath.Join(dataDir, "comments.jsonl"), threadPath: filepath.Join(dataDir, "comment-threads.jsonl"), draftPath: filepath.Join(dataDir, "comment-drafts.jsonl")}, nil
}

func (store *Store) List(filters Filters) ([]map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	threads, err := store.projectThreads(comments)
	if err != nil {
		return nil, err
	}
	statusByThread := map[string]string{}
	for _, thread := range threads {
		statusByThread[stringValue(thread["id"])] = stringValue(thread["status"])
	}
	filtered := []map[string]any{}
	for _, comment := range comments {
		threadID := threadIDForComment(comment)
		comment["threadId"] = threadID
		comment["status"] = statusByThread[threadID]
		if comment["source"] == nil {
			comment["source"] = "unknown"
		}
		if filters.Path != "" && comment["path"] != filters.Path {
			continue
		}
		if filters.Status != "" && comment["status"] != filters.Status {
			continue
		}
		filtered = append(filtered, comment)
	}
	return filtered, nil
}

func (store *Store) ListThreads(filters Filters) ([]map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	threads, err := store.projectThreads(comments)
	if err != nil {
		return nil, err
	}
	filtered := []map[string]any{}
	for _, thread := range threads {
		if filters.Path != "" && thread["path"] != filters.Path {
			continue
		}
		if filters.Status != "" && thread["status"] != filters.Status {
			continue
		}
		filtered = append(filtered, thread)
	}
	return filtered, nil
}

func (store *Store) Create(input map[string]any, fileHash, viewerKind string) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	comment, err := store.publicCommentFromInput(input, fileHash, viewerKind, now, "")
	if err != nil {
		return nil, err
	}
	id := stringValue(comment["id"])
	if _, ok := comment["source"].(string); !ok {
		comment["source"] = "unknown"
	}
	if threadID, ok := comment["threadId"].(string); !ok || strings.TrimSpace(threadID) == "" {
		comment["threadId"] = id
	}
	if _, ok := comment["status"].(string); !ok {
		comment["status"] = "open"
	}
	comment["createdAt"] = now
	comment["updatedAt"] = now
	addFileHash(comment, fileHash)
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	comments = append(comments, comment)
	if err := store.writeAll(comments); err != nil {
		return nil, err
	}
	if stringValue(input["threadId"]) == "" {
		thread := map[string]any{"id": comment["threadId"], "path": comment["path"], "anchor": comment["anchor"], "status": comment["status"], "createdAt": now, "updatedAt": now}
		if err := store.appendThreadEvent(map[string]any{"schemaVersion": 1, "type": "thread.created", "threadId": comment["threadId"], "at": now, "thread": thread, "actor": actorForComment(comment)}); err != nil {
			return nil, err
		}
	} else if err := store.appendThreadEvent(map[string]any{"schemaVersion": 1, "type": "comment.added", "threadId": comment["threadId"], "commentId": id, "at": now, "actor": actorForComment(comment)}); err != nil {
		return nil, err
	}
	return comment, nil
}

func (store *Store) ListDrafts(filters Filters) ([]map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	drafts, err := store.readDrafts()
	if err != nil {
		return nil, err
	}
	filtered := []map[string]any{}
	for _, draft := range drafts {
		if filters.Path != "" && draft["path"] != filters.Path {
			continue
		}
		filtered = append(filtered, draft)
	}
	return filtered, nil
}

func (store *Store) CreateDraft(input map[string]any, fileHash, viewerKind string) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	draft, err := store.draftFromInput(input, fileHash, viewerKind, now)
	if err != nil {
		return nil, err
	}
	drafts, err := store.readDrafts()
	if err != nil {
		return nil, err
	}
	drafts = append(drafts, draft)
	if err := store.writeDrafts(drafts); err != nil {
		return nil, err
	}
	return draft, nil
}

func (store *Store) UpdateDraft(id string, input map[string]any) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("draft comment id is required")
	}
	drafts, err := store.readDrafts()
	if err != nil {
		return nil, err
	}
	for index, draft := range drafts {
		if draft["id"] != id {
			continue
		}
		if body, ok := input["body"].(string); ok {
			if strings.TrimSpace(body) == "" {
				return nil, errors.New("body is required")
			}
			draft["body"] = strings.TrimSpace(body)
		}
		draft["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		drafts[index] = draft
		return draft, store.writeDrafts(drafts)
	}
	return nil, errors.New("draft comment not found")
}

func (store *Store) DeleteDraft(id string) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("draft comment id is required")
	}
	drafts, err := store.readDrafts()
	if err != nil {
		return nil, err
	}
	next := make([]map[string]any, 0, len(drafts))
	var deleted map[string]any
	for _, draft := range drafts {
		if draft["id"] == id {
			deleted = draft
			continue
		}
		next = append(next, draft)
	}
	if deleted == nil {
		return nil, errors.New("draft comment not found")
	}
	return deleted, store.writeDrafts(next)
}

func (store *Store) PublishDrafts(ids []string, actor map[string]any) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	drafts, err := store.readDrafts()
	if err != nil {
		return nil, err
	}
	selected, remaining := selectDrafts(drafts, ids)
	if len(selected) == 0 {
		return nil, errors.New("no draft comments to publish")
	}
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	reviewBatchID := "review-batch-" + randomID()
	published := make([]map[string]any, 0, len(selected))
	batchActor := normalizeActor(actor)
	for _, draft := range selected {
		comment, err := store.publicCommentFromInput(draft, stringValue(mapValue(mapValue(draft["anchor"])["canonical"])["fileHash"]), stringValue(draft["viewerKind"]), now, reviewBatchID)
		if err != nil {
			return nil, err
		}
		comment["actor"] = actorForDraft(draft, batchActor)
		comment["author"] = stringValue(draft["author"])
		comment["source"] = stringValue(draft["source"])
		published = append(published, comment)
		comments = append(comments, comment)
	}
	for _, comment := range published {
		thread := map[string]any{"id": comment["threadId"], "path": comment["path"], "anchor": comment["anchor"], "status": comment["status"], "createdAt": now, "updatedAt": now, "reviewBatchId": reviewBatchID}
		if err := store.appendThreadEvent(map[string]any{"schemaVersion": 1, "type": "thread.created", "threadId": comment["threadId"], "at": now, "thread": thread, "actor": actorForComment(comment), "reviewBatchId": reviewBatchID}); err != nil {
			return nil, err
		}
	}
	if err := store.writeAll(comments); err != nil {
		return nil, err
	}
	if err := store.writeDrafts(remaining); err != nil {
		return nil, err
	}
	threads, err := store.projectThreads(published)
	if err != nil {
		return nil, err
	}
	return map[string]any{"reviewBatchId": reviewBatchID, "publishedAt": now, "threads": threads}, nil
}

func (store *Store) Update(id string, input map[string]any) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("comment id is required")
	}
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	for index, comment := range comments {
		if comment["id"] != id {
			continue
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if body, ok := input["body"].(string); ok {
			comment["body"] = strings.TrimSpace(body)
			if err := store.appendThreadEvent(map[string]any{"schemaVersion": 1, "type": "comment.updated", "threadId": threadIDForComment(comment), "commentId": id, "at": now, "actor": actorFromInput(input)}); err != nil {
				return nil, err
			}
		}
		if status, ok := input["status"].(string); ok {
			if _, err := store.updateThreadStatusLocked(threadIDForComment(comment), status, now, comments, actorFromInput(input)); err != nil {
				return nil, err
			}
			comment["status"] = status
		}
		comment["updatedAt"] = now
		comments[index] = comment
		return comment, store.writeAll(comments)
	}
	return nil, errors.New("comment not found")
}

func (store *Store) UpdateThreadStatus(id, status string) (map[string]any, error) {
	return store.UpdateThreadStatusAs(id, status, unknownActor())
}

func (store *Store) UpdateThreadStatusAs(id, status string, actor map[string]any) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return store.updateThreadStatusLocked(id, status, now, comments, normalizeActor(actor))
}

func (store *Store) updateThreadStatusLocked(id, status, now string, comments []map[string]any, actor map[string]any) (map[string]any, error) {
	if id == "" {
		return nil, errors.New("comment thread id is required")
	}
	if status != "open" && status != "resolved" && status != "archived" {
		return nil, errors.New("invalid comment thread status")
	}
	threads, err := store.projectThreads(comments)
	if err != nil {
		return nil, err
	}
	var current map[string]any
	for _, thread := range threads {
		if thread["id"] == id {
			current = thread
			break
		}
	}
	if current == nil {
		return nil, errors.New("comment thread not found")
	}
	from := stringValue(current["status"])
	if !validTransition(from, status) {
		return nil, errors.New("invalid comment thread status transition")
	}
	if from != status {
		if err := store.appendThreadEvent(map[string]any{"schemaVersion": 1, "type": "thread.status_changed", "threadId": id, "previousStatus": from, "status": status, "at": now, "actor": actor}); err != nil {
			return nil, err
		}
	}
	current["status"] = status
	current["updatedAt"] = now
	delete(current, "resolvedAt")
	delete(current, "archivedAt")
	if status == "resolved" {
		current["resolvedAt"] = now
	}
	if status == "archived" {
		current["archivedAt"] = now
	}
	for _, item := range current["comments"].([]map[string]any) {
		item["status"] = status
		delete(item, "resolvedAt")
		delete(item, "archivedAt")
		if status == "resolved" {
			item["resolvedAt"] = now
		}
		if status == "archived" {
			item["archivedAt"] = now
		}
	}
	return current, nil
}

func (store *Store) AppendThreadReadActivity(threadID string, actor map[string]any, clientEventID string) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if strings.TrimSpace(threadID) == "" {
		return nil, errors.New("comment thread id is required")
	}
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	threads, err := store.projectThreads(comments)
	if err != nil {
		return nil, err
	}
	found := false
	for _, thread := range threads {
		if stringValue(thread["id"]) == threadID {
			found = true
			break
		}
	}
	if !found {
		return nil, errors.New("comment thread not found")
	}
	normalizedActor := normalizeActor(actor)
	if stringValue(normalizedActor["id"]) == "unknown" {
		return nil, errors.New("activity actor id is required")
	}
	if clientEventID != "" {
		events, err := store.readThreadEvents()
		if err != nil {
			return nil, err
		}
		for index, persisted := range events {
			activity := publicActivity(persisted, index)
			activityActor, _ := activity["actor"].(map[string]any)
			if activity["threadId"] == threadID && activity["type"] == "thread_read" && activity["clientEventId"] == clientEventID && activityActor["id"] == normalizedActor["id"] {
				return activity, nil
			}
		}
	}
	event := map[string]any{"schemaVersion": 1, "type": "thread.read", "threadId": threadID, "actor": normalizedActor, "clientEventId": strings.TrimSpace(clientEventID), "at": time.Now().UTC().Format(time.RFC3339Nano)}
	if err := store.appendThreadEvent(event); err != nil {
		return nil, err
	}
	return publicActivity(event, 0), nil
}

func (store *Store) ListActivities(filters ActivityFilters) ([]map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.listActivitiesLocked(filters)
}

func (store *Store) listActivitiesLocked(filters ActivityFilters) ([]map[string]any, error) {
	events, err := store.readThreadEvents()
	if err != nil {
		return nil, err
	}
	first := filters.First
	if first <= 0 || first > 500 {
		first = 100
	}
	result := []map[string]any{}
	afterSeen := filters.After == ""
	for index, event := range events {
		activity := publicActivity(event, index)
		if stringValue(activity["threadId"]) != filters.ThreadID {
			continue
		}
		if !afterSeen {
			if stringValue(activity["id"]) == filters.After {
				afterSeen = true
			}
			continue
		}
		result = append(result, activity)
		if len(result) == first {
			break
		}
	}
	return result, nil
}

func (store *Store) ExportJSONL(filters Filters) (string, error) {
	threads, err := store.ListThreads(filters)
	if err != nil {
		return "", err
	}
	lines := []string{}
	for _, thread := range threads {
		exported := copyMap(thread)
		exported["schemaVersion"] = 2
		exported["type"] = "commentThread"
		bytes, err := json.Marshal(exported)
		if err != nil {
			return "", err
		}
		lines = append(lines, string(bytes))
	}
	return strings.Join(lines, "\n"), nil
}

func (store *Store) projectThreads(comments []map[string]any) ([]map[string]any, error) {
	threads := []map[string]any{}
	byID := map[string]map[string]any{}
	for _, comment := range comments {
		id := threadIDForComment(comment)
		comment["threadId"] = id
		if comment["source"] == nil {
			comment["source"] = "unknown"
		}
		thread := byID[id]
		if thread == nil {
			thread = map[string]any{"id": id, "path": comment["path"], "anchor": comment["anchor"], "status": normalizedStatus(comment["status"]), "createdAt": comment["createdAt"], "updatedAt": comment["updatedAt"], "reviewBatchId": comment["reviewBatchId"], "comments": []map[string]any{}}
			byID[id] = thread
			threads = append(threads, thread)
		}
		if thread["reviewBatchId"] == nil && comment["reviewBatchId"] != nil {
			thread["reviewBatchId"] = comment["reviewBatchId"]
		}
		if value := stringValue(comment["resolvedAt"]); value > stringValue(thread["resolvedAt"]) {
			thread["resolvedAt"] = value
		}
		if value := stringValue(comment["archivedAt"]); value > stringValue(thread["archivedAt"]) {
			thread["archivedAt"] = value
		}
		thread["comments"] = append(thread["comments"].([]map[string]any), comment)
		if stringValue(comment["updatedAt"]) > stringValue(thread["updatedAt"]) {
			thread["updatedAt"] = comment["updatedAt"]
		}
		if statusRank(normalizedStatus(comment["status"])) > statusRank(stringValue(thread["status"])) {
			thread["status"] = normalizedStatus(comment["status"])
		}
	}
	events, err := store.readThreadEvents()
	if err != nil {
		return nil, err
	}
	for _, event := range events {
		switch stringValue(event["type"]) {
		case "thread.created":
			metadata, _ := event["thread"].(map[string]any)
			id := stringValue(metadata["id"])
			thread := byID[id]
			if thread != nil {
				for _, key := range []string{"path", "anchor", "status", "createdAt", "updatedAt", "reviewBatchId"} {
					if metadata[key] != nil {
						thread[key] = metadata[key]
					}
				}
			}
		case "thread.status_changed":
			thread := byID[stringValue(event["threadId"])]
			if thread == nil {
				continue
			}
			status := normalizedStatus(event["status"])
			at := stringValue(event["at"])
			thread["status"] = status
			thread["updatedAt"] = at
			delete(thread, "resolvedAt")
			delete(thread, "archivedAt")
			if status == "resolved" {
				thread["resolvedAt"] = at
			}
			if status == "archived" {
				thread["archivedAt"] = at
			}
		}
	}
	for _, thread := range threads {
		status := stringValue(thread["status"])
		resolvedAt := stringValue(thread["resolvedAt"])
		archivedAt := stringValue(thread["archivedAt"])
		for _, comment := range thread["comments"].([]map[string]any) {
			comment["status"] = status
			delete(comment, "resolvedAt")
			delete(comment, "archivedAt")
			if resolvedAt != "" {
				comment["resolvedAt"] = resolvedAt
			}
			if archivedAt != "" {
				comment["archivedAt"] = archivedAt
			}
		}
	}
	return threads, nil
}

func (store *Store) publicCommentFromInput(input map[string]any, fileHash, viewerKind, now, reviewBatchID string) (map[string]any, error) {
	pathValue, _ := input["path"].(string)
	body, _ := input["body"].(string)
	if strings.TrimSpace(pathValue) == "" {
		return nil, errors.New("path is required")
	}
	if strings.TrimSpace(body) == "" {
		return nil, errors.New("body is required")
	}
	comment := copyMap(input)
	comment["id"] = randomID()
	comment["path"] = strings.TrimSpace(pathValue)
	comment["body"] = strings.TrimSpace(body)
	comment["viewerKind"] = viewerKind
	if threadID, ok := comment["threadId"].(string); !ok || strings.TrimSpace(threadID) == "" {
		comment["threadId"] = comment["id"]
	}
	if _, ok := comment["status"].(string); !ok {
		comment["status"] = "open"
	}
	comment["createdAt"] = now
	comment["updatedAt"] = now
	if reviewBatchID != "" {
		comment["reviewBatchId"] = reviewBatchID
	}
	addFileHash(comment, fileHash)
	return comment, nil
}

func (store *Store) draftFromInput(input map[string]any, fileHash, viewerKind, now string) (map[string]any, error) {
	pathValue, _ := input["path"].(string)
	body, _ := input["body"].(string)
	if strings.TrimSpace(pathValue) == "" {
		return nil, errors.New("path is required")
	}
	if strings.TrimSpace(body) == "" {
		return nil, errors.New("body is required")
	}
	draft := copyMap(input)
	draft["id"] = randomID()
	draft["path"] = strings.TrimSpace(pathValue)
	draft["body"] = strings.TrimSpace(body)
	draft["viewerKind"] = viewerKind
	if _, ok := draft["source"].(string); !ok {
		draft["source"] = "human"
	}
	draft["createdAt"] = now
	draft["updatedAt"] = now
	addFileHash(draft, fileHash)
	return draft, nil
}

func selectDrafts(drafts []map[string]any, ids []string) ([]map[string]any, []map[string]any) {
	if len(ids) == 0 {
		return drafts, []map[string]any{}
	}
	wanted := map[string]struct{}{}
	for _, id := range ids {
		wanted[id] = struct{}{}
	}
	selected := []map[string]any{}
	remaining := []map[string]any{}
	for _, draft := range drafts {
		if _, ok := wanted[stringValue(draft["id"])]; ok {
			selected = append(selected, draft)
		} else {
			remaining = append(remaining, draft)
		}
	}
	return selected, remaining
}

func actorForDraft(draft map[string]any, fallback map[string]any) map[string]any {
	if actor, ok := draft["actor"].(map[string]any); ok && stringValue(actor["id"]) != "" {
		return normalizeActor(actor)
	}
	if stringValue(fallback["id"]) != "unknown" {
		return fallback
	}
	return normalizeActor(map[string]any{"kind": draft["source"], "displayName": draft["author"]})
}

func (store *Store) readThreadEvents() ([]map[string]any, error) {
	file, err := os.Open(store.threadPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	defer file.Close()
	events := []map[string]any{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, scanner.Err()
}

func (store *Store) appendThreadEvent(event map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(store.threadPath), 0o755); err != nil {
		return err
	}
	if stringValue(event["id"]) == "" {
		event["id"] = randomID()
	}
	if stringValue(event["at"]) == "" {
		event["at"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	actor, _ := event["actor"].(map[string]any)
	event["actor"] = normalizeActor(actor)
	file, err := os.OpenFile(store.threadPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewEncoder(file).Encode(event)
}

func publicActivity(event map[string]any, index int) map[string]any {
	eventType := strings.ReplaceAll(stringValue(event["type"]), ".", "_")
	threadID := stringValue(event["threadId"])
	if threadID == "" {
		if thread, ok := event["thread"].(map[string]any); ok {
			threadID = stringValue(thread["id"])
		}
	}
	id := stringValue(event["id"])
	if id == "" {
		id = "legacy-activity-" + time.Unix(0, int64(index)).UTC().Format("150405.000000000")
	}
	actor, _ := event["actor"].(map[string]any)
	return map[string]any{"id": id, "threadId": threadID, "type": eventType, "actor": normalizeActor(actor), "commentId": event["commentId"], "previousStatus": event["previousStatus"], "status": event["status"], "clientEventId": event["clientEventId"], "createdAt": stringValue(event["at"])}
}

func actorFromInput(input map[string]any) map[string]any {
	if actor, ok := input["actor"].(map[string]any); ok {
		return normalizeActor(actor)
	}
	return normalizeActor(map[string]any{"kind": input["source"], "displayName": input["author"]})
}
func actorForComment(comment map[string]any) map[string]any { return actorFromInput(comment) }
func unknownActor() map[string]any                          { return map[string]any{"id": "unknown", "kind": "unknown"} }
func normalizeActor(actor map[string]any) map[string]any {
	kind := strings.ReplaceAll(stringValue(actor["kind"]), "-", "_")
	if kind != "human" && kind != "claude_code" && kind != "codex" {
		kind = "unknown"
	}
	id := strings.TrimSpace(stringValue(actor["id"]))
	displayName := strings.TrimSpace(stringValue(actor["displayName"]))
	if id == "" {
		id = kind
		if displayName != "" {
			id = kind + ":" + displayName
		}
	}
	result := map[string]any{"id": id, "kind": kind}
	if displayName != "" {
		result["displayName"] = displayName
	}
	return result
}

func threadIDForComment(comment map[string]any) string {
	if id := stringValue(comment["threadId"]); id != "" {
		return id
	}
	return stringValue(comment["id"])
}
func stringValue(value any) string { text, _ := value.(string); return text }
func mapValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}
func normalizedStatus(value any) string {
	status := stringValue(value)
	if status == "resolved" || status == "archived" {
		return status
	}
	return "open"
}
func validTransition(from, to string) bool {
	if from == to {
		return true
	}
	if from == "open" {
		return to == "resolved" || to == "archived"
	}
	if from == "resolved" {
		return to == "open" || to == "archived"
	}
	return from == "archived" && to == "open"
}
func statusRank(status string) int {
	if status == "open" {
		return 3
	}
	if status == "resolved" {
		return 2
	}
	return 1
}

func (store *Store) readAll() ([]map[string]any, error) {
	file, err := os.Open(store.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	defer file.Close()
	comments := []map[string]any{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var comment map[string]any
		if err := json.Unmarshal([]byte(line), &comment); err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	return comments, scanner.Err()
}

func (store *Store) readDrafts() ([]map[string]any, error) {
	file, err := os.Open(store.draftPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	defer file.Close()
	drafts := []map[string]any{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var draft map[string]any
		if err := json.Unmarshal([]byte(line), &draft); err != nil {
			return nil, err
		}
		drafts = append(drafts, draft)
	}
	return drafts, scanner.Err()
}

func (store *Store) writeAll(comments []map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(store.path), 0o755); err != nil {
		return err
	}
	tmp := store.path + ".tmp"
	file, err := os.Create(tmp)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	for _, comment := range comments {
		if err := encoder.Encode(comment); err != nil {
			file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, store.path)
}

func (store *Store) writeDrafts(drafts []map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(store.draftPath), 0o755); err != nil {
		return err
	}
	tmp := store.draftPath + ".tmp"
	file, err := os.Create(tmp)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	for _, draft := range drafts {
		if err := encoder.Encode(draft); err != nil {
			file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, store.draftPath)
}

func addFileHash(comment map[string]any, fileHash string) {
	anchor, ok := comment["anchor"].(map[string]any)
	if !ok {
		return
	}
	canonical, ok := anchor["canonical"].(map[string]any)
	if !ok {
		return
	}
	if canonical["fileHash"] == nil {
		canonical["fileHash"] = fileHash
	}
}

func copyMap(input map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range input {
		output[key] = value
	}
	return output
}

func randomID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(bytes[:])
}

func defaultDataDir() string {
	if value := os.Getenv("VIVI_DATA_DIR"); value != "" {
		return value
	}
	if value := os.Getenv("XDG_DATA_HOME"); value != "" {
		return filepath.Join(value, "vivi")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "vivi")
	}
	return filepath.Join(home, ".local", "share", "vivi")
}
