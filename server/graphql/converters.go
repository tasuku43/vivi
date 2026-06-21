package graphql

import (
	"strings"

	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/gitreview"
	"github.com/tasuku43/vivi/server/graphql/model"
	"github.com/tasuku43/vivi/server/workspace"
)

func viewerConfigFromDomain(config workspace.Config) *model.ViewerConfig {
	return &model.ViewerConfig{
		Root:             config.Root,
		AllowHTMLScripts: config.AllowHTMLScripts,
		MaxFileSizeBytes: int(config.MaxFileSizeBytes),
	}
}

func commentsFromMaps(items []map[string]any) []*model.Comment {
	comments := make([]*model.Comment, 0, len(items))
	for _, item := range items {
		comments = append(comments, commentFromMap(item))
	}
	return comments
}

func commentFromMap(item map[string]any) *model.Comment {
	return &model.Comment{
		ID:            stringValue(item["id"]),
		ThreadID:      optionalStringValue(item["threadId"]),
		Path:          stringValue(item["path"]),
		ViewerKind:    stringValue(item["viewerKind"]),
		ReviewBatchID: optionalStringValue(item["reviewBatchId"]),
		Anchor:        mapValue(item["anchor"]),
		DiffAnchor:    diffAnchorValue(item["anchor"]),
		Body:          stringValue(item["body"]),
		CreatedBy:     commentActorValue(item),
		Author:        optionalStringValue(item["author"]),
		Source:        commentSourceValue(item["source"]),
		Status:        commentStatusValue(item["status"]),
		CreatedAt:     stringValue(item["createdAt"]),
		UpdatedAt:     stringValue(item["updatedAt"]),
		ResolvedAt:    optionalStringValue(item["resolvedAt"]),
		ArchivedAt:    optionalStringValue(item["archivedAt"]),
	}
}

func draftReviewCommentsFromMaps(items []map[string]any) []*model.DraftReviewComment {
	drafts := make([]*model.DraftReviewComment, 0, len(items))
	for _, item := range items {
		drafts = append(drafts, draftReviewCommentFromMap(item))
	}
	return drafts
}

func draftReviewCommentFromMap(item map[string]any) *model.DraftReviewComment {
	return &model.DraftReviewComment{
		ID:         stringValue(item["id"]),
		Path:       stringValue(item["path"]),
		ViewerKind: stringValue(item["viewerKind"]),
		Anchor:     mapValue(item["anchor"]),
		DiffAnchor: diffAnchorValue(item["anchor"]),
		Body:       stringValue(item["body"]),
		CreatedBy:  commentActorValue(item),
		Author:     optionalStringValue(item["author"]),
		Source:     commentSourceValue(item["source"]),
		CreatedAt:  stringValue(item["createdAt"]),
		UpdatedAt:  stringValue(item["updatedAt"]),
	}
}

func commentThreadsFromDomain(items []application.CommentThread) []*model.CommentThread {
	threads := make([]*model.CommentThread, 0, len(items))
	for _, item := range items {
		threads = append(threads, &model.CommentThread{
			ID:            item.ID,
			Path:          item.Path,
			Status:        commentStatusValue(item.Status),
			ReviewBatchID: optionalStringValue(item.ReviewBatchID),
			Anchor:        mapValue(item.Anchor),
			DiffAnchor:    diffAnchorValue(item.Anchor),
			UpdatedAt:     optionalStringValue(item.UpdatedAt),
			CreatedAt:     item.CreatedAt,
			ResolvedAt:    optionalStringValue(item.ResolvedAt),
			ArchivedAt:    optionalStringValue(item.ArchivedAt),
			Comments:      commentsFromMaps(item.Comments),
		})
	}
	return threads
}

func diffAnchorValue(value any) *model.DiffCommentAnchor {
	anchor := mapValue(value)
	diff := mapValue(anchor["diff"])
	if len(diff) == 0 {
		return nil
	}
	side := model.DiffSide(stringValue(diff["side"]))
	if side == "current" {
		side = model.DiffSideNew
	}
	if !side.IsValid() {
		return nil
	}
	return &model.DiffCommentAnchor{
		Path: stringValue(diff["path"]), Base: defaultString(diff["base"], "HEAD"),
		Ref: defaultString(diff["ref"], "working-tree"), HunkID: defaultString(diff["hunkId"], "legacy"), Side: side,
		OldLineStart: optionalJSONInt(diff["oldLineStart"]), OldLineEnd: optionalJSONInt(diff["oldLineEnd"]),
		NewLineStart: firstJSONInt(diff["newLineStart"], diff["lineStart"]), NewLineEnd: firstJSONInt(diff["newLineEnd"], diff["lineEnd"]),
		DiffHash: optionalStringValue(diff["diffHash"]), FileHash: optionalStringValue(diff["fileHash"]),
	}
}

