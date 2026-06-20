package application

import (
	"context"
	"fmt"
	"sync"

	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	"github.com/tasuku43/vivi/server/workspace"
)

type WorkspaceService struct{ workspace *workspace.FS }
type FileService struct{ workspace *workspace.FS }
type SearchService struct{ workspace *workspace.FS }
type ReviewService struct{ git *gitreview.Reviewer }
type PreviewService struct{ workspace *workspace.FS }

func (s *WorkspaceService) Config() workspace.Config { return s.workspace.Config() }
func (s *WorkspaceService) ReadTree(relativePath string, depth int) (workspace.TreeSnapshot, error) {
	if relativePath != "" || depth > 0 {
		if depth <= 0 {
			depth = 1
		}
		return s.workspace.ReadDirectory(relativePath, depth)
	}
	return s.workspace.ReadTree()
}
func (s *FileService) ReadFile(path string) (workspace.FilePayload, error) {
	return s.workspace.ReadFile(path)
}
func (s *SearchService) SearchFiles(query string, limit int) (workspace.FileSearchResponse, error) {
	return s.workspace.SearchFiles(query, limit)
}
func (s *SearchService) SearchText(query string, limit int) (workspace.TextSearchResponse, error) {
	return s.workspace.SearchText(query, limit)
}
func (s *ReviewService) ReadChanges(ctx context.Context) gitreview.Summary {
	return s.git.ReadChanges(ctx)
}
func (s *ReviewService) ReadDiffBases(ctx context.Context) gitreview.DiffBaseSummary {
	return s.git.ReadDiffBases(ctx)
}
func (s *ReviewService) ReadDiff(ctx context.Context, path, base string) gitreview.TextDiff {
	return s.git.ReadDiff(ctx, path, base)
}
func (s *PreviewService) Config() workspace.Config { return s.workspace.Config() }

type CommentService struct {
	workspace *workspace.FS
	comments  *comments.Store
}

func (s *CommentService) List(filters comments.Filters) ([]map[string]any, error) {
	return s.comments.List(filters)
}
func (s *CommentService) Threads(filters comments.Filters) ([]CommentThread, error) {
	items, err := s.List(filters)
	if err != nil {
		return nil, err
	}
	threads := []CommentThread{}
	indexByID := map[string]int{}
	for _, item := range items {
		id := stringValue(item["threadId"])
		if id == "" {
			id = stringValue(item["id"])
		}
		if id == "" {
			id = fmt.Sprintf("comment-thread-%d", len(threads)+1)
		}
		index, ok := indexByID[id]
		if !ok {
			threads = append(threads, CommentThread{ID: id, Path: stringValue(item["path"]), Status: stringValue(item["status"]), Anchor: item["anchor"], UpdatedAt: stringValue(item["updatedAt"]), Comments: []map[string]any{}})
			index = len(threads) - 1
			indexByID[id] = index
		}
		threads[index].Comments = append(threads[index].Comments, item)
		if updated := stringValue(item["updatedAt"]); updated > threads[index].UpdatedAt {
			threads[index].UpdatedAt = updated
		}
		if stringValue(item["status"]) == "open" {
			threads[index].Status = "open"
		}
	}
	return threads, nil
}
func (s *CommentService) Create(input map[string]any) (map[string]any, error) {
	file, err := s.workspace.ReadFile(stringValue(input["path"]))
	if err != nil {
		return nil, err
	}
	return s.comments.Create(input, file.Etag, file.ViewerKind)
}
func (s *CommentService) Update(id string, input map[string]any) (map[string]any, error) {
	return s.comments.Update(id, input)
}
func (s *CommentService) UpdateThread(id, status string) (CommentThread, error) {
	if id == "" {
		return CommentThread{}, fmt.Errorf("comment thread id is required")
	}
	if status == "" {
		return CommentThread{}, fmt.Errorf("comment thread status is required")
	}
	items, err := s.List(comments.Filters{})
	if err != nil {
		return CommentThread{}, err
	}
	updated := false
	for _, item := range items {
		threadID := stringValue(item["threadId"])
		if threadID == "" {
			threadID = stringValue(item["id"])
		}
		if threadID != id {
			continue
		}
		if _, err := s.Update(stringValue(item["id"]), map[string]any{"status": status}); err != nil {
			return CommentThread{}, err
		}
		updated = true
	}
	if !updated {
		return CommentThread{}, fmt.Errorf("comment thread not found")
	}
	threads, err := s.Threads(comments.Filters{})
	if err != nil {
		return CommentThread{}, err
	}
	for _, thread := range threads {
		if thread.ID == id {
			return thread, nil
		}
	}
	return CommentThread{}, fmt.Errorf("comment thread not found")
}
func (s *CommentService) Export(filters comments.Filters) (string, error) {
	return s.comments.ExportJSONL(filters)
}

type EventService struct {
	mu          sync.Mutex
	subscribers map[chan WorkspaceEvent]struct{}
	version     int
}

func NewEventService() *EventService {
	return &EventService{subscribers: map[chan WorkspaceEvent]struct{}{}, version: 1}
}
func (s *EventService) Subscribe() (<-chan WorkspaceEvent, func()) {
	events := make(chan WorkspaceEvent, 32)
	s.mu.Lock()
	s.subscribers[events] = struct{}{}
	s.mu.Unlock()
	return events, func() {
		s.mu.Lock()
		if _, ok := s.subscribers[events]; ok {
			delete(s.subscribers, events)
			close(events)
		}
		s.mu.Unlock()
	}
}
func (s *EventService) Publish(event WorkspaceEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.version++
	event.Version = s.version
	for subscriber := range s.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}
