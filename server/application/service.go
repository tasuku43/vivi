package application

import (
	"context"

	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	"github.com/tasuku43/vivi/server/workspace"
)

type Service struct {
	Workspace     *WorkspaceService
	File          *FileService
	Comment       *CommentService
	CommentThread *CommentService
	Review        *ReviewService
	Search        *SearchService
	Preview       *PreviewService
	Event         *EventService
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
		Workspace:     &WorkspaceService{workspace: options.Workspace},
		File:          &FileService{workspace: options.Workspace},
		Comment:       &CommentService{workspace: options.Workspace, comments: options.Comments},
		CommentThread: &CommentService{workspace: options.Workspace, comments: options.Comments},
		Review:        &ReviewService{git: options.Git},
		Search:        &SearchService{workspace: options.Workspace},
		Preview:       &PreviewService{workspace: options.Workspace},
		Event:         NewEventService(),
	}
}

func (service *Service) Config() workspace.Config {
	return service.Workspace.Config()
}

func (service *Service) ReadTree(relativePath string, depth int) (workspace.TreeSnapshot, error) {
	return service.Workspace.ReadTree(relativePath, depth)
}

func (service *Service) ReadFile(relativePath string) (workspace.FilePayload, error) {
	return service.File.ReadFile(relativePath)
}

func (service *Service) SearchFiles(query string, limit int) (workspace.FileSearchResponse, error) {
	return service.Search.SearchFiles(query, limit)
}

func (service *Service) SearchText(query string, limit int) (workspace.TextSearchResponse, error) {
	return service.Search.SearchText(query, limit)
}

func (service *Service) ReadChanges(ctx context.Context) gitreview.Summary {
	return service.Review.ReadChanges(ctx)
}

func (service *Service) ReadDiffBases(ctx context.Context) gitreview.DiffBaseSummary {
	return service.Review.ReadDiffBases(ctx)
}

func (service *Service) ReadDiff(ctx context.Context, relativePath, base string) gitreview.TextDiff {
	return service.Review.ReadDiff(ctx, relativePath, base)
}

func (service *Service) ListComments(filters comments.Filters) ([]map[string]any, error) {
	return service.Comment.List(filters)
}

func (service *Service) ListCommentThreads(filters comments.Filters) ([]CommentThread, error) {
	return service.CommentThread.Threads(filters)
}

func (service *Service) CreateComment(input map[string]any) (map[string]any, error) {
	return service.Comment.Create(input)
}

func (service *Service) UpdateComment(id string, input map[string]any) (map[string]any, error) {
	return service.Comment.Update(id, input)
}

func (service *Service) UpdateCommentThread(id string, input map[string]any) (CommentThread, error) {
	return service.CommentThread.UpdateThread(id, stringValue(input["status"]))
}

func (service *Service) ExportCommentsJSONL(filters comments.Filters) (string, error) {
	return service.Comment.Export(filters)
}

func (service *Service) SubscribeWorkspaceEvents() (<-chan WorkspaceEvent, func()) {
	return service.Event.Subscribe()
}

func (service *Service) PublishWorkspaceEvent(event WorkspaceEvent) {
	service.Event.Publish(event)
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