func defaultString(value any, fallback string) string {
	if text := stringValue(value); text != "" {
		return text
	}
	return fallback
}
func optionalJSONInt(value any) *int {
	if number, ok := value.(float64); ok {
		result := int(number)
		return &result
	}
	if number, ok := value.(int); ok {
		return &number
	}
	return nil
}
func firstJSONInt(values ...any) *int {
	for _, value := range values {
		if result := optionalJSONInt(value); result != nil {
			return result
		}
	}
	return nil
}

func workspaceEventFromDomain(event application.WorkspaceEvent) *model.WorkspaceEvent {
	result := &model.WorkspaceEvent{
		Type:    event.Type,
		Path:    event.Path,
		Version: event.Version,
	}
	if event.Kind != "" {
		kind := model.NodeKind(event.Kind)
		if kind.IsValid() {
			result.Kind = &kind
		}
	}
	return result
}

func reviewSummaryFromDomain(summary gitreview.Summary) *model.ChangeReviewSummary {
	changes := make([]*gitreview.Change, 0, len(summary.Changes))
	for index := range summary.Changes {
		changes = append(changes, &summary.Changes[index])
	}
	return &model.ChangeReviewSummary{
		Available: summary.Available,
		Reason:    optionalStringValue(summary.Reason),
		Changes:   changes,
	}
}

func publishedReviewBatchFromMap(item map[string]any) *model.PublishedReviewBatch {
	return &model.PublishedReviewBatch{
		ReviewBatchID: stringValue(item["reviewBatchId"]),
		PublishedAt:   stringValue(item["publishedAt"]),
		Threads:       commentThreadsFromDomain(threadsFromMaps(item["threads"])),
	}
}

func threadsFromMaps(value any) []application.CommentThread {
	items, _ := value.([]map[string]any)
	threads := make([]application.CommentThread, 0, len(items))
	for _, item := range items {
		commentsValue, _ := item["comments"].([]map[string]any)
		threads = append(threads, application.CommentThread{
			ID:            stringValue(item["id"]),
			Path:          stringValue(item["path"]),
			Status:        stringValue(item["status"]),
			ReviewBatchID: stringValue(item["reviewBatchId"]),
			Anchor:        item["anchor"],
			UpdatedAt:     stringValue(item["updatedAt"]),
			CreatedAt:     stringValue(item["createdAt"]),
			ResolvedAt:    stringValue(item["resolvedAt"]),
			ArchivedAt:    stringValue(item["archivedAt"]),
			Comments:      commentsValue,
		})
	}
	return threads
}

func nodesFromDomain(nodes []workspace.Node) []*model.FsNode {
	result := make([]*model.FsNode, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, nodeFromDomain(node))
	}
	return result
}

func nodeFromDomain(node workspace.Node) *model.FsNode {
	return &model.FsNode{
		ID:             node.ID,
		Path:           node.Path,
		Name:           node.Name,
		Kind:           model.NodeKind(node.Kind),
		ParentPath:     node.ParentPath,
		ViewerKind:     optionalStringValue(node.ViewerKind),
		Children:       nodesFromDomain(node.Children),
		ChildrenLoaded: node.ChildrenLoaded,
		Size:           optionalInt64Value(node.Size),
		MtimeMs:        optionalFloatValue(node.MtimeMs),
		Version:        optionalIntValue(node.Version),
	}
}

func commentInputMap(input model.CommentInput) map[string]any {
	result := map[string]any{
		"path":   input.Path,
		"anchor": input.Anchor,
		"body":   input.Body,
	}
	if input.ViewerKind != nil {
		result["viewerKind"] = *input.ViewerKind
	}
	if input.ThreadID != nil {
		result["threadId"] = *input.ThreadID
	}
	if input.Status != nil {
		result["status"] = input.Status.String()
	}
	if input.Author != nil {
		result["author"] = *input.Author
	}
	if input.Source != nil {
		result["source"] = commentSourceStorageValue(*input.Source)
	}
	if input.Actor != nil {
		result["actor"] = commentActorInputMap(input.Actor)
		result["author"] = optionalStringDereference(input.Actor.DisplayName)
		result["source"] = actorKindStorageValue(input.Actor.Kind)
	}
	return result
}

func draftReviewCommentInputMap(input model.DraftReviewCommentInput) map[string]any {
	result := map[string]any{
		"path":   input.Path,
		"anchor": input.Anchor,
		"body":   input.Body,
	}
	if input.ViewerKind != nil {
		result["viewerKind"] = *input.ViewerKind
	}
	if input.Author != nil {
		result["author"] = *input.Author
	}
	if input.Source != nil {
		result["source"] = commentSourceStorageValue(*input.Source)
	}
	if input.Actor != nil {
		result["actor"] = commentActorInputMap(input.Actor)
		result["author"] = optionalStringDereference(input.Actor.DisplayName)
		result["source"] = actorKindStorageValue(input.Actor.Kind)
	}
	return result
}

