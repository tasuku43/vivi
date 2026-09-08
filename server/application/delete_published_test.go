package application

import (
	"github.com/tasuku43/vivi/server/comments"
	"testing"
	"time"
)

func TestDeletePublishedCommentWithoutWorkspacePublishesActivity(t *testing.T) {
	store, _ := comments.NewStore(t.TempDir())
	c, err := store.Create(map[string]any{"path": "missing.md", "body": "human", "source": "human"}, "", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(Options{Comments: store})
	events, unsubscribe := service.SubscribeCommentThreadActivities()
	defer unsubscribe()
	for attempt := 0; attempt < 2; attempt++ {
		deleted, err := service.DeletePublishedComment(stringValue(c["id"]))
		if err != nil || deleted["path"] != "missing.md" {
			t.Fatalf("delete: %#v %v", deleted, err)
		}
		select {
		case event := <-events:
			if event["type"] != "comment_deleted" || event["commentId"] != c["id"] || event["threadId"] != c["threadId"] {
				t.Fatalf("activity: %#v", event)
			}
		case <-time.After(time.Second):
			t.Fatal("no activity")
		}
	}
	if _, err := service.DeletePublishedComment("missing"); err == nil {
		t.Fatal("accepted unknown id")
	}
	select {
	case e := <-events:
		t.Fatalf("failure published: %#v", e)
	default:
	}
}
