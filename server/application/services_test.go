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

func TestServiceComposesInjectedThreadActivityObservers(t *testing.T) {
	calls := []string{}
	factory := func(label string) ThreadActivityObserverFactory {
		return ThreadActivityObserverFactoryFunc(func(actor map[string]any, clientEventID string) ThreadActivityObserver {
			if actor["id"] != "agent:one" || clientEventID != "read-1" {
				t.Fatalf("observer input = %#v, %q", actor, clientEventID)
			}
			return threadActivityObserverFunc(func(threadID string) {
				calls = append(calls, label+":"+threadID)
			})
		})
	}
	service := NewService(Options{
		ThreadActivityObserverFactories: []ThreadActivityObserverFactory{
			factory("first"),
			factory("second"),
		},
	})

	observer := service.NewThreadActivityObserver(map[string]any{"id": "agent:one"}, "read-1")
	observer.ObserveThreadRead("thread-1")

	if len(calls) != 2 || calls[0] != "first:thread-1" || calls[1] != "second:thread-1" {
		t.Fatalf("calls = %#v", calls)
	}
}

type threadActivityObserverFunc func(threadID string)

func (observer threadActivityObserverFunc) ObserveThreadRead(threadID string) {
	observer(threadID)
}
