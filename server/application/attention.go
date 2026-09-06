package application

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/tasuku43/vivi/server/attention"
	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	"github.com/tasuku43/vivi/server/workspace"
)

type AttentionService struct {
	Store       *attention.Store
	comments    *comments.Store
	receipts    map[string]bool
	workspace   *workspace.FS
	git         *gitreview.Reviewer
	mu          sync.Mutex
	initialized bool
	hashes      map[string]string
}
type AttentionSnapshot struct {
	Events        []attention.Event `json:"events"`
	EligiblePaths []string          `json:"eligiblePaths"`
	Headings      map[string]string `json:"headings"`
}

func (s *AttentionService) seed(ctx context.Context) error {
	if s.initialized {
		return nil
	}
	now := time.Now()
	candidates := map[string]int64{}
	gitOK := false
	if s.git != nil {
		candidates, gitOK = s.git.RecentDocuments(ctx, now)
	}
	entries, _, err := s.workspace.WatchEntriesWithStats()
	if err != nil {
		return err
	}
	for p, e := range entries {
		if e.Kind != "file" {
			continue
		}
		file, err := s.workspace.ReadFile(p)
		if err != nil {
			continue
		}
		s.hashes[p] = file.Etag
		if !gitOK {
			at := e.MtimeNs / int64(time.Millisecond)
			if at > now.Add(-attention.Window).UnixMilli() {
				candidates[p] = at
			}
		}
	}
	for p, at := range candidates {
		if _, ok := s.hashes[p]; ok {
			if err := s.Store.Append(attention.Event{Path: p, At: at, Reason: "Updated", Fingerprint: s.hashes[p]}); err != nil {
				return err
			}
		}
	}
	s.initialized = true
	return nil
}
func (s *AttentionService) Snapshot(ctx context.Context, paths []string) (AttentionSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := AttentionSnapshot{Events: []attention.Event{}, EligiblePaths: []string{}, Headings: map[string]string{}}
	if err := s.seed(ctx); err != nil {
		return result, err
	}
	if s.comments != nil {
		receipts, err := s.comments.RecentReadReceipts(time.Now().Add(-attention.Window))
		if err != nil {
			return result, err
		}
		if s.receipts == nil {
			s.receipts = map[string]bool{}
		}
		for _, receipt := range receipts {
			key := receipt.Path + ":" + receipt.At.Format(time.RFC3339Nano)
			if s.receipts[key] {
				continue
			}
			if _, err := s.workspace.ReadFile(receipt.Path); err != nil {
				continue
			}
			if err := s.Store.Append(attention.Event{Path: receipt.Path, At: receipt.At.UnixMilli(), Order: receipt.At.UnixNano(), Reason: "Read by agent"}); err != nil {
				return result, err
			}
			s.receipts[key] = true
		}
	}
	events, err := s.Store.Snapshot(time.Now())
	if err != nil {
		return result, err
	}
	wanted := map[string]bool{}
	for _, p := range paths {
		wanted[p] = true
	}
	for _, e := range events {
		wanted[e.Path] = true
	}
	if len(wanted) > 4096 {
		return result, errors.New("too many attention paths")
	}
	eligible := map[string]bool{}
	for p := range wanted {
		file, err := s.workspace.ReadFile(p)
		if err != nil {
			continue
		}
		eligible[p] = true
		result.EligiblePaths = append(result.EligiblePaths, p)
		if heading := s.workspace.DocumentHeading(file.Path); heading != nil {
			result.Headings[p] = *heading
		}
	}
	for _, e := range events {
		if eligible[e.Path] {
			result.Events = append(result.Events, e)
		}
	}
	return result, nil
}
func (s *AttentionService) Observe(ctx context.Context, path, reason string) (attention.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.seed(ctx); err != nil {
		return attention.Event{}, err
	}
	if reason != "Opened" && reason != "Presented by agent" && reason != "Updated" && reason != "hidden" {
		return attention.Event{}, errors.New("invalid attention reason")
	}
	file, err := s.workspace.ReadFile(path)
	if err != nil {
		return attention.Event{}, err
	}
	now := time.Now()
	e := attention.Event{Path: file.Path, At: now.UnixMilli(), Order: now.UnixNano(), Reason: reason, Fingerprint: file.Etag}
	if reason == "Updated" && s.hashes[file.Path] == file.Etag {
		return e, nil
	}
	s.hashes[file.Path] = file.Etag
	return e, s.Store.Append(e)
}
