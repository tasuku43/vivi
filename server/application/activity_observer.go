package application

import (
	"context"
	"strings"
	"sync"
)

type threadActivityObserverKey struct{}

type ThreadActivityObserver interface {
	ObserveThreadRead(threadID string)
}

type ThreadActivityObserverFactory interface {
	NewThreadActivityObserver(actor map[string]any, clientEventID string) ThreadActivityObserver
}

type ThreadActivityObserverFactoryFunc func(actor map[string]any, clientEventID string) ThreadActivityObserver

func (factory ThreadActivityObserverFactoryFunc) NewThreadActivityObserver(actor map[string]any, clientEventID string) ThreadActivityObserver {
	return factory(actor, clientEventID)
}

type CompositeThreadActivityObserver []ThreadActivityObserver

func NewCompositeThreadActivityObserver(observers ...ThreadActivityObserver) ThreadActivityObserver {
	filtered := make([]ThreadActivityObserver, 0, len(observers))
	for _, observer := range observers {
		if observer != nil {
			filtered = append(filtered, observer)
		}
	}
	if len(filtered) == 0 {
		return nil
	}
	if len(filtered) == 1 {
		return filtered[0]
	}
	return CompositeThreadActivityObserver(filtered)
}

func (observer CompositeThreadActivityObserver) ObserveThreadRead(threadID string) {
	for _, item := range observer {
		item.ObserveThreadRead(threadID)
	}
}

func WithThreadActivityObserver(ctx context.Context, observer ThreadActivityObserver) context.Context {
	if observer == nil {
		return ctx
	}
	return context.WithValue(ctx, threadActivityObserverKey{}, observer)
}

func ObserveThreadRead(ctx context.Context, threadID string) {
	observer, _ := ctx.Value(threadActivityObserverKey{}).(ThreadActivityObserver)
	if observer == nil {
		return
	}
	observer.ObserveThreadRead(threadID)
}

func ObserveThreadReads(ctx context.Context, threadIDs []string) {
	for _, threadID := range threadIDs {
		ObserveThreadRead(ctx, threadID)
	}
}

func NewPersistingThreadActivityObserverFactory(service *Service) ThreadActivityObserverFactory {
	return ThreadActivityObserverFactoryFunc(func(actor map[string]any, clientEventID string) ThreadActivityObserver {
		return NewThreadReadRecorder(service, actor, clientEventID)
	})
}

func NewThreadReadRecorder(service *Service, actor map[string]any, clientEventID string) ThreadActivityObserver {
	if service == nil || strings.TrimSpace(stringValue(actor["id"])) == "" {
		return nil
	}
	return &threadReadRecorder{
		service:       service,
		actor:         actor,
		clientEventID: strings.TrimSpace(clientEventID),
		seen:          map[string]struct{}{},
	}
}

type threadReadRecorder struct {
	service       *Service
	actor         map[string]any
	clientEventID string
	mu            sync.Mutex
	seen          map[string]struct{}
}

func (recorder *threadReadRecorder) ObserveThreadRead(threadID string) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return
	}
	recorder.mu.Lock()
	if _, ok := recorder.seen[threadID]; ok {
		recorder.mu.Unlock()
		return
	}
	recorder.seen[threadID] = struct{}{}
	recorder.mu.Unlock()
	_, _ = recorder.service.ObserveCommentThreadRead(threadID, recorder.actor, recorder.clientEventID)
}
