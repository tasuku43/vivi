package application

import "testing"

func TestEventServicePublishesVersionedWorkspaceEvents(t *testing.T) {
	service := NewEventService()
	events, unsubscribe := service.Subscribe()
	defer unsubscribe()
	service.Publish(WorkspaceEvent{Type: "change", Path: "README.md"})
	event := <-events
	if event.Version != 2 || event.Path != "README.md" {
		t.Fatalf("unexpected event: %#v", event)
	}
}
