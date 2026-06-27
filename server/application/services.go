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
func (s *CommentService) ListDrafts(filters comments.Filters) ([]map[string]any, error) {
	return s.comments.ListDrafts(filters)
}
func (s *CommentService) Threads(filters comments.Filters) ([]CommentThread, error) {
	items, err := s.comments.ListThreads(filters)
	if err != nil {
		return nil, err
	}
	threads := []CommentThread{}
	for _, item := range items {
		threads = append(threads, threadFromMap(item))
	}
	return threads, nil
}
func (s *CommentService) Thread(id string) (CommentThread, error) {
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
func (s *CommentService) Create(input map[string]any) (map[string]any, error) {
	file, err := s.workspace.ReadFile(stringValue(input["path"]))
	if err != nil {
		return nil, err
	}
	return s.comments.Create(input, file.Etag, file.ViewerKind)
}
func (s *CommentService) CreateDraft(input map[string]any) (map[string]any, error) {
	file, err := s.workspace.ReadFile(stringValue(input["path"]))
	if err != nil {
		return nil, err
	}
	return s.comments.CreateDraft(input, file.Etag, file.ViewerKind)
}
func (s *CommentService) UpdateDraft(id string, input map[string]any) (map[string]any, error) {
	return s.comments.UpdateDraft(id, input)
}
func (s *CommentService) DeleteDraft(id string) (map[string]any, error) {
	return s.comments.DeleteDraft(id)
}
func (s *CommentService) PublishDrafts(ids []string, actor map[string]any) (map[string]any, error) {
	return s.comments.PublishDrafts(ids, actor)
}
func (s *CommentService) Update(id string, input map[string]any) (map[string]any, error) {
	return s.comments.Update(id, input)
}
func (s *CommentService) UpdateThread(id, status string) (CommentThread, error) {
	return s.UpdateThreadAs(id, status, map[string]any{"id": "unknown", "kind": "unknown"}, "")
}
func (s *CommentService) UpdateThreadAs(id, status string, actor map[string]any, clientEventID string) (CommentThread, error) {
	if id == "" {
		return CommentThread{}, fmt.Errorf("comment thread id is required")
	}
	if status == "" {
		return CommentThread{}, fmt.Errorf("comment thread status is required")
	}
	item, err := s.comments.UpdateThreadStatusAs(id, status, actor, clientEventID)
	if err != nil {
		return CommentThread{}, err
	}
	return threadFromMap(item), nil
}
func (s *CommentService) Activities(filters comments.ActivityFilters) ([]map[string]any, error) {
	return s.comments.ListActivities(filters)
}
func (s *CommentService) AppendReadActivity(threadID string, actor map[string]any, clientEventID string) (map[string]any, error) {
	return s.comments.AppendThreadReadActivity(threadID, actor, clientEventID)
}
func (s *CommentService) ClaimThread(threadID string, actor map[string]any, clientEventID string, leaseSeconds int) (map[string]any, error) {
	return s.comments.AppendThreadClaimActivity(threadID, actor, clientEventID, leaseSeconds)
}
func (s *CommentService) ReleaseThreadClaim(threadID string, actor map[string]any, clientEventID string) (map[string]any, error) {
	return s.comments.AppendThreadClaimReleaseActivity(threadID, actor, clientEventID)
}
func (s *CommentService) AddComment(threadID string, input map[string]any) (map[string]any, error) {
	thread, err := s.Thread(threadID)
	if err != nil {
		return nil, err
	}
	if thread.Status != "open" {
		return nil, fmt.Errorf("comment thread must be reopened before adding a comment")
	}
	input["threadId"] = threadID
	input["path"] = thread.Path
	input["anchor"] = thread.Anchor
	input["status"] = "open"
	return s.comments.Create(input, threadAnchorFileHash(thread), threadViewerKind(thread))
}
func (s *CommentService) Export(filters comments.Filters) (string, error) {
	return s.comments.ExportJSONL(filters)
}

func threadAnchorFileHash(thread CommentThread) string {
	return stringValue(mapValue(mapValue(thread.Anchor)["canonical"])["fileHash"])
}

func threadViewerKind(thread CommentThread) string {
	for _, comment := range thread.Comments {
		if viewerKind := stringValue(comment["viewerKind"]); viewerKind != "" {
			return viewerKind
		}
	}
	return ""
}

func threadFromMap(item map[string]any) CommentThread {
	commentsValue, _ := item["comments"].([]map[string]any)
	return CommentThread{ID: stringValue(item["id"]), Path: stringValue(item["path"]), Status: stringValue(item["status"]), ReviewBatchID: stringValue(item["reviewBatchId"]), Anchor: item["anchor"], UpdatedAt: stringValue(item["updatedAt"]), CreatedAt: stringValue(item["createdAt"]), ResolvedAt: stringValue(item["resolvedAt"]), ArchivedAt: stringValue(item["archivedAt"]), Comments: commentsValue}
}

func threadsFromAny(value any) []CommentThread {
	items, _ := value.([]map[string]any)
	threads := make([]CommentThread, 0, len(items))
	for _, item := range items {
		threads = append(threads, threadFromMap(item))
	}
	return threads
}

type EventService struct {
	mu          sync.Mutex
	subscribers map[chan WorkspaceEvent]struct{}
	version     int
}

type ActivityEventService struct {
	mu          sync.Mutex
	subscribers map[chan map[string]any]struct{}
}

const workspaceEventBufferSize = 1024

func NewActivityEventService() *ActivityEventService {
	return &ActivityEventService{subscribers: map[chan map[string]any]struct{}{}}
}
func (s *ActivityEventService) Subscribe() (<-chan map[string]any, func()) {
	events := make(chan map[string]any, 32)
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
func (s *ActivityEventService) Publish(event map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for subscriber := range s.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

func NewEventService() *EventService {
	return &EventService{subscribers: map[chan WorkspaceEvent]struct{}{}, version: 1}
}
func (s *EventService) Subscribe() (<-chan WorkspaceEvent, func()) {
	events := make(chan WorkspaceEvent, workspaceEventBufferSize)
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
