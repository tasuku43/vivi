package graphql

import "github.com/tasuku43/vivi/server/application"

func threadIDsFromDomain(threads []application.CommentThread) []string {
	seen := map[string]struct{}{}
	ids := []string{}
	for _, thread := range threads {
		if thread.ID == "" {
			continue
		}
		if _, ok := seen[thread.ID]; ok {
			continue
		}
		seen[thread.ID] = struct{}{}
		ids = append(ids, thread.ID)
	}
	return ids
}

func threadIDsFromCommentMaps(items []map[string]any) []string {
	seen := map[string]struct{}{}
	ids := []string{}
	for _, item := range items {
		threadID := stringValue(item["threadId"])
		if threadID == "" {
			threadID = stringValue(item["id"])
		}
		if threadID == "" {
			continue
		}
		if _, ok := seen[threadID]; ok {
			continue
		}
		seen[threadID] = struct{}{}
		ids = append(ids, threadID)
	}
	return ids
}
