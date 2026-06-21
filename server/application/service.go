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
	ActivityEvent *ActivityEventService

	ThreadActivityObserverFactories []ThreadActivityObserverFactory
}

type Options struct {
	Workspace                       *workspace.FS
	Git                             *gitreview.Reviewer
	Comments                        *comments.Store
	ThreadActivityObserverFactories []ThreadActivityObserverFactory
}

type CommentThread struct {
	ID         string           `json:"id"`
	Path       string           `json:"path"`
	Status     string           `json:"status"`
	Anchor     any              `json:"anchor,omitempty"`
	UpdatedAt  string           `json:"updatedAt,omitempty"`
	CreatedAt  string           `json:"createdAt,omitempty"`
	ResolvedAt string           `json:"resolvedAt,omitempty"`
	ArchivedAt string           `json:"archivedAt,omitempty"`
	Comments   []map[string]any `json:"comments"`
}

type WorkspaceEvent struct {
	Type    string `json:"type"`
	Path    string `json:"path"`
	Kind    string `json:"kind,omitempty"`
	Version int    `json:"version"`
}

func NewService(options Options) *Service {
	service := &Service{
		Workspace:     &WorkspaceService{workspace: options.Workspace},
		File:          &FileService{workspace: options.Workspace},
		Comment:       &CommentService{workspace: options.Workspace, comments: options.Comments},
		CommentThread: &CommentService{workspace: options.Workspace, comments: options.Comments},
		Review:        &ReviewService{git: options.Git},
		Search:        &SearchService{workspace: options.Workspace},
		Preview:       &PreviewService{workspace: options.Workspace},
		Event:         NewEventService(),
		ActivityEvent: NewActivityEventService(),
	}
	if len(options.ThreadActivityObserverFactories) > 0 {
		service.ThreadActivityObserverFactories = options.ThreadActivityObserverFactories
	} else {
		service.ThreadActivityObserverFactories = []ThreadActivityObserverFactory{
			NewPersistingThreadActivityObserverFactory(service),
		}
	}
	return service
}

func (service *Service) NewThreadActivityObserver(actor map[string]any, clientEventID string) ThreadActivityObserver {
	observers := make([]ThreadActivityObserver, 0, len(service.ThreadActivityObserverFactories))
	for _, factory := range service.ThreadActivityObserverFactories {
		if factory == nil {
			continue
		}
		observers = append(observers, factory.NewThreadActivityObserver(actor, clientEventID))
	}
	return NewCompositeThreadActivityObserver(observers...)
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
	comment, err := service.Comment.Create(input)
	if err == nil {
		eventType := "thread_created"
		if stringValue(input["threadId"]) != "" {
			eventType = "comment_added"
		}
		service.publishLatestActivity(stringValue(comment["threadId"]), eventType)
	}
	return comment, err
}

func (service *Service) CreateCommentThread(input map[string]any) (CommentThread, error) {
	comment, err := service.Comment.Create(input)
	if err != nil {
		return CommentThread{}, err
	}
	thread, err := service.Comment.Thread(stringValue(comment["threadId"]))
	if err == nil {
		service.publishLatestActivity(thread.ID, "thread_created")
	}
	return thread, err
}

func (service *Service) AddComment(threadID string, input map[string]any) (map[string]any, error) {
	comment, err := service.Comment.AddComment(threadID, input)
	if err == nil {
		service.publishLatestActivity(threadID, "comment_added")
	}
	return comment, err
}

func (service *Service) UpdateComment(id string, input map[string]any) (map[string]any, error) {
	comment, err := service.Comment.Update(id, input)
	if err == nil {
		service.publishLatestActivity(stringValue(comment["threadId"]), "comment_updated")
	}
	return comment, err
}

func (service *Service) UpdateCommentThread(id string, input map[string]any) (CommentThread, error) {
	return service.updateCommentThread(id, stringValue(input["status"]), mapValue(input["actor"]))
}

func (service *Service) ResolveCommentThread(id string, actors ...map[string]any) (CommentThread, error) {
	return service.updateCommentThread(id, "resolved", firstActor(actors))
}
func (service *Service) ArchiveCommentThread(id string, actors ...map[string]any) (CommentThread, error) {
	return service.updateCommentThread(id, "archived", firstActor(actors))
}
func (service *Service) ReopenCommentThread(id string, actors ...map[string]any) (CommentThread, error) {
	return service.updateCommentThread(id, "open", firstActor(actors))
}

func (service *Service) updateCommentThread(id, status string, actor map[string]any) (CommentThread, error) {
	thread, err := service.Comment.UpdateThreadAs(id, status, actor)
	if err == nil {
		service.publishLatestActivity(id, "thread_status_changed")
	}
	return thread, err
}

func (service *Service) ListCommentThreadActivities(threadID, after string, first int) ([]map[string]any, error) {
	return service.Comment.Activities(comments.ActivityFilters{ThreadID: threadID, After: after, First: first})
}

func (service *Service) ObserveCommentThreadRead(threadID string, actor map[string]any, clientEventID string) (map[string]any, error) {
	event, err := service.Comment.AppendReadActivity(threadID, actor, clientEventID)
	if err == nil {
		service.ActivityEvent.Publish(event)
	}
	return event, err
}

func (service *Service) SubscribeCommentThreadActivities() (<-chan map[string]any, func()) {
	return service.ActivityEvent.Subscribe()
}

func (service *Service) publishLatestActivity(threadID, eventType string) {
	items, err := service.ListCommentThreadActivities(threadID, "", 500)
	if err != nil {
		return
	}
	for index := len(items) - 1; index >= 0; index-- {
		if stringValue(items[index]["type"]) == eventType {
			service.ActivityEvent.Publish(items[index])
			return
		}
	}
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
func mapValue(value any) map[string]any { result, _ := value.(map[string]any); return result }
func firstActor(actors []map[string]any) map[string]any {
	if len(actors) > 0 {
		return actors[0]
	}
	return map[string]any{"id": "unknown", "kind": "unknown"}
}