func addCommentInputMap(input model.AddCommentInput) map[string]any {
	result := map[string]any{"body": input.Body}
	if input.Author != nil {
		result["author"] = *input.Author
	}
	if input.Source != nil {
		result["source"] = commentSourceStorageValue(*input.Source)
	}
	if input.Actor != nil {
		result["actor"] = commentActorInputMap(input.Actor)
		result["author"] = optionalStringDereference(input.Actor.DisplayName)
		result["source"] = actorKindStorageValue(input.Actor.Kind)
	}
	return result
}

func commentUpdateInputMap(input model.CommentUpdateInput) map[string]any {
	result := map[string]any{}
	if input.Body != nil {
		result["body"] = *input.Body
	}
	if input.Status != nil {
		result["status"] = input.Status.String()
	}
	if input.Actor != nil {
		result["actor"] = commentActorInputMap(input.Actor)
	}
	return result
}

func commentActorInputMap(input *model.CommentActorInput) map[string]any {
	if input == nil {
		return map[string]any{"id": "unknown", "kind": "unknown"}
	}
	result := map[string]any{"id": input.ID, "kind": input.Kind.String()}
	if input.DisplayName != nil {
		result["displayName"] = *input.DisplayName
	}
	return result
}

func commentActorValue(item map[string]any) *model.CommentActor {
	actor, _ := item["actor"].(map[string]any)
	if len(actor) == 0 {
		actor = map[string]any{"kind": item["source"], "displayName": item["author"]}
	}
	kindText := strings.ReplaceAll(stringValue(actor["kind"]), "-", "_")
	kind := model.CommentActorKind(kindText)
	if !kind.IsValid() {
		kind = model.CommentActorKindUnknown
	}
	id := stringValue(actor["id"])
	displayName := optionalStringValue(actor["displayName"])
	if id == "" {
		id = kind.String()
		if displayName != nil {
			id += ":" + *displayName
		}
	}
	return &model.CommentActor{ID: id, Kind: kind, DisplayName: displayName}
}

func activityFromMap(item map[string]any) *model.CommentThreadActivityEvent {
	return &model.CommentThreadActivityEvent{ID: stringValue(item["id"]), ThreadID: stringValue(item["threadId"]), Type: model.CommentThreadActivityType(stringValue(item["type"])), Actor: commentActorValue(map[string]any{"actor": item["actor"]}), CommentID: optionalStringValue(item["commentId"]), PreviousStatus: optionalCommentStatus(item["previousStatus"]), Status: optionalCommentStatus(item["status"]), ClientEventID: optionalStringValue(item["clientEventId"]), CreatedAt: stringValue(item["createdAt"])}
}
func activitiesFromMaps(items []map[string]any) []*model.CommentThreadActivityEvent {
	result := make([]*model.CommentThreadActivityEvent, 0, len(items))
	for _, item := range items {
		result = append(result, activityFromMap(item))
	}
	return result
}
func optionalCommentStatus(value any) *model.CommentStatus {
	status := model.CommentStatus(stringValue(value))
	if !status.IsValid() {
		return nil
	}
	return &status
}
func actorKindStorageValue(kind model.CommentActorKind) string {
	if kind == model.CommentActorKindClaudeCode {
		return "claude-code"
	}
	return kind.String()
}
func optionalStringDereference(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
func stringPointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func commentFilters(path *string, status *model.CommentStatus) (string, string) {
	statusValue := ""
	if status != nil {
		statusValue = status.String()
	}
	pathValue := ""
	if path != nil {
		pathValue = *path
	}
	return pathValue, statusValue
}

func commentStatusValue(value any) model.CommentStatus {
	status := model.CommentStatus(stringValue(value))
	if status.IsValid() {
		return status
	}
	return model.CommentStatusOpen
}

func commentSourceValue(value any) model.CommentSource {
	if stringValue(value) == "claude-code" {
		return model.CommentSourceClaudeCode
	}
	source := model.CommentSource(stringValue(value))
	if source.IsValid() {
		return source
	}
	return model.CommentSourceUnknown
}
func commentSourceStorageValue(value model.CommentSource) string {
	if value == model.CommentSourceClaudeCode {
		return "claude-code"
	}
	return value.String()
}

func mapValue(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func stringValue(value any) string {
	typed, _ := value.(string)
	return typed
}

func optionalStringValue(value any) *string {
	typed := stringValue(value)
	if typed == "" {
		return nil
	}
	return &typed
}

func optionalInt64Value(value int64) *int {
	if value == 0 {
		return nil
	}
	typed := int(value)
	return &typed
}

func optionalIntValue(value int) *int {
	if value == 0 {
		return nil
	}
	return &value
}

func optionalFloatValue(value float64) *float64 {
	if value == 0 {
		return nil
	}
	return &value
}
