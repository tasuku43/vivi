package application

import (
	"context"
	"fmt"
	"sync"

	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	"github.com/tasuku43/vivi/server/workspace"
)

type Service struct {
	workspace *workspace.FS
	git       *gitreview.Reviewer
	comments  *comments.Store
	eventMu   sync.Mutex
	events    map[chan WorkspaceEvent]struct{}
	version   int
}

type Options struct {
	Workspace *workspace.FS
	Git       *gitreview.Reviewer
	Comments  *comments.Store
}

type CommentThread struct {
	ID        string           `json:"id"`
	Path      string           `json:"path"`
	Status    string           `json:"status"`
	Anchor    any              `json:"anchor,omitempty"`
	UpdatedAt string           `json:"updatedAt,omitempty"`
	Comments  []map[string]any `json:"comments"`
}

type WorkspaceEvent struct {
	Type    string `json:"type"`
	Path    string `json:"path"`
	Kind    string `json:"kind,omitempty"`
	Version int    `json:"version"`
}

func NewService(options Options) *Service {
	return &Service{
		workspace: options.Workspace,
		git:       options.Git,
		comments:  options.Comments,
		events:    map[chan WorkspaceEvent]struct{}{},
		version:   1,
	}
}

func (service *Service) Config() workspace.Config {
	return service.workspace.Config()
}

func (service *Service) ReadTree(relativePath string, depth int) (workspace.TreeSnapshot, error) {
	if relativePath != "" || depth > 0 {
		if depth <= 0 {
			depth = 1
		}
		return service.workspace.ReadDirectory(relativePath, depth)
	}
	return service.workspace.ReadTree()
}

func (service *Service) ReadFile(relativePath string) (workspace.FilePayload, error) {
	return service.workspace.ReadFile(relativePath)
}

func (service *Service) SearchFiles(query string, limit int) (workspace.FileSearchResponse, error) {
	return service.workspace.SearchFiles(query, limit)
}

func (service *Service) SearchText(query string, limit int) (workspace.TextSearchResponse, error) {
	return service.workspace.SearchText(query, limit)
}

func (service *Service) ReadChanges(ctx context.Context) gitreview.Summary {
	return service.git.ReadChanges(ctx)
}

func (service *Service) ReadDiffBases(ctx context.Context) gitreview.DiffBaseSummary {
	return service.git.ReadDiffBases(ctx)
}

func (service *Service) ReadDiff(ctx context.Context, relativePath, base string) gitreview.TextDiff {
	return service.git.ReadDiff(ctx, relativePath, base)
}

func (service *Service) ListComments(filters comments.Filters) ([]map[string]any, error) {
	return service.comments.List(filters)
}

func (service *Service) ListCommentThreads(filters comments.Filters) ([]CommentThread, error) {
	items, err := service.ListComments(filters)
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
			thread := CommentThread{
				ID:        id,
				Path:      stringValue(item["path"]),
				Status:    stringValue(item["status"]),
				Anchor:    item["anchor"],
				UpdatedAt: stringValue(item["updatedAt"]),
				Comments:  []map[string]any{},
			}
			threads = append(threads, thread)
			index = len(threads) - 1
			indexByID[id] = index
		}
		threads[index].Comments = append(threads[index].Comments, item)
		if updatedAt := stringValue(item["updatedAt"]); updatedAt > threads[index].UpdatedAt {
			threads[index].UpdatedAt = updatedAt
		}
		if status := stringValue(item["status"]); status == "open" {
			threads[index].Status = "open"
		}
	}
	return threads, nil
}

func (service *Service) CreateComment(input map[string]any) (map[string]any, error) {
	pathValue, _ := input["path"].(string)
	file, err := service.workspace.ReadFile(pathValue)
	if err != nil {
		return nil, err
	}
	return service.comments.Create(input, file.Etag, file.ViewerKind)
}

func (service *Service) UpdateComment(id string, input map[string]any) (map[string]any, error) {
	return service.comments.Update(id, input)
}

func (service *Service) UpdateCommentThread(id string, input map[string]any) (CommentThread, error) {
	status := stringValue(input["status"])
	if id == "" {
		return CommentThread{}, fmt.Errorf("comment thread id is required")
	}
	if status == "" {
		return CommentThread{}, fmt.Errorf("comment thread status is required")
	}
	items, err := service.ListComments(comments.Filters{})
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
		if _, err := service.UpdateComment(stringValue(item["id"]), map[string]any{"status": status}); err != nil {
			return CommentThread{}, err
		}
		updated = true
	}
	if !updated {
		return CommentThread{}, fmt.Errorf("comment thread not found")
	}
	threads, err := service.ListCommentThreads(comments.Filters{})
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

func (service *Service) ExportCommentsJSONL(filters comments.Filters) (string, error) {
	return service.comments.ExportJSONL(filters)
}

func (service *Service) SubscribeWorkspaceEvents() (<-chan WorkspaceEvent, func()) {
	events := make(chan WorkspaceEvent, 32)
	service.eventMu.Lock()
	service.events[events] = struct{}{}
	service.eventMu.Unlock()
	return events, func() {
		service.eventMu.Lock()
		if _, ok := service.events[events]; ok {
			delete(service.events, events)
			close(events)
		}
		service.eventMu.Unlock()
	}
}

func (service *Service) PublishWorkspaceEvent(event WorkspaceEvent) {
	service.eventMu.Lock()
	service.version++
	event.Version = service.version
	for subscriber := range service.events {
		select {
		case subscriber <- event:
		default:
		}
	}
	service.eventMu.Unlock()
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
