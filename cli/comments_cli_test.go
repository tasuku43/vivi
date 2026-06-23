package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	vivigraphql "github.com/tasuku43/vivi/server/graphql"
	"github.com/tasuku43/vivi/server/workspace"
)

func TestCommentsCLIReadsRepliesAndMovesThreadLifecycle(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	active := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "claude-code", "--actor-name", "Claude Code", "--client-event-id", "read-open-1", "--json")
	var activePayload struct {
		Threads []commentThreadOutput `json:"threads"`
		Count   int                   `json:"count"`
	}
	decodeCLIJSON(t, active, &activePayload)
	if activePayload.Count != 1 || activePayload.Threads[0].ID != threadID {
		t.Fatalf("active payload = %s", active.String())
	}
	if activePayload.Threads[0].Comments[0].Body != "Please check the docs" {
		t.Fatalf("active comment body = %#v", activePayload.Threads[0].Comments)
	}

	readActivities := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "Activities",
		"query":         `query Activities($threadId: ID!) { commentThreadActivities(threadId: $threadId) { type actor { id kind displayName } clientEventId } }`,
		"variables":     map[string]any{"threadId": threadID},
	})
	activities := readActivities["commentThreadActivities"].([]any)
	if len(activities) != 2 {
		t.Fatalf("activities after active = %#v", activities)
	}
	read := activities[1].(map[string]any)
	actor := read["actor"].(map[string]any)
	if read["type"] != "thread_read" || read["clientEventId"] != "read-open-1" || actor["id"] != "claude-code" || actor["kind"] != "claude_code" {
		t.Fatalf("read activity = %#v", read)
	}

	events, unsubscribe := server.service.SubscribeCommentThreadActivities()
	defer unsubscribe()

	reply := runCommentsCLIForTest(t, "reply", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--body", "Implemented in this branch", "--json")
	var replyPayload struct {
		Comment commentOutput `json:"comment"`
	}
	decodeCLIJSON(t, reply, &replyPayload)
	if replyPayload.Comment.ThreadID != threadID || replyPayload.Comment.Body != "Implemented in this branch" || replyPayload.Comment.CreatedBy.Kind != "codex" {
		t.Fatalf("reply payload = %s", reply.String())
	}
	expectActivityEvent(t, events, "comment_added", threadID)

	resolved := runCommentsCLIForTest(t, "resolve", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--json")
	var lifecyclePayload struct {
		Thread commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, resolved, &lifecyclePayload)
	if lifecyclePayload.Thread.Status != "resolved" || lifecyclePayload.Thread.ResolvedAt == "" {
		t.Fatalf("resolved payload = %s", resolved.String())
	}
	expectActivityEvent(t, events, "thread_status_changed", threadID)

	archived := runCommentsCLIForTest(t, "archive", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, archived, &lifecyclePayload)
	if lifecyclePayload.Thread.Status != "archived" || lifecyclePayload.Thread.ArchivedAt == "" {
		t.Fatalf("archived payload = %s", archived.String())
	}

	reopened := runCommentsCLIForTest(t, "reopen", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, reopened, &lifecyclePayload)
	if lifecyclePayload.Thread.Status != "open" {
		t.Fatalf("reopened payload = %s", reopened.String())
	}

	show := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showPayload struct {
		Thread     commentThreadOutput     `json:"thread"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, show, &showPayload)
	if showPayload.Thread.ID != threadID || len(showPayload.Activities) < 5 {
		t.Fatalf("show payload = %s", show.String())
	}
}

func TestCommentsCLIShowsPublishedReviewBatchAndHidesDrafts(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	for _, input := range []map[string]any{
		{"path": "README.md", "body": "Draft one", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1)}}},
		{"path": "README.md", "body": "Draft two", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1)}}},
	} {
		graphqlForCLI(t, server.URL, map[string]any{"operationName": "CreateDraftReviewComment", "query": `mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input: $input) { id } }`, "variables": map[string]any{"input": input}})
	}
	before := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--json")
	var beforePayload struct {
		Threads []commentThreadOutput `json:"threads"`
		Count   int                   `json:"count"`
	}
	decodeCLIJSON(t, before, &beforePayload)
	if beforePayload.Count != 0 {
		t.Fatalf("drafts leaked to active CLI = %s", before.String())
	}
	published := graphqlForCLI(t, server.URL, map[string]any{"operationName": "PublishDraftReviewComments", "query": `mutation PublishDraftReviewComments { publishDraftReviewComments { reviewBatchId threads { id } } }`})["publishDraftReviewComments"].(map[string]any)
	reviewBatchID := published["reviewBatchId"].(string)
	after := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--json")
	var afterPayload struct {
		Threads []commentThreadOutput `json:"threads"`
		Count   int                   `json:"count"`
	}
	decodeCLIJSON(t, after, &afterPayload)
	if afterPayload.Count != 1 {
		t.Fatalf("active after publish = %s", after.String())
	}
	for _, thread := range afterPayload.Threads {
		if thread.ReviewBatchID != reviewBatchID || thread.Comments[0].ReviewBatchID != reviewBatchID {
			t.Fatalf("thread missing batch id: %#v", thread)
		}
		if len(thread.Comments) != 2 {
			t.Fatalf("thread did not keep both same-anchor comments: %#v", thread)
		}
	}

	batchedThreadID := afterPayload.Threads[0].ID
	unbatchedThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Separate follow-up outside the review batch")
	batchOnly := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--client-event-id", "batch-filter-read", "--review-batch", reviewBatchID, "--with-activities", "--json")
	var batchPayload struct {
		Threads []commentThreadOutput   `json:"threads"`
		Count   int                     `json:"count"`
		Items   []commentWorkItemOutput `json:"items"`
	}
	decodeCLIJSON(t, batchOnly, &batchPayload)
	if batchPayload.Count != 1 || len(batchPayload.Threads) != 1 || batchPayload.Threads[0].ID != batchedThreadID {
		t.Fatalf("batch-filtered active payload = %s", batchOnly.String())
	}
	if len(batchPayload.Items) != 1 || batchPayload.Items[0].Thread.ID != batchedThreadID {
		t.Fatalf("batch-filtered active items = %s", batchOnly.String())
	}
	if !containsActivity(batchPayload.Items[0].Activities, "thread_read", "batch-filter-read") {
		t.Fatalf("batch-filtered activities did not include read receipt: %#v", batchPayload.Items[0].Activities)
	}

	unbatchedActivities := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "Activities",
		"query":         `query Activities($threadId: ID!) { commentThreadActivities(threadId: $threadId) { type clientEventId } }`,
		"variables":     map[string]any{"threadId": unbatchedThreadID},
	})["commentThreadActivities"].([]any)
	for _, raw := range unbatchedActivities {
		activity := raw.(map[string]any)
		if activity["type"] == "thread_read" && activity["clientEventId"] == "batch-filter-read" {
			t.Fatalf("batch-filtered read receipt leaked to unbatched thread: %#v", unbatchedActivities)
		}
	}

	nextBatch := runCommentsCLIForTest(t, "next", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--review-batch", reviewBatchID, "--json")
	var nextBatchPayload struct {
		Thread *commentThreadOutput `json:"thread"`
		Count  int                  `json:"count"`
	}
	decodeCLIJSON(t, nextBatch, &nextBatchPayload)
	if nextBatchPayload.Count != 1 || nextBatchPayload.Thread == nil || nextBatchPayload.Thread.ID != batchedThreadID {
		t.Fatalf("batch-filtered next payload = %s", nextBatch.String())
	}
}

func TestCommentsCLIBatchSummarizesPublishedReviewRouting(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	for _, input := range []map[string]any{
		{"path": "README.md", "body": "Resolve this batch item", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1), "lineEnd": float64(1)}}},
		{"path": "README.md", "body": "Claim this batch item", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(3), "lineEnd": float64(3)}}},
	} {
		graphqlForCLI(t, server.URL, map[string]any{"operationName": "CreateDraftReviewComment", "query": `mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input: $input) { id } }`, "variables": map[string]any{"input": input}})
	}
	published := graphqlForCLI(t, server.URL, map[string]any{"operationName": "PublishDraftReviewComments", "query": `mutation PublishDraftReviewComments { publishDraftReviewComments { reviewBatchId threads { id status } } }`})["publishDraftReviewComments"].(map[string]any)
	reviewBatchID := published["reviewBatchId"].(string)
	threads := published["threads"].([]any)
	if len(threads) != 2 {
		t.Fatalf("published threads = %#v", threads)
	}
	resolvedThreadID := threads[0].(map[string]any)["id"].(string)
	claimedThreadID := threads[1].(map[string]any)["id"].(string)

	runCommentsCLIForTest(t, "claim", claimedThreadID, "--url", server.URL, "--actor", "codex:batch-agent", "--actor-kind", "codex", "--client-event-id", "batch-claim-1", "--lease", "30s", "--json")
	runCommentsCLIForTest(t, "done", resolvedThreadID, "--url", server.URL, "--actor", "codex:batch-agent", "--actor-kind", "codex", "--body", "Resolved as part of the batch", "--json")

	batch := runCommentsCLIForTest(t, "batch", reviewBatchID, "--url", server.URL, "--actor", "codex:batch-agent", "--actor-kind", "codex", "--full", "--json")
	var payload struct {
		ReviewBatchID string `json:"reviewBatchId"`
		Actor         struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		} `json:"actor"`
		Cursor  string                `json:"cursor"`
		Count   int                   `json:"count"`
		Summary map[string]any        `json:"summary"`
		Threads []commentThreadOutput `json:"threads"`
		Open    struct {
			Count   int                   `json:"count"`
			Summary commentRoutingSummary `json:"summary"`
			Mine    struct {
				Threads []commentThreadOutput   `json:"threads"`
				Claims  []commentActivityOutput `json:"claims"`
				Items   []commentWorkItemOutput `json:"items"`
				Count   int                     `json:"count"`
			} `json:"mine"`
			Unclaimed struct {
				Threads []commentThreadOutput `json:"threads"`
				Count   int                   `json:"count"`
			} `json:"unclaimed"`
			ClaimedByOthers struct {
				Threads []commentThreadOutput `json:"threads"`
				Count   int                   `json:"count"`
			} `json:"claimedByOthers"`
		} `json:"open"`
		Items []commentWorkItemOutput `json:"items"`
	}
	decodeCLIJSON(t, batch, &payload)
	if payload.ReviewBatchID != reviewBatchID || payload.Actor.ID != "codex:batch-agent" || payload.Actor.Kind != "codex" {
		t.Fatalf("batch identity payload = %s", batch.String())
	}
	if payload.Count != 2 || len(payload.Threads) != 2 || !strings.HasPrefix(payload.Cursor, "batch:") {
		t.Fatalf("batch thread metadata = %s", batch.String())
	}
	if payload.Summary["total"] != float64(2) || payload.Summary["open"] != float64(1) || payload.Summary["resolved"] != float64(1) || payload.Summary["archived"] != float64(0) || payload.Summary["complete"] != false {
		t.Fatalf("batch summary = %#v", payload.Summary)
	}
	if payload.Open.Count != 1 || payload.Open.Mine.Count != 1 || len(payload.Open.Mine.Threads) != 1 || payload.Open.Mine.Threads[0].ID != claimedThreadID {
		t.Fatalf("batch open routing = %#v", payload.Open)
	}
	if !payload.Open.Summary.RequiresAttention || payload.Open.Summary.RecommendedAction != "resume_owned_work" || payload.Open.Summary.OpenThreadCount != 1 || payload.Open.Summary.MineCount != 1 || payload.Open.Summary.UnclaimedCount != 0 || payload.Open.Summary.ClaimedByOthersCount != 0 || !containsString(payload.Open.Summary.AttentionReasons, "owned_live_claims") {
		t.Fatalf("batch open summary = %#v", payload.Open.Summary)
	}
	if len(payload.Open.Summary.SuggestedCommands) != 3 || payload.Open.Summary.SuggestedCommands[0].Intent != "renew_owned_claim" || payload.Open.Summary.SuggestedCommands[0].Command != "comments renew" || !strings.HasPrefix(payload.Open.Summary.SuggestedCommands[0].ClientEventID, "batch:") || !containsString(payload.Open.Summary.SuggestedCommands[0].Args, payload.Open.Summary.SuggestedCommands[0].ClientEventID) || payload.Open.Summary.SuggestedCommands[1].Command != "comments follow" || payload.Open.Summary.SuggestedCommands[2].Command != "comments check" {
		t.Fatalf("batch open summary suggestions = %#v", payload.Open.Summary.SuggestedCommands)
	}
	if len(payload.Open.Mine.Claims) != 1 || payload.Open.Mine.Claims[0].ClientEventID != "batch-claim-1" {
		t.Fatalf("batch mine claims = %#v", payload.Open.Mine.Claims)
	}
	if payload.Open.Unclaimed.Count != 0 || payload.Open.ClaimedByOthers.Count != 0 {
		t.Fatalf("batch unexpected other open routing = %#v", payload.Open)
	}
	if len(payload.Items) != 2 {
		t.Fatalf("batch full items = %#v", payload.Items)
	}
	if len(payload.Open.Mine.Items) != 1 || payload.Open.Mine.Items[0].Thread.ID != claimedThreadID || !containsActivity(payload.Open.Mine.Items[0].Activities, "thread_claimed", "batch-claim-1") {
		t.Fatalf("batch mine rich item = %#v", payload.Open.Mine.Items)
	}
}

func TestCommentsCLINextReturnsOldestOpenThreadForAgentWork(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	firstID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "First open item")
	time.Sleep(time.Millisecond)
	secondID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Second open item")

	next := runCommentsCLIForTest(t, "next", "--url", server.URL, "--actor", "codex:next-test", "--actor-kind", "codex", "--client-event-id", "next-open-1", "--json")
	var nextPayload struct {
		Thread    *commentThreadOutput  `json:"thread"`
		Cursor    string                `json:"cursor"`
		Count     int                   `json:"count"`
		Remaining int                   `json:"remaining"`
		Summary   commentRoutingSummary `json:"summary"`
	}
	decodeCLIJSON(t, next, &nextPayload)
	if nextPayload.Thread == nil || nextPayload.Thread.ID != firstID {
		t.Fatalf("next payload = %s", next.String())
	}
	if nextPayload.Count != 2 || nextPayload.Remaining != 1 || !strings.HasPrefix(nextPayload.Cursor, "open:") {
		t.Fatalf("next worklist metadata = %#v", nextPayload)
	}

	activities := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "Activities",
		"query":         `query Activities($threadId: ID!) { commentThreadActivities(threadId: $threadId) { type actor { id kind } clientEventId } }`,
		"variables":     map[string]any{"threadId": firstID},
	})["commentThreadActivities"].([]any)
	last := activities[len(activities)-1].(map[string]any)
	actor := last["actor"].(map[string]any)
	if last["type"] != "thread_read" || last["clientEventId"] != "next-open-1" || actor["id"] != "codex:next-test" || actor["kind"] != "codex" {
		t.Fatalf("next read activity = %#v", last)
	}

	nextWithContext := runCommentsCLIForTest(t, "next", "--url", server.URL, "--actor", "codex:next-test", "--actor-kind", "codex", "--client-event-id", "next-open-context-1", "--context-lines", "1", "--with-context", "--with-activities", "--json")
	var nextContextPayload struct {
		Thread     *commentThreadOutput    `json:"thread"`
		Activities []commentActivityOutput `json:"activities"`
		File       struct {
			Path       string `json:"path"`
			ViewerKind string `json:"viewerKind"`
			Encoding   string `json:"encoding"`
		} `json:"file"`
		Source sourceContextOutput `json:"source"`
	}
	decodeCLIJSON(t, nextWithContext, &nextContextPayload)
	if nextContextPayload.Thread == nil || nextContextPayload.Thread.ID != firstID {
		t.Fatalf("next with context selected wrong thread = %s", nextWithContext.String())
	}
	if nextContextPayload.File.Path != "README.md" || nextContextPayload.File.ViewerKind != "markdown" || nextContextPayload.File.Encoding != "utf8" {
		t.Fatalf("next with context file metadata = %s", nextWithContext.String())
	}
	if !nextContextPayload.Source.Available || len(nextContextPayload.Source.Lines) != 2 || !nextContextPayload.Source.Lines[0].Anchor {
		t.Fatalf("next with context source = %#v", nextContextPayload.Source)
	}
	if !containsActivity(nextContextPayload.Activities, "thread_read", "next-open-context-1") {
		t.Fatalf("next with activities did not include read receipt: %#v", nextContextPayload.Activities)
	}

	runCommentsCLIForTest(t, "resolve", firstID, "--url", server.URL, "--actor", "codex:next-test", "--actor-kind", "codex", "--json")
	afterResolve := runCommentsCLIForTest(t, "next", "--url", server.URL, "--actor", "codex:next-test", "--actor-kind", "codex", "--client-event-id", "next-open-2", "--json")
	decodeCLIJSON(t, afterResolve, &nextPayload)
	if nextPayload.Thread == nil || nextPayload.Thread.ID != secondID || nextPayload.Count != 1 || nextPayload.Remaining != 0 {
		t.Fatalf("next after resolve = %s", afterResolve.String())
	}

	runCommentsCLIForTest(t, "resolve", secondID, "--url", server.URL, "--actor", "codex:next-test", "--actor-kind", "codex", "--json")
	empty := runCommentsCLIForTest(t, "next", "--url", server.URL, "--actor", "codex:next-test", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, empty, &nextPayload)
	if nextPayload.Thread != nil || nextPayload.Count != 0 || nextPayload.Remaining != 0 {
		t.Fatalf("empty next = %s", empty.String())
	}
	if nextPayload.Summary.RequiresAttention || nextPayload.Summary.RecommendedAction != "wait_for_gui_feedback" || nextPayload.Summary.OpenThreadCount != 0 || nextPayload.Summary.UnclaimedCount != 0 || nextPayload.Summary.ClaimedByOthersCount != 0 {
		t.Fatalf("empty next summary = %#v", nextPayload.Summary)
	}
	if len(nextPayload.Summary.SuggestedCommands) != 1 || nextPayload.Summary.SuggestedCommands[0].Command != "comments work" || !containsString(nextPayload.Summary.SuggestedCommands[0].Args, "--wait") || !containsString(nextPayload.Summary.SuggestedCommands[0].Args, "--loop") {
		t.Fatalf("empty next suggestions = %#v", nextPayload.Summary.SuggestedCommands)
	}
}

func TestCommentsCLIClaimLeasesNextOpenThreadForAgentWork(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	firstID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "First claimable item")
	time.Sleep(time.Millisecond)
	secondID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Second claimable item")

	claimed := runCommentsCLIForTest(t, "claim", "--url", server.URL, "--actor", "codex:claim-1", "--actor-kind", "codex", "--client-event-id", "claim-open-1", "--lease", "30s", "--with-activities", "--json")
	var claimPayload struct {
		Thread     *commentThreadOutput        `json:"thread"`
		Claim      *commentActivityOutput      `json:"claim"`
		Summary    commentActivityBatchSummary `json:"summary"`
		Cursor     string                      `json:"cursor"`
		Count      int                         `json:"count"`
		Remaining  int                         `json:"remaining"`
		Activities []commentActivityOutput     `json:"activities"`
	}
	decodeCLIJSON(t, claimed, &claimPayload)
	if claimPayload.Thread == nil || claimPayload.Thread.ID != firstID || claimPayload.Thread.Status != "open" {
		t.Fatalf("claim payload = %s", claimed.String())
	}
	if claimPayload.Claim == nil || claimPayload.Claim.Type != "thread_claimed" || claimPayload.Claim.ClientEventID != "claim-open-1" || claimPayload.Claim.LeaseExpiresAt == "" {
		t.Fatalf("claim activity = %#v", claimPayload.Claim)
	}
	if claimPayload.Count != 2 || claimPayload.Remaining != 1 || !strings.HasPrefix(claimPayload.Cursor, "open:") {
		t.Fatalf("claim worklist metadata = %#v", claimPayload)
	}
	if claimPayload.Summary.RecommendedAction != "start_work" || !claimPayload.Summary.RequiresAttention || !containsString(claimPayload.Summary.AttentionReasons, "claimed_open_thread") || len(claimPayload.Summary.SuggestedCommands) != 4 || claimPayload.Summary.SuggestedCommands[0].Intent != "acknowledge_initial_feedback" || claimPayload.Summary.SuggestedCommands[0].Command != "comments triage" || claimPayload.Summary.SuggestedCommands[0].StdinSchema != "commentTriageFileInput" || !containsString(claimPayload.Summary.SuggestedCommands[0].Args, server.URL) || claimPayload.Summary.SuggestedCommands[2].Command != "comments done" || claimPayload.Summary.SuggestedCommands[3].Command != "comments dismiss" {
		t.Fatalf("claim summary suggestions = %#v", claimPayload.Summary)
	}
	if !containsActivity(claimPayload.Activities, "thread_claimed", "claim-open-1") {
		t.Fatalf("claim activities did not include lease: %#v", claimPayload.Activities)
	}

	retried := runCommentsCLIForTest(t, "claim", firstID, "--url", server.URL, "--actor", "codex:claim-1", "--actor-kind", "codex", "--client-event-id", "claim-open-1", "--lease", "30s", "--json")
	var retriedPayload struct {
		Thread *commentThreadOutput   `json:"thread"`
		Claim  *commentActivityOutput `json:"claim"`
	}
	decodeCLIJSON(t, retried, &retriedPayload)
	if retriedPayload.Thread == nil || retriedPayload.Thread.ID != firstID || retriedPayload.Claim == nil || retriedPayload.Claim.ID != claimPayload.Claim.ID {
		t.Fatalf("idempotent claim payload = %s", retried.String())
	}

	renewed := runCommentsCLIForTest(t, "renew", firstID, "--url", server.URL, "--actor", "codex:claim-1", "--actor-kind", "codex", "--client-event-id", "renew-open-1", "--lease", "45s", "--with-activities", "--json")
	var renewedPayload struct {
		Thread     *commentThreadOutput    `json:"thread"`
		Renewal    *commentActivityOutput  `json:"renewal"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, renewed, &renewedPayload)
	if renewedPayload.Thread == nil || renewedPayload.Thread.ID != firstID || renewedPayload.Thread.Status != "open" {
		t.Fatalf("renew thread = %s", renewed.String())
	}
	if renewedPayload.Renewal == nil || renewedPayload.Renewal.Type != "thread_claimed" || renewedPayload.Renewal.ClientEventID != "renew-open-1" || renewedPayload.Renewal.LeaseExpiresAt == "" {
		t.Fatalf("renew activity = %#v", renewedPayload.Renewal)
	}
	if renewedPayload.Renewal.ID == claimPayload.Claim.ID {
		t.Fatalf("renew should append a fresh lease activity, got original claim id %q", renewedPayload.Renewal.ID)
	}
	if !containsActivity(renewedPayload.Activities, "thread_claimed", "renew-open-1") {
		t.Fatalf("renew activities did not include refreshed lease: %#v", renewedPayload.Activities)
	}

	secondClaim := runCommentsCLIForTest(t, "claim", "--url", server.URL, "--actor", "claude-code:claim-2", "--actor-kind", "claude_code", "--client-event-id", "claim-open-2", "--lease", "30s", "--json")
	var secondPayload struct {
		Thread *commentThreadOutput   `json:"thread"`
		Claim  *commentActivityOutput `json:"claim"`
	}
	decodeCLIJSON(t, secondClaim, &secondPayload)
	if secondPayload.Thread == nil || secondPayload.Thread.ID != secondID || secondPayload.Claim == nil || secondPayload.Claim.Type != "thread_claimed" {
		t.Fatalf("second claim skipped leased thread incorrectly = %s", secondClaim.String())
	}

	contended := runCommentsCLIForTest(t, "claim", "--url", server.URL, "--actor", "codex:claim-contender", "--actor-kind", "codex", "--client-event-id", "claim-contended-1", "--lease", "30s", "--full", "--json")
	var contendedPayload struct {
		Thread    *commentThreadOutput   `json:"thread"`
		Claim     *commentActivityOutput `json:"claim"`
		Summary   commentRoutingSummary  `json:"summary"`
		Cursor    string                 `json:"cursor"`
		Count     int                    `json:"count"`
		Remaining int                    `json:"remaining"`
	}
	decodeCLIJSON(t, contended, &contendedPayload)
	if contendedPayload.Thread != nil || contendedPayload.Claim != nil || contendedPayload.Count != 2 || contendedPayload.Remaining != 0 {
		t.Fatalf("contended claim payload = %s", contended.String())
	}
	if !contendedPayload.Summary.RequiresAttention || contendedPayload.Summary.RecommendedAction != "wait_for_claim_release" || contendedPayload.Summary.OpenThreadCount != 2 || contendedPayload.Summary.MineCount != 0 || contendedPayload.Summary.UnclaimedCount != 0 || contendedPayload.Summary.ClaimedByOthersCount != 2 || !containsString(contendedPayload.Summary.AttentionReasons, "open_threads_claimed_by_others") {
		t.Fatalf("contended claim summary = %#v", contendedPayload.Summary)
	}
	if len(contendedPayload.Summary.SuggestedCommands) != 1 || contendedPayload.Summary.SuggestedCommands[0].Command != "comments watch" || !containsString(contendedPayload.Summary.SuggestedCommands[0].Args, "--cursor") || !containsString(contendedPayload.Summary.SuggestedCommands[0].Args, contendedPayload.Cursor) {
		t.Fatalf("contended claim suggestions = %#v", contendedPayload.Summary.SuggestedCommands)
	}

	mine := runCommentsCLIForTest(t, "mine", "--url", server.URL, "--actor", "codex:claim-1", "--actor-kind", "codex", "--with-activities", "--json")
	var minePayload struct {
		Actor   actorOutput             `json:"actor"`
		Summary commentRoutingSummary   `json:"summary"`
		Threads []commentThreadOutput   `json:"threads"`
		Claims  []commentActivityOutput `json:"claims"`
		Items   []commentWorkItemOutput `json:"items"`
		Count   int                     `json:"count"`
		Cursor  string                  `json:"cursor"`
	}
	decodeCLIJSON(t, mine, &minePayload)
	if minePayload.Count != 1 || len(minePayload.Threads) != 1 || minePayload.Threads[0].ID != firstID {
		t.Fatalf("mine payload = %s", mine.String())
	}
	if minePayload.Actor.ID != "codex:claim-1" || minePayload.Actor.Kind != "codex" {
		t.Fatalf("mine actor = %#v", minePayload.Actor)
	}
	if !minePayload.Summary.RequiresAttention || minePayload.Summary.RecommendedAction != "resume_owned_work" || minePayload.Summary.OpenThreadCount != 1 || minePayload.Summary.MineCount != 1 || minePayload.Summary.UnclaimedCount != 0 || minePayload.Summary.ClaimedByOthersCount != 0 || !containsString(minePayload.Summary.AttentionReasons, "owned_live_claims") {
		t.Fatalf("mine summary = %#v", minePayload.Summary)
	}
	if len(minePayload.Summary.SuggestedCommands) != 3 || minePayload.Summary.SuggestedCommands[0].Intent != "renew_owned_claim" || minePayload.Summary.SuggestedCommands[0].Command != "comments renew" || !containsString(minePayload.Summary.SuggestedCommands[0].Args, server.URL) || !containsString(minePayload.Summary.SuggestedCommands[0].Args, minePayload.Summary.SuggestedCommands[0].ClientEventID) || minePayload.Summary.SuggestedCommands[1].Command != "comments follow" || !containsString(minePayload.Summary.SuggestedCommands[1].Args, server.URL) || minePayload.Summary.SuggestedCommands[2].Command != "comments check" || !containsString(minePayload.Summary.SuggestedCommands[2].Args, server.URL) {
		t.Fatalf("mine summary suggestions = %#v", minePayload.Summary.SuggestedCommands)
	}
	if len(minePayload.Claims) != 1 || minePayload.Claims[0].ID != renewedPayload.Renewal.ID {
		t.Fatalf("mine claims = %#v", minePayload.Claims)
	}
	if len(minePayload.Items) != 1 || minePayload.Items[0].Thread.ID != firstID || !containsActivity(minePayload.Items[0].Activities, "thread_claimed", "renew-open-1") {
		t.Fatalf("mine items = %#v", minePayload.Items)
	}
	if !strings.HasPrefix(minePayload.Cursor, "open:") {
		t.Fatalf("mine cursor = %q", minePayload.Cursor)
	}

	releaseBody := "Returning this one for another agent after triage"
	released := runCommentsCLIForTest(t, "release", firstID, "--url", server.URL, "--actor", "codex:claim-1", "--actor-kind", "codex", "--client-event-id", "release-open-1", "--body", releaseBody, "--with-activities", "--json")
	var releasePayload struct {
		Thread     commentThreadOutput     `json:"thread"`
		Comment    *commentOutput          `json:"comment"`
		Release    commentActivityOutput   `json:"release"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, released, &releasePayload)
	if releasePayload.Thread.ID != firstID || releasePayload.Thread.Status != "open" {
		t.Fatalf("release thread = %s", released.String())
	}
	if releasePayload.Release.Type != "thread_claim_released" || releasePayload.Release.ClientEventID != "release-open-1" {
		t.Fatalf("release activity = %#v", releasePayload.Release)
	}
	if releasePayload.Comment == nil || releasePayload.Comment.Body != releaseBody || releasePayload.Comment.CreatedBy.ID != "codex:claim-1" {
		t.Fatalf("release comment = %#v", releasePayload.Comment)
	}
	if !containsActivity(releasePayload.Activities, "comment_added", "") {
		t.Fatalf("release activities did not include handoff comment: %#v", releasePayload.Activities)
	}
	if !containsActivity(releasePayload.Activities, "thread_claim_released", "release-open-1") {
		t.Fatalf("release activities = %#v", releasePayload.Activities)
	}

	afterReleaseMine := runCommentsCLIForTest(t, "mine", "--url", server.URL, "--actor", "codex:claim-1", "--actor-kind", "codex", "--json")
	minePayload = struct {
		Actor   actorOutput             `json:"actor"`
		Summary commentRoutingSummary   `json:"summary"`
		Threads []commentThreadOutput   `json:"threads"`
		Claims  []commentActivityOutput `json:"claims"`
		Items   []commentWorkItemOutput `json:"items"`
		Count   int                     `json:"count"`
		Cursor  string                  `json:"cursor"`
	}{}
	decodeCLIJSON(t, afterReleaseMine, &minePayload)
	if minePayload.Count != 0 || len(minePayload.Threads) != 0 || len(minePayload.Claims) != 0 {
		t.Fatalf("mine after release = %s", afterReleaseMine.String())
	}
	if minePayload.Summary.RequiresAttention || minePayload.Summary.RecommendedAction != "wait_for_gui_feedback" || minePayload.Summary.MineCount != 0 || len(minePayload.Summary.SuggestedCommands) != 0 {
		t.Fatalf("mine summary after release = %#v", minePayload.Summary)
	}

	reclaimed := runCommentsCLIForTest(t, "claim", firstID, "--url", server.URL, "--actor", "claude-code:claim-2", "--actor-kind", "claude_code", "--client-event-id", "claim-open-3", "--lease", "30s", "--json")
	var reclaimedPayload struct {
		Thread *commentThreadOutput   `json:"thread"`
		Claim  *commentActivityOutput `json:"claim"`
	}
	decodeCLIJSON(t, reclaimed, &reclaimedPayload)
	if reclaimedPayload.Thread == nil || reclaimedPayload.Thread.ID != firstID || reclaimedPayload.Claim == nil || reclaimedPayload.Claim.Type != "thread_claimed" {
		t.Fatalf("reclaim after release = %s", reclaimed.String())
	}
}

func TestCommentsCLIHoldKeepsClaimLeaseRenewed(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Hold this while tests run")

	held := runCommentsCLIForTest(t, "hold", threadID, "--url", server.URL, "--actor", "codex:hold-1", "--actor-kind", "codex", "--client-event-id", "hold-open-1", "--lease", "30s", "--interval", "10ms", "--max-events", "2", "--json")
	decoder := json.NewDecoder(strings.NewReader(held.String()))
	var events []commentHoldEvent
	for decoder.More() {
		var event commentHoldEvent
		if err := decoder.Decode(&event); err != nil {
			t.Fatalf("decode hold event: %v\n%s", err, held.String())
		}
		events = append(events, event)
	}
	if len(events) != 2 {
		t.Fatalf("hold emitted %d events: %s", len(events), held.String())
	}
	for index, event := range events {
		sequence := index + 1
		expectedClientEventID := fmt.Sprintf("hold-open-1:%d", sequence)
		if event.Type != "comment_claim_renewed" || event.Sequence != sequence || event.Thread.ID != threadID {
			t.Fatalf("hold event[%d] = %#v", index, event)
		}
		if event.Renewal.Type != "thread_claimed" || event.Renewal.Actor.ID != "codex:hold-1" || event.Renewal.ClientEventID != expectedClientEventID || event.Renewal.LeaseExpiresAt == "" {
			t.Fatalf("hold renewal[%d] = %#v", index, event.Renewal)
		}
	}
	if events[0].Renewal.ID == events[1].Renewal.ID {
		t.Fatalf("hold reused renewal activity id %q", events[0].Renewal.ID)
	}

	show := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showPayload struct {
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, show, &showPayload)
	if !containsActivity(showPayload.Activities, "thread_claimed", "hold-open-1:1") || !containsActivity(showPayload.Activities, "thread_claimed", "hold-open-1:2") {
		t.Fatalf("hold activities = %#v", showPayload.Activities)
	}
}

func TestCommentsCLIClaimWaitsUntilClaimableWorkAppears(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var output bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- runCommentsCommand(ctx, []string{
			"claim",
			"--wait",
			"--url", server.URL,
			"--actor", "codex:claim-wait",
			"--actor-kind", "codex",
			"--client-event-id", "claim-wait-open-1",
			"--interval", "10ms",
			"--full",
			"--json",
		}, &output)
	}()

	time.Sleep(30 * time.Millisecond)
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Claim this after waiting")
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("claim --wait failed: %v\noutput:\n%s", err, output.String())
		}
	case <-ctx.Done():
		t.Fatalf("claim --wait timed out: %v\noutput:\n%s", ctx.Err(), output.String())
	}

	var payload struct {
		Thread  *commentThreadOutput        `json:"thread"`
		Claim   *commentActivityOutput      `json:"claim"`
		Summary commentActivityBatchSummary `json:"summary"`
		Source  *sourceContextOutput        `json:"source"`
	}
	decodeCLIJSON(t, &output, &payload)
	if payload.Thread == nil || payload.Thread.ID != threadID || payload.Thread.Status != "open" {
		t.Fatalf("claim --wait thread payload = %s", output.String())
	}
	if payload.Claim == nil || payload.Claim.Type != "thread_claimed" || payload.Claim.ClientEventID != "claim-wait-open-1" || payload.Claim.LeaseExpiresAt == "" {
		t.Fatalf("claim --wait claim = %#v", payload.Claim)
	}
	if payload.Source == nil || !payload.Source.Available {
		t.Fatalf("claim --wait source = %#v", payload.Source)
	}
	if payload.Summary.RecommendedAction != "start_work" || len(payload.Summary.SuggestedCommands) != 4 || payload.Summary.SuggestedCommands[0].Intent != "acknowledge_initial_feedback" || payload.Summary.SuggestedCommands[0].StdinSchema != "commentTriageFileInput" || !containsString(payload.Summary.SuggestedCommands[0].Args, server.URL) {
		t.Fatalf("claim --wait summary suggestions = %#v", payload.Summary)
	}
}

func TestCommentsCLIWorkTailorsSuggestionsForSourceUnavailableThread(t *testing.T) {
	server := newCommentsCLITestServerWithSetup(t, func(root string) {
		if err := os.WriteFile(filepath.Join(root, "stale.md"), []byte("# Stale\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	})
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "stale.md", "Feedback on a file that will disappear")
	if err := os.Remove(filepath.Join(server.Root, "stale.md")); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", threadID, "--url", server.URL, "--actor", "codex:missing-source", "--actor-kind", "codex", "--client-event-id", "work-missing-source-1", "--lease", "30s", "--full", "--interval", "10ms", "--max-events", "1", "--json")
	claimed := receiveWorkEvent(t, events)
	if claimed.Type != "comment_work_claimed" || claimed.Thread.ID != threadID || claimed.Claim.Type != "thread_claimed" {
		t.Fatalf("work source-unavailable payload = %#v", claimed)
	}
	if claimed.Source == nil || claimed.Source.Available || claimed.Source.Reason != "source_unavailable" {
		t.Fatalf("work source-unavailable source = %#v", claimed.Source)
	}
	if claimed.Source.SourceState != "unavailable" {
		t.Fatalf("work source-unavailable source state = %#v", claimed.Source)
	}
	if claimed.Diff == nil || claimed.Diff.Status != "unavailable" || claimed.Diff.Reason != "source_unavailable" {
		t.Fatalf("work source-unavailable diff = %#v", claimed.Diff)
	}
	if claimed.Summary.RecommendedAction != "handle_source_unavailable" || !containsString(claimed.Summary.AttentionReasons, "source_unavailable") || len(claimed.Summary.SuggestedCommands) != 3 {
		t.Fatalf("work source-unavailable summary = %#v", claimed.Summary)
	}
	first := claimed.Summary.SuggestedCommands[0]
	if first.Intent != "handoff_after_source_unavailable" || first.Command != "comments release" || first.StdinSchema != "commentTriageFileInput" || !containsString(first.Args, server.URL) {
		t.Fatalf("work source-unavailable first suggestion = %#v", first)
	}
	nextAction, _ := first.StdinExample["nextAction"].(string)
	if strings.Contains(nextAction, "Inspect the referenced file") || !strings.Contains(nextAction, "updated anchor") {
		t.Fatalf("work source-unavailable stdin example = %#v", first.StdinExample)
	}
	if claimed.Summary.SuggestedCommands[1].Intent != "archive_after_source_unavailable_decision" || claimed.Summary.SuggestedCommands[1].Command != "comments dismiss" {
		t.Fatalf("work source-unavailable archive suggestion = %#v", claimed.Summary.SuggestedCommands[1])
	}
	if claimed.Summary.SuggestedCommands[2].Intent != "inspect_source_unavailable_thread" || claimed.Summary.SuggestedCommands[2].Command != "comments show" {
		t.Fatalf("work source-unavailable inspect suggestion = %#v", claimed.Summary.SuggestedCommands[2])
	}
	if err := <-done; err != nil {
		t.Fatalf("work source-unavailable returned error: %v", err)
	}
}

func TestCommentsCLIWorkMarksChangedSourceAnchors(t *testing.T) {
	server := newCommentsCLITestServerWithSetup(t, func(root string) {
		if err := os.WriteFile(filepath.Join(root, "stale.md"), []byte("# Stale\nold line\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	})
	defer server.Close()

	const anchorFileHash = "sha256:anchor-before-edit"
	data := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "CreateThread",
		"query": `mutation CreateThread($input: CommentInput!) {
			createThread(input: $input) { id }
		}`,
		"variables": map[string]any{"input": map[string]any{
			"path": "stale.md",
			"body": "Feedback on a line before the file changed",
			"actor": map[string]any{
				"id":          "human:tasuku",
				"kind":        "human",
				"displayName": "Tasuku",
			},
			"anchor": map[string]any{
				"surface": "source",
				"canonical": map[string]any{
					"path":      "stale.md",
					"lineStart": float64(1),
					"lineEnd":   float64(1),
					"quote":     "# Stale",
					"fileHash":  anchorFileHash,
				},
			},
		}},
	})
	created := data["createThread"].(map[string]any)
	threadID := created["id"].(string)
	if err := os.WriteFile(filepath.Join(server.Root, "stale.md"), []byte("# Stale\nnew line\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", threadID, "--url", server.URL, "--actor", "codex:changed-source", "--actor-kind", "codex", "--client-event-id", "work-changed-source-1", "--lease", "30s", "--full", "--interval", "10ms", "--max-events", "1", "--json")
	claimed := receiveWorkEvent(t, events)
	if claimed.Type != "comment_work_claimed" || claimed.Thread.ID != threadID || claimed.Claim.Type != "thread_claimed" {
		t.Fatalf("work changed-source payload = %#v", claimed)
	}
	if claimed.Source == nil || !claimed.Source.Available {
		t.Fatalf("work changed-source source = %#v", claimed.Source)
	}
	if claimed.Source.SourceState != "changed" || !claimed.Source.SourceChanged {
		t.Fatalf("work changed-source state = %#v", claimed.Source)
	}
	if claimed.Source.AnchorFileHash != anchorFileHash || claimed.Source.FileHash == "" || claimed.Source.FileHash == anchorFileHash {
		t.Fatalf("work changed-source hashes = %#v", claimed.Source)
	}
	if len(claimed.Source.Lines) == 0 || claimed.Source.Lines[0].Text != "# Stale" {
		t.Fatalf("work changed-source lines = %#v", claimed.Source.Lines)
	}
	if err := <-done; err != nil {
		t.Fatalf("work changed-source returned error: %v", err)
	}
}

func TestCommentsCLIInboxClassifiesOpenAgentWork(t *testing.T) {
	server := newCommentsCLITestServerWithSetup(t, func(root string) {
		if err := os.WriteFile(filepath.Join(root, "stale.md"), []byte("# Stale\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	})
	defer server.Close()

	mineID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Already claimed by this agent")
	time.Sleep(time.Millisecond)
	otherID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Claimed by another agent")
	time.Sleep(time.Millisecond)
	unclaimedID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Unclaimed follow-up")
	time.Sleep(time.Millisecond)
	createCommentThreadForCLIWithBody(t, server.URL, "stale.md", "Stale thread from another root")
	if err := os.Remove(filepath.Join(server.Root, "stale.md")); err != nil {
		t.Fatal(err)
	}

	runCommentsCLIForTest(t, "claim", mineID, "--url", server.URL, "--actor", "codex:inbox-1", "--actor-kind", "codex", "--client-event-id", "inbox-claim-mine", "--lease", "30s", "--json")
	runCommentsCLIForTest(t, "claim", otherID, "--url", server.URL, "--actor", "claude-code:inbox-2", "--actor-kind", "claude_code", "--client-event-id", "inbox-claim-other", "--lease", "30s", "--json")

	inbox := runCommentsCLIForTest(t, "inbox", "--url", server.URL, "--actor", "codex:inbox-1", "--actor-kind", "codex", "--with-activities", "--json")
	var inboxPayload struct {
		SchemaVersion     int                     `json:"schemaVersion"`
		SchemaCommand     []string                `json:"schemaCommand"`
		Actor             actorOutput             `json:"actor"`
		Cursor            string                  `json:"cursor"`
		Count             int                     `json:"count"`
		Summary           commentRoutingSummary   `json:"summary"`
		Mine              commentInboxGroupOutput `json:"mine"`
		Unclaimed         commentInboxGroupOutput `json:"unclaimed"`
		ClaimedByOthers   commentInboxGroupOutput `json:"claimedByOthers"`
		SourceUnavailable commentInboxGroupOutput `json:"sourceUnavailable"`
	}
	decodeCLIJSON(t, inbox, &inboxPayload)
	if inboxPayload.Actor.ID != "codex:inbox-1" || inboxPayload.Actor.Kind != "codex" {
		t.Fatalf("inbox actor = %#v", inboxPayload.Actor)
	}
	if inboxPayload.SchemaVersion != commentsStreamSchemaVersion || !containsString(inboxPayload.SchemaCommand, "commentInboxOutput") {
		t.Fatalf("inbox schema metadata = %s", inbox.String())
	}
	if inboxPayload.Count != 4 || !strings.HasPrefix(inboxPayload.Cursor, "open:") {
		t.Fatalf("inbox metadata = %s", inbox.String())
	}
	if !inboxPayload.Summary.RequiresAttention || inboxPayload.Summary.RecommendedAction != "resume_owned_work" || inboxPayload.Summary.TotalOpenThreadCount != 4 || inboxPayload.Summary.OpenThreadCount != 3 || inboxPayload.Summary.SourceUnavailableCount != 1 || inboxPayload.Summary.MineCount != 1 || inboxPayload.Summary.UnclaimedCount != 1 || inboxPayload.Summary.ClaimedByOthersCount != 1 || !containsString(inboxPayload.Summary.AttentionReasons, "owned_live_claims") {
		t.Fatalf("inbox summary = %#v", inboxPayload.Summary)
	}
	if len(inboxPayload.Summary.SuggestedCommands) != 3 || inboxPayload.Summary.SuggestedCommands[0].Intent != "renew_owned_claim" || inboxPayload.Summary.SuggestedCommands[0].Command != "comments renew" || !strings.HasPrefix(inboxPayload.Summary.SuggestedCommands[0].DisplayCommand, "vivi comments renew "+mineID+" --actor codex:inbox-1") || !strings.Contains(inboxPayload.Summary.SuggestedCommands[0].DisplayCommand, " --url "+server.URL+" ") || inboxPayload.Summary.SuggestedCommands[0].ClientEventID == "" || !containsString(inboxPayload.Summary.SuggestedCommands[0].Args, inboxPayload.Summary.SuggestedCommands[0].ClientEventID) || inboxPayload.Summary.SuggestedCommands[1].Command != "comments follow" || inboxPayload.Summary.SuggestedCommands[2].Command != "comments check" {
		t.Fatalf("inbox summary suggestions = %#v", inboxPayload.Summary.SuggestedCommands)
	}
	if inboxPayload.Mine.Count != 1 || len(inboxPayload.Mine.Threads) != 1 || inboxPayload.Mine.Threads[0].ID != mineID {
		t.Fatalf("mine group = %#v", inboxPayload.Mine)
	}
	if len(inboxPayload.Mine.Claims) != 1 || inboxPayload.Mine.Claims[0].ClientEventID != "inbox-claim-mine" {
		t.Fatalf("mine claims = %#v", inboxPayload.Mine.Claims)
	}
	if len(inboxPayload.Mine.Items) != 1 || !containsActivity(inboxPayload.Mine.Items[0].Activities, "thread_claimed", "inbox-claim-mine") {
		t.Fatalf("mine items = %#v", inboxPayload.Mine.Items)
	}
	if inboxPayload.Unclaimed.Count != 1 || len(inboxPayload.Unclaimed.Threads) != 1 || inboxPayload.Unclaimed.Threads[0].ID != unclaimedID {
		t.Fatalf("unclaimed group = %#v", inboxPayload.Unclaimed)
	}
	if inboxPayload.ClaimedByOthers.Count != 1 || len(inboxPayload.ClaimedByOthers.Threads) != 1 || inboxPayload.ClaimedByOthers.Threads[0].ID != otherID {
		t.Fatalf("claimed-by-others group = %#v", inboxPayload.ClaimedByOthers)
	}
	if len(inboxPayload.ClaimedByOthers.Claims) != 1 || inboxPayload.ClaimedByOthers.Claims[0].Actor.ID != "claude-code:inbox-2" {
		t.Fatalf("claimed-by-others claims = %#v", inboxPayload.ClaimedByOthers.Claims)
	}
	if inboxPayload.SourceUnavailable.Count != 1 || len(inboxPayload.SourceUnavailable.Threads) != 1 || inboxPayload.SourceUnavailable.Threads[0].Path != "stale.md" {
		t.Fatalf("source-unavailable group = %#v", inboxPayload.SourceUnavailable)
	}

	runCommentsCLIForTest(t, "release", mineID, "--url", server.URL, "--actor", "codex:inbox-1", "--actor-kind", "codex", "--client-event-id", "inbox-release-mine", "--json")
	afterRelease := runCommentsCLIForTest(t, "inbox", "--url", server.URL, "--actor", "codex:inbox-1", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, afterRelease, &inboxPayload)
	if inboxPayload.Mine.Count != 0 || len(inboxPayload.Mine.Threads) != 0 {
		t.Fatalf("mine after release = %s", afterRelease.String())
	}
	if inboxPayload.Unclaimed.Count != 2 || !containsCommentThread(inboxPayload.Unclaimed.Threads, mineID) || !containsCommentThread(inboxPayload.Unclaimed.Threads, unclaimedID) {
		t.Fatalf("unclaimed after release = %#v", inboxPayload.Unclaimed.Threads)
	}
	if !inboxPayload.Summary.RequiresAttention || inboxPayload.Summary.RecommendedAction != "claim_open_work" || inboxPayload.Summary.TotalOpenThreadCount != 4 || inboxPayload.Summary.OpenThreadCount != 3 || inboxPayload.Summary.SourceUnavailableCount != 1 || inboxPayload.Summary.MineCount != 0 || inboxPayload.Summary.UnclaimedCount != 2 || inboxPayload.Summary.ClaimedByOthersCount != 1 || len(inboxPayload.Summary.SuggestedCommands) != 1 || inboxPayload.Summary.SuggestedCommands[0].Intent != "claim_next_open_thread" || inboxPayload.Summary.SuggestedCommands[0].Command != "comments work" || inboxPayload.Summary.SuggestedCommands[0].ClientEventID == "" || !containsString(inboxPayload.Summary.SuggestedCommands[0].Args, "--once") {
		t.Fatalf("inbox summary after release = %#v", inboxPayload.Summary)
	}

	scopedInbox := runCommentsCLIForTest(t, "inbox", "--url", server.URL, "--actor", "codex:inbox-1", "--actor-kind", "codex", "--path", "README.md", "--json")
	decodeCLIJSON(t, scopedInbox, &inboxPayload)
	if len(inboxPayload.Summary.SuggestedCommands) != 1 || inboxPayload.Summary.SuggestedCommands[0].Command != "comments work" || !containsString(inboxPayload.Summary.SuggestedCommands[0].Args, "--path") || !containsString(inboxPayload.Summary.SuggestedCommands[0].Args, "README.md") || !strings.Contains(inboxPayload.Summary.SuggestedCommands[0].DisplayCommand, " --path README.md") {
		t.Fatalf("scoped inbox summary suggestion dropped path filter = %#v", inboxPayload.Summary.SuggestedCommands)
	}
}

func TestCommentsCLIInboxCanLimitEmittedThreadHistory(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Initial feedback")
	for _, body := range []string{"Second note", "Third note"} {
		graphqlForCLI(t, server.URL, map[string]any{
			"operationName": "AddComment",
			"query":         `mutation AddComment($threadId: ID!, $input: AddCommentInput!) { addComment(threadId: $threadId, input: $input) { id } }`,
			"variables": map[string]any{
				"threadId": threadID,
				"input": map[string]any{
					"body":  body,
					"actor": map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"},
				},
			},
		})
	}

	inbox := runCommentsCLIForTest(t, "inbox", "--url", server.URL, "--actor", "codex:history-limit", "--with-activities", "--comment-limit", "2", "--json")
	var inboxPayload struct {
		Unclaimed commentInboxGroupOutput `json:"unclaimed"`
	}
	decodeCLIJSON(t, inbox, &inboxPayload)
	if inboxPayload.Unclaimed.Count != 1 || len(inboxPayload.Unclaimed.Threads) != 1 || inboxPayload.Unclaimed.Threads[0].ID != threadID {
		t.Fatalf("unclaimed group = %#v", inboxPayload.Unclaimed)
	}
	threadComments := inboxPayload.Unclaimed.Threads[0].Comments
	if len(threadComments) != 2 || threadComments[0].Body != "Second note" || threadComments[1].Body != "Third note" {
		t.Fatalf("limited group thread comments = %#v", threadComments)
	}
	if len(inboxPayload.Unclaimed.Items) != 1 {
		t.Fatalf("unclaimed items = %#v", inboxPayload.Unclaimed.Items)
	}
	itemComments := inboxPayload.Unclaimed.Items[0].Thread.Comments
	if len(itemComments) != 2 || itemComments[0].Body != "Second note" || itemComments[1].Body != "Third note" {
		t.Fatalf("limited item thread comments = %#v", itemComments)
	}
}

func TestCommentsCLIDoneRepliesResolvesAndReusesCompletionReply(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	done := runCommentsCLIForTest(t, "done", threadID, "--url", server.URL, "--actor", "codex:done-test", "--actor-kind", "codex", "--body", "Fixed and verified", "--json")
	var donePayload struct {
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, done, &donePayload)
	if donePayload.Comment.ThreadID != threadID || donePayload.Comment.Body != "Fixed and verified" || donePayload.Comment.CreatedBy.ID != "codex:done-test" {
		t.Fatalf("done comment payload = %s", done.String())
	}
	if donePayload.Thread.ID != threadID || donePayload.Thread.Status != "resolved" || donePayload.Thread.ResolvedAt == "" {
		t.Fatalf("done thread payload = %s", done.String())
	}
	firstCompletionCommentID := donePayload.Comment.ID

	retry := runCommentsCLIForTest(t, "done", threadID, "--url", server.URL, "--actor", "codex:done-test", "--actor-kind", "codex", "--body", "Fixed and verified", "--json")
	decodeCLIJSON(t, retry, &donePayload)
	if donePayload.Comment.ID != firstCompletionCommentID || donePayload.Thread.Status != "resolved" {
		t.Fatalf("done retry payload = %s", retry.String())
	}

	show := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showPayload struct {
		Thread commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, show, &showPayload)
	if len(showPayload.Thread.Comments) != 2 {
		t.Fatalf("done retry duplicated comments: %s", show.String())
	}
}

func TestCommentsCLIClientEventIDMakesAgentWritesRetrySafe(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	replyThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please investigate this")
	firstReply := runCommentsCLIForTest(t, "reply", replyThreadID, "--url", server.URL, "--actor", "codex:retry-safe", "--actor-kind", "codex", "--client-event-id", "reply-retry-1", "--body", "Initial retry-safe reply", "--json")
	var replyPayload struct {
		Comment commentOutput       `json:"comment"`
		Receipt commentWriteReceipt `json:"receipt"`
	}
	decodeCLIJSON(t, firstReply, &replyPayload)
	firstReplyID := replyPayload.Comment.ID
	if replyPayload.Comment.Body != "Initial retry-safe reply" {
		t.Fatalf("first reply payload = %s", firstReply.String())
	}
	if replyPayload.Receipt.ReceiptSchema != "commentWriteReceipt" || !containsString(replyPayload.Receipt.ReceiptSchemaCommand, "commentWriteReceipt") || replyPayload.Receipt.VerificationSchema != "commentWriteReceiptVerification" || !containsString(replyPayload.Receipt.VerificationCommand, "verify-receipt") || !containsString(replyPayload.Receipt.VerificationCommand, "--url") || !containsString(replyPayload.Receipt.VerificationCommand, server.URL) || replyPayload.Receipt.Command != "comments reply" || replyPayload.Receipt.ThreadID != replyThreadID || replyPayload.Receipt.ActorID != "codex:retry-safe" || replyPayload.Receipt.ClientEventID != "reply-retry-1" || replyPayload.Receipt.CommentID != firstReplyID || !containsReceiptEffect(replyPayload.Receipt.Effects, "comment_added", "reply-retry-1") {
		t.Fatalf("reply receipt = %#v", replyPayload.Receipt)
	}

	secondReply := runCommentsCLIForTest(t, "reply", replyThreadID, "--url", server.URL, "--actor", "codex:retry-safe", "--actor-kind", "codex", "--client-event-id", "reply-retry-1", "--body", "Retry body that should not create a second comment", "--json")
	decodeCLIJSON(t, secondReply, &replyPayload)
	if replyPayload.Comment.ID != firstReplyID || replyPayload.Comment.Body != "Initial retry-safe reply" {
		t.Fatalf("reply retry should return original comment: %s", secondReply.String())
	}
	if replyPayload.Receipt.CommentID != firstReplyID || !containsReceiptEffect(replyPayload.Receipt.Effects, "comment_added", "reply-retry-1") {
		t.Fatalf("reply retry receipt = %#v", replyPayload.Receipt)
	}

	replyShow := runCommentsCLIForTest(t, "show", replyThreadID, "--url", server.URL, "--json")
	var showPayload struct {
		Thread     commentThreadOutput     `json:"thread"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, replyShow, &showPayload)
	if len(showPayload.Thread.Comments) != 2 || countActivity(showPayload.Activities, "comment_added", "reply-retry-1") != 1 {
		t.Fatalf("reply retry duplicated comment or activity: %s", replyShow.String())
	}

	doneThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please finish this")
	done := runCommentsCLIForTest(t, "done", doneThreadID, "--url", server.URL, "--actor", "codex:retry-safe", "--actor-kind", "codex", "--client-event-id", "done-retry-1", "--body", "Fixed and verified under a retry key", "--json")
	var donePayload struct {
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
		Receipt commentWriteReceipt `json:"receipt"`
	}
	decodeCLIJSON(t, done, &donePayload)
	doneCommentID := donePayload.Comment.ID
	if donePayload.Thread.Status != "resolved" {
		t.Fatalf("done payload = %s", done.String())
	}
	if donePayload.Receipt.ReceiptSchema != "commentWriteReceipt" || !containsString(donePayload.Receipt.VerificationSchemaCommand, "commentWriteReceiptVerification") || !containsString(donePayload.Receipt.VerificationCommand, server.URL) || donePayload.Receipt.Command != "comments done" || donePayload.Receipt.ThreadID != doneThreadID || donePayload.Receipt.Status != "resolved" || donePayload.Receipt.CommentID != doneCommentID || !containsReceiptEffect(donePayload.Receipt.Effects, "comment_added", "done-retry-1") || !containsReceiptEffect(donePayload.Receipt.Effects, "thread_status_changed", "done-retry-1") {
		t.Fatalf("done receipt = %#v", donePayload.Receipt)
	}

	doneRetry := runCommentsCLIForTest(t, "done", doneThreadID, "--url", server.URL, "--actor", "codex:retry-safe", "--actor-kind", "codex", "--client-event-id", "done-retry-1", "--body", "Fixed and verified under a retry key", "--json")
	decodeCLIJSON(t, doneRetry, &donePayload)
	if donePayload.Comment.ID != doneCommentID || donePayload.Thread.Status != "resolved" {
		t.Fatalf("done retry payload = %s", doneRetry.String())
	}
	if donePayload.Receipt.CommentID != doneCommentID || !containsReceiptEffect(donePayload.Receipt.Effects, "thread_status_changed", "done-retry-1") {
		t.Fatalf("done retry receipt = %#v", donePayload.Receipt)
	}
	verified := runCommentsCLIWithStdinForTest(t, done.String(), "verify-receipt", "--url", server.URL, "--receipt-file", "-", "--json")
	var verification commentWriteReceiptVerification
	decodeCLIJSON(t, verified, &verification)
	if !verification.OK || verification.Receipt.ClientEventID != "done-retry-1" || verification.Thread.ID != doneThreadID || len(verification.MatchedEffects) != len(donePayload.Receipt.Effects) || len(verification.MissingEffects) != 0 {
		t.Fatalf("receipt verification = %s", verified.String())
	}
	brokenReceipt := donePayload.Receipt
	brokenReceipt.Effects[0].ID = "missing-activity-id"
	brokenRaw, err := json.Marshal(brokenReceipt)
	if err != nil {
		t.Fatal(err)
	}
	brokenVerified := runCommentsCLIWithStdinForTest(t, string(brokenRaw), "verify-receipt", "--url", server.URL, "--receipt-file", "-", "--json")
	decodeCLIJSON(t, brokenVerified, &verification)
	if verification.OK || len(verification.MissingEffects) != 1 || len(verification.SuggestedCommands) != 2 || verification.SuggestedCommands[0].Command != "comments show" || !containsString(verification.SuggestedCommands[0].Args, server.URL) || !containsString(verification.SuggestedCommands[1].Args, server.URL) {
		t.Fatalf("broken receipt verification = %s", brokenVerified.String())
	}

	doneShow := runCommentsCLIForTest(t, "show", doneThreadID, "--url", server.URL, "--json")
	decodeCLIJSON(t, doneShow, &showPayload)
	if len(showPayload.Thread.Comments) != 2 || countActivity(showPayload.Activities, "comment_added", "done-retry-1") != 1 || countActivity(showPayload.Activities, "thread_status_changed", "done-retry-1") != 1 {
		t.Fatalf("done retry activities = %s", doneShow.String())
	}
}

func TestCommentsCLIReceiptLogAppendsAgentWriteLedger(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	receiptLog := filepath.Join(t.TempDir(), "agent", "receipts.jsonl")
	replyThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please acknowledge this")
	reply := runCommentsCLIForTest(t, "reply", replyThreadID, "--url", server.URL, "--actor", "codex:ledger", "--actor-kind", "codex", "--client-event-id", "ledger-reply-1", "--body", "Acknowledged from the agent loop", "--receipt-log", receiptLog, "--json")
	var replyPayload struct {
		Receipt commentWriteReceipt `json:"receipt"`
	}
	decodeCLIJSON(t, reply, &replyPayload)

	doneThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please close this")
	done := runCommentsCLIForTest(t, "done", doneThreadID, "--url", server.URL, "--actor", "codex:ledger", "--actor-kind", "codex", "--client-event-id", "ledger-done-1", "--body", "Fixed with receipt logging", "--receipt-log", receiptLog, "--json")
	var donePayload struct {
		Receipt commentWriteReceipt `json:"receipt"`
	}
	decodeCLIJSON(t, done, &donePayload)

	raw, err := os.ReadFile(receiptLog)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 2 {
		t.Fatalf("receipt log lines = %d: %s", len(lines), string(raw))
	}
	var loggedReply commentWriteReceipt
	var loggedDone commentWriteReceipt
	if err := json.Unmarshal([]byte(lines[0]), &loggedReply); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &loggedDone); err != nil {
		t.Fatal(err)
	}
	if loggedReply.Command != "comments reply" || loggedReply.ClientEventID != "ledger-reply-1" || loggedReply.CommentID != replyPayload.Receipt.CommentID || !containsString(loggedReply.VerificationCommand, "verify-receipt") || !containsString(loggedReply.VerificationCommand, server.URL) || !containsReceiptEffect(loggedReply.Effects, "comment_added", "ledger-reply-1") {
		t.Fatalf("logged reply receipt = %#v", loggedReply)
	}
	if loggedDone.Command != "comments done" || loggedDone.ClientEventID != "ledger-done-1" || loggedDone.Status != "resolved" || loggedDone.CommentID != donePayload.Receipt.CommentID || !containsReceiptEffect(loggedDone.Effects, "thread_status_changed", "ledger-done-1") {
		t.Fatalf("logged done receipt = %#v", loggedDone)
	}
	verified := runCommentsCLIWithStdinForTest(t, lines[1], "verify-receipt", "--url", server.URL, "--receipt-file", "-", "--json")
	var verification commentWriteReceiptVerification
	decodeCLIJSON(t, verified, &verification)
	if !verification.OK || verification.Receipt.ClientEventID != "ledger-done-1" || len(verification.MissingEffects) != 0 {
		t.Fatalf("logged receipt verification = %s", verified.String())
	}
	ledgerVerified := runCommentsCLIForTest(t, "verify-receipts", "--url", server.URL, "--receipt-log", receiptLog, "--json")
	var ledgerVerification commentWriteReceiptLedgerVerification
	decodeCLIJSON(t, ledgerVerified, &ledgerVerification)
	if !ledgerVerification.OK || ledgerVerification.Count != 2 || ledgerVerification.Verified != 2 || ledgerVerification.Failed != 0 || len(ledgerVerification.Verifications) != 2 || ledgerVerification.Verifications[1].Receipt.ClientEventID != "ledger-done-1" {
		t.Fatalf("ledger verification = %s", ledgerVerified.String())
	}
	brokenReceipt := loggedDone
	brokenReceipt.Effects[0].ID = "missing-ledger-activity"
	brokenRaw, err := json.Marshal(brokenReceipt)
	if err != nil {
		t.Fatal(err)
	}
	brokenLog := filepath.Join(t.TempDir(), "broken-receipts.jsonl")
	if err := os.WriteFile(brokenLog, []byte(lines[0]+"\n"+string(brokenRaw)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	brokenLedger := runCommentsCLIForTest(t, "verify-receipts", "--url", server.URL, "--receipt-log", brokenLog, "--json")
	decodeCLIJSON(t, brokenLedger, &ledgerVerification)
	if ledgerVerification.OK || ledgerVerification.Count != 2 || ledgerVerification.Verified != 1 || ledgerVerification.Failed != 1 || len(ledgerVerification.SuggestedCommands) != 1 || !containsString(ledgerVerification.SuggestedCommands[0].Args, server.URL) || len(ledgerVerification.Verifications[1].MissingEffects) != 1 {
		t.Fatalf("broken ledger verification = %s", brokenLedger.String())
	}
}

func TestCommentsCLITriagePostsStructuredAgentReply(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please triage this feedback")

	claim := runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:triage-test", "--actor-kind", "codex", "--client-event-id", "triage-claim-1", "--lease", "30s", "--json")
	var claimPayload struct {
		Claim commentActivityOutput `json:"claim"`
	}
	decodeCLIJSON(t, claim, &claimPayload)
	if claimPayload.Claim.ID == "" {
		t.Fatalf("claim payload = %s", claim.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsFollowForTest(t, ctx, "follow", threadID, "--url", server.URL, "--actor", "codex:triage-test", "--actor-kind", "codex", "--cursor", claimPayload.Claim.ID, "--interval", "10ms", "--max-events", "1", "--json")
	triaged := runCommentsCLIForTest(t,
		"triage", threadID,
		"--url", server.URL,
		"--actor", "codex:triage-test",
		"--actor-kind", "codex",
		"--decision", "accepted",
		"--summary", "The feedback is actionable and maps to README.md.",
		"--next-action", "Patch the copy and run task check.",
		"--body", "- Reproduced from the source anchor\n- No extra clarification needed",
		"--require-claim",
		"--json",
	)
	var payload struct {
		Triage  commentTriageOutput `json:"triage"`
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
		Receipt commentWriteReceipt `json:"receipt"`
	}
	decodeCLIJSON(t, triaged, &payload)
	if payload.Triage.Decision != "accepted" || payload.Triage.Summary == "" || payload.Triage.NextAction == "" || !strings.Contains(payload.Triage.Details, "Reproduced") {
		t.Fatalf("triage payload = %s", triaged.String())
	}
	if !strings.Contains(payload.Triage.Body, "Triage: accepted") || !strings.Contains(payload.Triage.Body, "Next action: Patch the copy") {
		t.Fatalf("triage body = %#v", payload.Triage.Body)
	}
	if payload.Comment.ThreadID != threadID || payload.Comment.Body != payload.Triage.Body || payload.Comment.CreatedBy.ID != "codex:triage-test" {
		t.Fatalf("triage comment payload = %s", triaged.String())
	}
	if payload.Thread.ID != threadID || payload.Thread.Status != "open" {
		t.Fatalf("triage should leave thread open: %s", triaged.String())
	}
	firstCommentID := payload.Comment.ID
	if payload.Receipt.Command != "comments triage" || payload.Receipt.ThreadID != threadID || payload.Receipt.ActorID != "codex:triage-test" || payload.Receipt.CommentID != firstCommentID || !containsReceiptEffect(payload.Receipt.Effects, "comment_added", "") {
		t.Fatalf("triage receipt = %#v", payload.Receipt)
	}
	followed := receiveFollowEvent(t, events)
	if !containsActivity(followed.Activities, "comment_added", "") {
		t.Fatalf("triage follow activities = %#v", followed.Activities)
	}
	if followed.Summary.TriageCommentCount != 1 || followed.Summary.OwnTriageCommentCount != 1 || followed.Summary.ExternalTriageCommentCount != 0 || !containsString(followed.Summary.Kinds, "triage_comment") || !containsString(followed.Summary.Kinds, "own_triage_comment") {
		t.Fatalf("triage follow summary = %#v", followed.Summary)
	}
	if followed.Summary.RequiresAttention || followed.Summary.RecommendedAction != "ignore_own_activity" {
		t.Fatalf("triage follow attention summary = %#v", followed.Summary)
	}
	if err := <-done; err != nil {
		t.Fatalf("triage follow returned error: %v", err)
	}

	retry := runCommentsCLIForTest(t,
		"triage", threadID,
		"--url", server.URL,
		"--actor", "codex:triage-test",
		"--actor-kind", "codex",
		"--decision", "accepted",
		"--summary", "The feedback is actionable and maps to README.md.",
		"--next-action", "Patch the copy and run task check.",
		"--body", "- Reproduced from the source anchor\n- No extra clarification needed",
		"--require-claim",
		"--json",
	)
	decodeCLIJSON(t, retry, &payload)
	if payload.Comment.ID != firstCommentID || payload.Thread.Status != "open" {
		t.Fatalf("triage retry payload = %s", retry.String())
	}

	show := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showPayload struct {
		Thread commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, show, &showPayload)
	if len(showPayload.Thread.Comments) != 2 {
		t.Fatalf("triage retry duplicated comments: %s", show.String())
	}
}

func TestCommentsCLITriageFileFeedsStructuredReply(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	tempDir := t.TempDir()

	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please triage from JSON")
	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:triage-file", "--actor-kind", "codex", "--client-event-id", "triage-file-claim", "--lease", "30s", "--json")
	triagePath := filepath.Join(tempDir, "triage.json")
	if err := os.WriteFile(triagePath, []byte(`{
  "decision": "fixing",
  "summary": "The request is valid and reproducible.",
  "nextAction": "Patch README and run task check.",
  "details": "- Source anchor confirmed\n- No extra info needed"
}`), 0o644); err != nil {
		t.Fatal(err)
	}
	triaged := runCommentsCLIForTest(t, "triage", threadID, "--url", server.URL, "--actor", "codex:triage-file", "--actor-kind", "codex", "--triage-file", triagePath, "--require-claim", "--json")
	var payload struct {
		Triage  commentTriageOutput `json:"triage"`
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, triaged, &payload)
	if payload.Triage.Decision != "fixing" || payload.Triage.Summary != "The request is valid and reproducible." || payload.Triage.NextAction != "Patch README and run task check." || !strings.Contains(payload.Triage.Details, "Source anchor confirmed") {
		t.Fatalf("triage-file payload = %s", triaged.String())
	}
	if payload.Comment.Body != payload.Triage.Body || !strings.Contains(payload.Comment.Body, "Triage: fixing") || payload.Thread.Status != "open" {
		t.Fatalf("triage-file comment = %s", triaged.String())
	}

	stdinThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please triage from stdin")
	runCommentsCLIForTest(t, "claim", stdinThreadID, "--url", server.URL, "--actor", "codex:triage-file", "--actor-kind", "codex", "--client-event-id", "triage-stdin-claim", "--lease", "30s", "--json")
	stdin := `{"decision":"needs-info","summary":"The request needs one clarification.","nextAction":"Ask the human for the missing target.","details":"- Missing expected output"}`
	stdinTriaged := runCommentsCLIWithStdinForTest(t, stdin, "triage", stdinThreadID, "--url", server.URL, "--actor", "codex:triage-file", "--actor-kind", "codex", "--triage-file", "-", "--require-claim", "--json")
	decodeCLIJSON(t, stdinTriaged, &payload)
	if payload.Triage.Decision != "needs-info" || !strings.Contains(payload.Comment.Body, "Next action: Ask the human") {
		t.Fatalf("triage-file stdin payload = %s", stdinTriaged.String())
	}

	err := runCommentsCLIErrorForTest("triage", threadID, "--url", server.URL, "--actor", "codex:triage-file", "--triage-file", triagePath, "--summary", "inline", "--json")
	if err == nil || !strings.Contains(err.Error(), "--triage-file cannot be combined") {
		t.Fatalf("triage-file conflict error = %v", err)
	}
}

func TestCommentsCLIReleaseTriageFilePostsHandoffAndReleasesClaim(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please clarify this feedback")

	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:handoff", "--actor-kind", "codex", "--client-event-id", "handoff-claim", "--lease", "30s", "--json")
	stdin := `{"decision":"needs-info","summary":"I need the target behavior before editing.","nextAction":"Ask the human which output should be considered correct.","details":"- Current source anchor is clear\n- Expected result is missing"}`
	released := runCommentsCLIWithStdinForTest(t, stdin, "release", threadID, "--url", server.URL, "--actor", "codex:handoff", "--actor-kind", "codex", "--client-event-id", "handoff-release", "--triage-file", "-", "--require-claim", "--with-activities", "--json")
	var payload struct {
		Triage     commentTriageOutput     `json:"triage"`
		Comment    *commentOutput          `json:"comment"`
		Thread     commentThreadOutput     `json:"thread"`
		Release    commentActivityOutput   `json:"release"`
		Receipt    commentWriteReceipt     `json:"receipt"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, released, &payload)
	if payload.Triage.Decision != "needs-info" || payload.Triage.Summary != "I need the target behavior before editing." || !strings.Contains(payload.Triage.Body, "Triage: needs-info") {
		t.Fatalf("release triage payload = %s", released.String())
	}
	if payload.Comment == nil || payload.Comment.Body != payload.Triage.Body || payload.Comment.CreatedBy.ID != "codex:handoff" {
		t.Fatalf("release triage comment = %#v", payload.Comment)
	}
	if payload.Thread.Status != "open" || payload.Release.Type != "thread_claim_released" || payload.Release.ClientEventID != "handoff-release" {
		t.Fatalf("release triage thread/activity = %s", released.String())
	}
	if payload.Receipt.Command != "comments release" || payload.Receipt.ClientEventID != "handoff-release" || payload.Receipt.CommentID != payload.Comment.ID || !containsReceiptEffect(payload.Receipt.Effects, "comment_added", "handoff-release") || !containsReceiptEffect(payload.Receipt.Effects, "thread_claim_released", "handoff-release") {
		t.Fatalf("release receipt = %#v", payload.Receipt)
	}
	if !containsActivity(payload.Activities, "comment_added", "") || !containsActivity(payload.Activities, "thread_claim_released", "handoff-release") {
		t.Fatalf("release triage activities = %#v", payload.Activities)
	}

	claimedAgain := runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:next-agent", "--actor-kind", "codex", "--client-event-id", "next-agent-claim", "--json")
	var claimPayload struct {
		Thread commentThreadOutput   `json:"thread"`
		Claim  commentActivityOutput `json:"claim"`
	}
	decodeCLIJSON(t, claimedAgain, &claimPayload)
	if claimPayload.Thread.ID != threadID || claimPayload.Claim.Actor.ID != "codex:next-agent" {
		t.Fatalf("claim after release triage = %s", claimedAgain.String())
	}

	err := runCommentsCLIErrorForTest("done", threadID, "--url", server.URL, "--actor", "codex:handoff", "--triage-file", "-", "--json")
	if err == nil || !strings.Contains(err.Error(), "--triage-file is only supported") {
		t.Fatalf("unsupported triage-file command error = %v", err)
	}
}

func TestCommentActivityBatchSuggestedCommandsMapRecommendedActions(t *testing.T) {
	start := suggestedCommandsForActivityBatch(commentActivityBatchSummary{RecommendedAction: "start_work"}, "codex:suggest", "codex", "comment-thread-1", "activity-1", "", "")
	if len(start) != 4 {
		t.Fatalf("start suggestions = %#v", start)
	}
	if start[0].Intent != "acknowledge_initial_feedback" || start[0].Command != "comments triage" || !containsString(start[0].Args, "comment-thread-1") || !containsString(start[0].Args, "codex:suggest") || !start[0].StdinRequired || start[0].StdinSchema != "commentTriageFileInput" || start[0].StdinExample["decision"] != "fixing" || !strings.Contains(start[0].StdinExample["summary"].(string), "claimed") || start[0].ClientEventID == "" || !containsString(start[0].Args, "--client-event-id") || !containsString(start[0].Args, start[0].ClientEventID) {
		t.Fatalf("start triage suggestion = %#v", start[0])
	}
	if start[1].Intent != "handoff_after_blocked_or_needs_info" || start[1].Command != "comments release" || !containsString(start[1].Args, "--triage-file") || !start[1].StdinRequired || start[1].StdinSchema != "commentTriageFileInput" || start[1].StdinExample["decision"] != "blocked" || start[1].ClientEventID == "" || !containsString(start[1].Args, start[1].ClientEventID) {
		t.Fatalf("start release suggestion = %#v", start[1])
	}
	if start[2].Intent != "complete_after_verification" || start[2].Command != "comments done" || !start[2].StdinRequired || start[2].StdinSchema != "commentResultFileInput" || !strings.Contains(start[2].StdinExample["summary"].(string), "Implemented") || start[2].ClientEventID == "" || !containsString(start[2].Args, start[2].ClientEventID) {
		t.Fatalf("start result suggestion = %#v", start[2])
	}
	if start[3].Intent != "archive_after_decision" || start[3].Command != "comments dismiss" || !containsString(start[3].Args, "--result-file") || !start[3].StdinRequired || start[3].StdinSchema != "commentResultFileInput" || !containsString(start[3].StdinSchemaCommand, "commentResultFileInput") || !strings.Contains(start[3].StdinExample["summary"].(string), "archived") || start[3].ClientEventID == "" || !containsString(start[3].Args, start[3].ClientEventID) {
		t.Fatalf("start dismiss suggestion = %#v", start[3])
	}

	reconsider := suggestedCommandsForActivityBatch(commentActivityBatchSummary{RecommendedAction: "reconsider_work"}, "codex:suggest", "codex", "comment-thread-1", "activity-2", "", "")
	if len(reconsider) != 4 {
		t.Fatalf("reconsider suggestions = %#v", reconsider)
	}
	if reconsider[0].Intent != "acknowledge_follow_up" || reconsider[0].Command != "comments triage" || !containsString(reconsider[0].Args, "comment-thread-1") || !containsString(reconsider[0].Args, "codex:suggest") || !reconsider[0].StdinRequired || reconsider[0].StdinSchema != "commentTriageFileInput" || !containsString(reconsider[0].StdinSchemaCommand, "commentTriageFileInput") || reconsider[0].StdinExample["decision"] != "fixing" || !strings.Contains(reconsider[0].StdinExample["summary"].(string), "follow-up") || reconsider[0].ClientEventID == "" || !containsString(reconsider[0].Args, reconsider[0].ClientEventID) {
		t.Fatalf("reconsider triage suggestion = %#v", reconsider[0])
	}
	if reconsider[1].Intent != "handoff_after_blocked_or_needs_info" || reconsider[1].Command != "comments release" || !containsString(reconsider[1].Args, "--triage-file") || !reconsider[1].StdinRequired || reconsider[1].StdinSchema != "commentTriageFileInput" || reconsider[1].StdinExample["decision"] != "blocked" || reconsider[1].ClientEventID == "" || !containsString(reconsider[1].Args, reconsider[1].ClientEventID) {
		t.Fatalf("reconsider release suggestion = %#v", reconsider[1])
	}
	if reconsider[2].Intent != "complete_after_verification" || reconsider[2].Command != "comments done" || !containsString(reconsider[2].Args, "--result-file") || reconsider[2].StdinSchema != "commentResultFileInput" || !containsString(reconsider[2].StdinSchemaCommand, "commentResultFileInput") || reconsider[2].StdinExample["summary"] == "" || reconsider[2].ClientEventID == "" || !containsString(reconsider[2].Args, reconsider[2].ClientEventID) {
		t.Fatalf("reconsider result suggestion = %#v", reconsider[2])
	}
	if reconsider[3].Intent != "archive_after_decision" || reconsider[3].Command != "comments dismiss" || !containsString(reconsider[3].Args, "--result-file") || reconsider[3].StdinSchema != "commentResultFileInput" || !containsString(reconsider[3].StdinSchemaCommand, "commentResultFileInput") || reconsider[3].ClientEventID == "" || !containsString(reconsider[3].Args, reconsider[3].ClientEventID) {
		t.Fatalf("reconsider dismiss suggestion = %#v", reconsider[3])
	}

	withLedger := suggestedCommandsForActivityBatch(commentActivityBatchSummary{RecommendedAction: "start_work"}, "codex:suggest", "codex", "comment-thread-1", "activity-6", "http://127.0.0.1:4455", "/tmp/vivi-agent-receipts.jsonl")
	if len(withLedger) != 4 || !containsString(withLedger[0].Args, "--receipt-log") || !containsString(withLedger[0].Args, "/tmp/vivi-agent-receipts.jsonl") || !containsString(withLedger[0].Args, "--url") || !containsString(withLedger[0].Args, "http://127.0.0.1:4455") || !containsString(withLedger[2].Args, "--receipt-log") || !containsString(withLedger[2].Args, "http://127.0.0.1:4455") {
		t.Fatalf("ledger suggestions = %#v", withLedger)
	}

	inspect := suggestedCommandsForActivityBatch(commentActivityBatchSummary{RecommendedAction: "inspect_external_activity"}, "codex:suggest", "codex", "comment-thread-1", "activity-3", "", "")
	if len(inspect) != 1 || inspect[0].Intent != "inspect_thread" || inspect[0].Command != "comments show" || !containsString(inspect[0].Args, "--actor") || !containsString(inspect[0].Args, "codex:suggest") {
		t.Fatalf("inspect suggestions = %#v", inspect)
	}
	if inspect[0].StdinSchema != "" || len(inspect[0].StdinSchemaCommand) != 0 || inspect[0].StdinExample != nil {
		t.Fatalf("inspect suggestion should not include stdin metadata = %#v", inspect[0])
	}

	if ignored := suggestedCommandsForActivityBatch(commentActivityBatchSummary{RecommendedAction: "ignore_own_activity"}, "codex:suggest", "codex", "comment-thread-1", "activity-4", "", ""); len(ignored) != 0 {
		t.Fatalf("ignore suggestions = %#v", ignored)
	}
	if missingActor := suggestedCommandsForActivityBatch(commentActivityBatchSummary{RecommendedAction: "reconsider_work"}, "", "", "comment-thread-1", "activity-5", "", ""); len(missingActor) != 1 || missingActor[0].Intent != "inspect_thread" {
		t.Fatalf("missing actor suggestions = %#v", missingActor)
	}
}

func TestCommentsCLIProtocolSurfacesAgentStartupManifest(t *testing.T) {
	out := runCommentsCLIForTest(t, "protocol", "--json")
	var payload struct {
		Name                  string   `json:"name"`
		Version               int      `json:"version"`
		ManifestSchema        string   `json:"manifestSchema"`
		ManifestSchemaCommand []string `json:"manifestSchemaCommand"`
		SchemaCommand         []string `json:"schemaCommand"`
		ReceiptLedger         struct {
			Enabled                   bool     `json:"enabled"`
			Path                      string   `json:"path"`
			VerificationCommand       []string `json:"verificationCommand"`
			VerificationSchema        string   `json:"verificationSchema"`
			VerificationSchemaCommand []string `json:"verificationSchemaCommand"`
			ReceiptSchema             string   `json:"receiptSchema"`
			ReceiptSchemaCommand      []string `json:"receiptSchemaCommand"`
		} `json:"receiptLedger"`
		Startup []struct {
			Intent  string   `json:"intent"`
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"startup"`
		Recovery []struct {
			Intent  string   `json:"intent"`
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"recovery"`
		PreferredLoop struct {
			Intent  string   `json:"intent"`
			Command string   `json:"command"`
			Args    []string `json:"args"`
			Events  []string `json:"events"`
		} `json:"preferredLoop"`
		IntakeAlternatives []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
			Events []string `json:"events"`
		} `json:"intakeAlternatives"`
		ThreadCompanions []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
		} `json:"threadCompanions"`
		StructuredWrites []commentSuggestedCommand `json:"structuredWrites"`
		EventSchemas     map[string][]string       `json:"eventSchemas"`
		OutputSchemas    map[string][]string       `json:"outputSchemas"`
		ComponentSchemas map[string][]string       `json:"componentSchemas"`
		ErrorSchemas     map[string][]string       `json:"errorSchemas"`
		StartupSchemas   map[string][]string       `json:"startupSchemas"`
		ErrorPolicy      struct {
			Transport     string   `json:"transport"`
			Schema        string   `json:"schema"`
			SchemaCommand []string `json:"schemaCommand"`
			BranchOn      []string `json:"branchOn"`
			Codes         []struct {
				Code        string `json:"code"`
				Recoverable bool   `json:"recoverable"`
				Action      string `json:"action"`
			} `json:"codes"`
		} `json:"errorPolicy"`
		StdinSchemas map[string][]string `json:"stdinSchemas"`
	}
	decodeCLIJSON(t, out, &payload)
	if payload.Name != "vivi-comments-agent-protocol" || payload.Version != commentsStreamSchemaVersion || payload.ManifestSchema != "commentProtocolManifest" || !containsString(payload.ManifestSchemaCommand, "commentProtocolManifest") || !containsString(payload.SchemaCommand, "list") {
		t.Fatalf("protocol header = %s", out.String())
	}
	if payload.ReceiptLedger.Enabled || payload.ReceiptLedger.Path != "" || !containsString(payload.ReceiptLedger.VerificationCommand, "<receipt-log-path>") || payload.ReceiptLedger.VerificationSchema != "commentWriteReceiptLedgerVerification" || !containsString(payload.ReceiptLedger.VerificationSchemaCommand, "commentWriteReceiptLedgerVerification") || payload.ReceiptLedger.ReceiptSchema != "commentWriteReceipt" || !containsString(payload.ReceiptLedger.ReceiptSchemaCommand, "commentWriteReceipt") {
		t.Fatalf("protocol receipt ledger = %#v", payload.ReceiptLedger)
	}
	if len(payload.Startup) != 3 || payload.Startup[1].Intent != "cache_runtime_schemas" || !containsString(payload.Startup[1].Args, "list") || payload.Startup[2].Intent != "check_server_readiness" || payload.Startup[2].Command != "comments doctor" || !containsString(payload.Startup[2].Args, "--client-event-id") {
		t.Fatalf("protocol startup = %#v", payload.Startup)
	}
	if len(payload.Recovery) != 1 || payload.Recovery[0].Intent != "recover_owned_live_claims" || payload.Recovery[0].Command != "comments mine" || containsString(payload.Recovery[0].Args, "--full") {
		t.Fatalf("protocol recovery = %#v", payload.Recovery)
	}
	if payload.PreferredLoop.Intent != "resident_owned_work_loop" || payload.PreferredLoop.Command != "comments work" || !containsString(payload.PreferredLoop.Args, "--client-event-id") || !containsString(payload.PreferredLoop.Args, "<client-event-id>") || !containsString(payload.PreferredLoop.Args, "--wait") || !containsString(payload.PreferredLoop.Args, "--loop") || !containsString(payload.PreferredLoop.Args, "--idle-events") || containsString(payload.PreferredLoop.Args, "--full") || !containsString(payload.PreferredLoop.Events, "commentWorkClaimedEvent") {
		t.Fatalf("preferred loop = %#v", payload.PreferredLoop)
	}
	if len(payload.IntakeAlternatives) != 2 || payload.IntakeAlternatives[0].Intent != "passive_open_worklist" || containsString(payload.IntakeAlternatives[0].Args, "--full") || !containsString(payload.IntakeAlternatives[0].Events, "commentOpenWorklistEvent") {
		t.Fatalf("intake alternatives = %#v", payload.IntakeAlternatives)
	}
	if len(payload.ThreadCompanions) != 2 || payload.ThreadCompanions[1].Intent != "preflight_guarded_write" || !containsString(payload.ThreadCompanions[1].Args, "check") {
		t.Fatalf("thread companions = %#v", payload.ThreadCompanions)
	}
	if len(payload.StructuredWrites) != 4 || !payload.StructuredWrites[0].StdinRequired || payload.StructuredWrites[0].StdinSchema != "commentTriageFileInput" || payload.StructuredWrites[0].ClientEventID != "<client-event-id>" || !containsString(payload.StructuredWrites[0].Args, "--client-event-id") || !containsString(payload.StructuredWrites[0].Args, "<client-event-id>") || payload.StructuredWrites[1].Command != "comments release" || !payload.StructuredWrites[1].StdinRequired || payload.StructuredWrites[1].StdinSchema != "commentTriageFileInput" || payload.StructuredWrites[1].StdinExample["decision"] != "blocked" || payload.StructuredWrites[1].ClientEventID != "<client-event-id>" || !payload.StructuredWrites[2].StdinRequired || payload.StructuredWrites[2].StdinSchema != "commentResultFileInput" || payload.StructuredWrites[2].ClientEventID != "<client-event-id>" || payload.StructuredWrites[3].Command != "comments dismiss" || payload.StructuredWrites[3].StdinExample["summary"] == "" || payload.StructuredWrites[3].ClientEventID != "<client-event-id>" {
		t.Fatalf("structured writes = %#v", payload.StructuredWrites)
	}
	if payload.StructuredWrites[0].StdinExample["decision"] != "accepted" || !strings.Contains(payload.StructuredWrites[0].StdinExample["summary"].(string), "understand") || !strings.Contains(payload.StructuredWrites[2].StdinExample["summary"].(string), "Implemented") {
		t.Fatalf("structured write stdin examples = %#v", payload.StructuredWrites)
	}
	if !containsString(payload.EventSchemas["commentActivityBatchEvent"], "commentActivityBatchEvent") || !containsString(payload.StdinSchemas["commentResultFileInput"], "commentResultFileInput") {
		t.Fatalf("schema maps = %#v %#v", payload.EventSchemas, payload.StdinSchemas)
	}
	if !containsString(payload.OutputSchemas["commentClaimOutput"], "commentClaimOutput") || !containsString(payload.OutputSchemas["commentInboxOutput"], "commentInboxOutput") || !containsString(payload.OutputSchemas["commentMineOutput"], "commentMineOutput") || !containsString(payload.OutputSchemas["commentBatchOutput"], "commentBatchOutput") || !containsString(payload.OutputSchemas["commentCheckOutput"], "commentCheckOutput") || !containsString(payload.OutputSchemas["commentTriageOutput"], "commentTriageOutput") || !containsString(payload.OutputSchemas["commentReleaseOutput"], "commentReleaseOutput") || !containsString(payload.OutputSchemas["commentResultOutput"], "commentResultOutput") || !containsString(payload.OutputSchemas["commentWriteReceiptVerification"], "commentWriteReceiptVerification") || !containsString(payload.OutputSchemas["commentWriteReceiptLedgerVerification"], "commentWriteReceiptLedgerVerification") {
		t.Fatalf("output schema map = %#v", payload.OutputSchemas)
	}
	if !containsString(payload.ComponentSchemas["commentSuggestedCommand"], "commentSuggestedCommand") || !containsString(payload.ComponentSchemas["commentWriteReceipt"], "commentWriteReceipt") {
		t.Fatalf("component schema map = %#v", payload.ComponentSchemas)
	}
	if !containsString(payload.ErrorSchemas["commentErrorEvent"], "commentErrorEvent") {
		t.Fatalf("error schema map = %#v", payload.ErrorSchemas)
	}
	if !containsString(payload.StartupSchemas["commentDoctorOutput"], "commentDoctorOutput") {
		t.Fatalf("startup schema map = %#v", payload.StartupSchemas)
	}
	if payload.ErrorPolicy.Transport != "stdout_json_on_nonzero_exit" || payload.ErrorPolicy.Schema != "commentErrorEvent" || !containsString(payload.ErrorPolicy.SchemaCommand, "commentErrorEvent") || !containsString(payload.ErrorPolicy.BranchOn, "error.suggestedCommands") {
		t.Fatalf("error policy header = %#v", payload.ErrorPolicy)
	}
	if len(payload.ErrorPolicy.Codes) != 7 || payload.ErrorPolicy.Codes[0].Code != "server_unreachable" || !payload.ErrorPolicy.Codes[0].Recoverable || payload.ErrorPolicy.Codes[1].Code != "invalid_arguments" || payload.ErrorPolicy.Codes[1].Recoverable || payload.ErrorPolicy.Codes[2].Code != "no_live_claim" || !payload.ErrorPolicy.Codes[2].Recoverable || payload.ErrorPolicy.Codes[3].Code != "claimed_by_other_actor" || !strings.Contains(payload.ErrorPolicy.Codes[3].Action, "follow") {
		t.Fatalf("error policy codes = %#v", payload.ErrorPolicy.Codes)
	}

	err := runCommentsCLIErrorForTest("protocol", "extra", "--json")
	if err == nil || !strings.Contains(err.Error(), "unexpected argument") {
		t.Fatalf("protocol error = %v", err)
	}
}

func TestCommentsCLIProtocolPropagatesReceiptLogIntoAgentRecipes(t *testing.T) {
	receiptLog := filepath.Join(t.TempDir(), "agent", "receipts.jsonl")
	out := runCommentsCLIForTest(t, "protocol", "--receipt-log", receiptLog, "--json")
	var payload struct {
		ReceiptLedger struct {
			Enabled             bool     `json:"enabled"`
			Path                string   `json:"path"`
			VerificationCommand []string `json:"verificationCommand"`
		} `json:"receiptLedger"`
		Startup []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
		} `json:"startup"`
		PreferredLoop struct {
			Args []string `json:"args"`
		} `json:"preferredLoop"`
		IntakeAlternatives []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
		} `json:"intakeAlternatives"`
		ThreadCompanions []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
		} `json:"threadCompanions"`
		StructuredWrites []commentSuggestedCommand `json:"structuredWrites"`
	}
	decodeCLIJSON(t, out, &payload)
	if !payload.ReceiptLedger.Enabled || payload.ReceiptLedger.Path != receiptLog || !containsString(payload.ReceiptLedger.VerificationCommand, receiptLog) {
		t.Fatalf("protocol receipt ledger = %#v", payload.ReceiptLedger)
	}
	if len(payload.Startup) != 3 || !containsString(payload.Startup[0].Args, receiptLog) || !containsString(payload.Startup[2].Args, receiptLog) {
		t.Fatalf("protocol startup receipt-log propagation = %#v", payload.Startup)
	}
	if !containsString(payload.PreferredLoop.Args, receiptLog) {
		t.Fatalf("preferred loop receipt-log propagation = %#v", payload.PreferredLoop)
	}
	if len(payload.IntakeAlternatives) != 2 || !containsString(payload.IntakeAlternatives[0].Args, receiptLog) || !containsString(payload.IntakeAlternatives[1].Args, receiptLog) {
		t.Fatalf("intake receipt-log propagation = %#v", payload.IntakeAlternatives)
	}
	if len(payload.ThreadCompanions) != 2 || !containsString(payload.ThreadCompanions[0].Args, receiptLog) || !containsString(payload.ThreadCompanions[1].Args, receiptLog) {
		t.Fatalf("companions receipt-log propagation = %#v", payload.ThreadCompanions)
	}
	if len(payload.StructuredWrites) != 4 {
		t.Fatalf("structured writes = %#v", payload.StructuredWrites)
	}
	for _, suggestion := range payload.StructuredWrites {
		if !containsString(suggestion.Args, receiptLog) {
			t.Fatalf("structured write missing receipt-log = %#v", suggestion)
		}
	}

	err := runCommentsCLIErrorForTest("protocol", "--receipt-log", "-", "--json")
	if err == nil || !strings.Contains(err.Error(), "requires a path") {
		t.Fatalf("protocol receipt-log - error = %v", err)
	}
}

func TestCommentsCLIProtocolAndSchemaAcceptURLForAgentStartup(t *testing.T) {
	serverURL := "http://127.0.0.1:4455"
	out := runCommentsCLIForTest(t, "protocol", "--url", serverURL, "--json")
	var payload struct {
		Startup []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
		} `json:"startup"`
		Recovery []struct {
			Intent string   `json:"intent"`
			Args   []string `json:"args"`
		} `json:"recovery"`
		PreferredLoop struct {
			Args []string `json:"args"`
		} `json:"preferredLoop"`
		StructuredWrites []commentSuggestedCommand `json:"structuredWrites"`
	}
	decodeCLIJSON(t, out, &payload)
	if len(payload.Startup) != 3 || !containsString(payload.Startup[0].Args, serverURL) || !containsString(payload.Startup[1].Args, serverURL) || !containsString(payload.Startup[2].Args, serverURL) {
		t.Fatalf("protocol startup URL propagation = %#v", payload.Startup)
	}
	if len(payload.Recovery) != 1 || !containsString(payload.Recovery[0].Args, serverURL) {
		t.Fatalf("protocol recovery URL propagation = %#v", payload.Recovery)
	}
	if !containsString(payload.PreferredLoop.Args, serverURL) {
		t.Fatalf("preferred loop URL propagation = %#v", payload.PreferredLoop)
	}
	if len(payload.StructuredWrites) != 4 || !containsString(payload.StructuredWrites[0].Args, serverURL) {
		t.Fatalf("structured write URL propagation = %#v", payload.StructuredWrites)
	}

	schema := runCommentsCLIForTest(t, "schema", "all", "--url", serverURL, "--json")
	if !strings.Contains(schema.String(), "commentProtocolManifest") {
		t.Fatalf("schema --url payload = %s", schema.String())
	}
}

func TestCommentsCLIClassifiesServerUnreachableForAgentRecovery(t *testing.T) {
	err := errors.New(`Post "http://127.0.0.1:4317/graphql": dial tcp 127.0.0.1:4317: connect: connection refused`)
	if code := commentsErrorCode("doctor", err); code != "server_unreachable" {
		t.Fatalf("server unreachable code = %q", code)
	}
	if !commentsErrorRecoverable("server_unreachable") {
		t.Fatal("expected server_unreachable to be recoverable")
	}
	receiptLog := filepath.Join(t.TempDir(), "agent-receipts.jsonl")
	structured := newCommentsCommandError([]string{"doctor", "--url", "http://127.0.0.1:4317", "--actor", "codex:doctor", "--client-event-id", "doctor-start-1", "--receipt-log", receiptLog, "--json"}, err)
	payload, ok := cliErrorPayload(structured)
	if !ok {
		t.Fatalf("expected structured server unreachable error, got %T", structured)
	}
	envelope := payload.(commentsErrorEnvelope)
	if envelope.Error.Code != "server_unreachable" || !envelope.Error.Recoverable {
		t.Fatalf("server unreachable envelope = %#v", envelope)
	}
	if len(envelope.Error.SuggestedCommands) != 3 || envelope.Error.SuggestedCommands[0].Command != "comments protocol" || !containsString(envelope.Error.SuggestedCommands[0].Args, receiptLog) || envelope.Error.SuggestedCommands[1].Command != "vivi" || envelope.Error.SuggestedCommands[1].Intent != "start_vivi_server" || !containsString(envelope.Error.SuggestedCommands[1].Args, "--ready-json") || !containsString(envelope.Error.SuggestedCommands[1].Args, "--actor") || !containsString(envelope.Error.SuggestedCommands[1].Args, "codex:doctor") || !containsString(envelope.Error.SuggestedCommands[1].Args, "--port") || !containsString(envelope.Error.SuggestedCommands[1].Args, "4317") || envelope.Error.SuggestedCommands[2].Command != "comments doctor" || !containsString(envelope.Error.SuggestedCommands[2].Args, "doctor-start-1") || !containsString(envelope.Error.SuggestedCommands[2].Args, "http://127.0.0.1:4317") || !containsString(envelope.Error.SuggestedCommands[2].Args, receiptLog) {
		t.Fatalf("server unreachable suggestions = %#v", envelope.Error.SuggestedCommands)
	}
}

func TestCommentsCLIShowMissingThreadIDSuggestsPathDiscovery(t *testing.T) {
	err := newCommentsCommandError(
		[]string{"show", "--path", "net/netfilter/xt_RATEEST.c", "--actor", "codex:show", "--url", "http://127.0.0.1:59432", "--json"},
		errors.New("show requires exactly one thread id"),
	)
	payload, ok := cliErrorPayload(err)
	if !ok {
		t.Fatalf("expected structured show error, got %T", err)
	}
	envelope := payload.(commentsErrorEnvelope)
	if envelope.Error.Code != "invalid_arguments" || envelope.Error.Command != "comments show" || envelope.Error.Recoverable {
		t.Fatalf("show missing id envelope = %#v", envelope)
	}
	if len(envelope.Error.SuggestedCommands) != 2 {
		t.Fatalf("show missing id suggestions = %#v", envelope.Error.SuggestedCommands)
	}
	inbox := envelope.Error.SuggestedCommands[0]
	if inbox.Intent != "find_thread_id" || inbox.Command != "comments inbox" || !containsString(inbox.Args, "--path") || !containsString(inbox.Args, "net/netfilter/xt_RATEEST.c") || !containsString(inbox.Args, "http://127.0.0.1:59432") || !strings.Contains(inbox.DisplayCommand, "comments inbox --actor codex:show") {
		t.Fatalf("show missing id inbox suggestion = %#v", inbox)
	}
	list := envelope.Error.SuggestedCommands[1]
	if list.Intent != "list_matching_threads" || list.Command != "comments list" || !containsString(list.Args, "--path") || !containsString(list.Args, "net/netfilter/xt_RATEEST.c") || !containsString(list.Args, "http://127.0.0.1:59432") || !strings.Contains(list.DisplayCommand, "comments list --path net/netfilter/xt_RATEEST.c") {
		t.Fatalf("show missing id list suggestion = %#v", list)
	}
}

func TestCommentsCLIDoctorSurfacesAgentReadiness(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	out := runCommentsCLIForTest(t, "doctor", "--url", server.URL, "--actor", "codex:doctor", "--client-event-id", "doctor-start-1", "--json")
	var payload struct {
		OK            bool   `json:"ok"`
		URL           string `json:"url"`
		SchemaVersion int    `json:"schemaVersion"`
		Protocol      struct {
			Name                  string   `json:"name"`
			Version               int      `json:"version"`
			ManifestSchema        string   `json:"manifestSchema"`
			ManifestSchemaCommand []string `json:"manifestSchemaCommand"`
			SchemaCommand         []string `json:"schemaCommand"`
		} `json:"protocol"`
		Server struct {
			Reachable       bool   `json:"reachable"`
			OpenThreadCount int    `json:"openThreadCount"`
			Cursor          string `json:"cursor"`
		} `json:"server"`
		Actor             map[string]any            `json:"actor"`
		RecommendedAction string                    `json:"recommendedAction"`
		SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands"`
	}
	decodeCLIJSON(t, out, &payload)
	if !payload.OK || payload.URL != server.URL || payload.SchemaVersion != commentsStreamSchemaVersion {
		t.Fatalf("doctor header = %s", out.String())
	}
	if payload.Protocol.Name != "vivi-comments-agent-protocol" || payload.Protocol.ManifestSchema != "commentProtocolManifest" || !containsString(payload.Protocol.ManifestSchemaCommand, "commentProtocolManifest") || !containsString(payload.Protocol.SchemaCommand, "list") {
		t.Fatalf("doctor protocol = %#v", payload.Protocol)
	}
	if !payload.Server.Reachable || payload.Server.OpenThreadCount != 1 || !strings.HasPrefix(payload.Server.Cursor, "open:") {
		t.Fatalf("doctor server = %#v", payload.Server)
	}
	if payload.Actor["id"] != "codex:doctor" || payload.Actor["kind"] != "codex" {
		t.Fatalf("doctor actor = %#v", payload.Actor)
	}
	if payload.RecommendedAction != "enter_resident_work_loop" || len(payload.SuggestedCommands) != 3 {
		t.Fatalf("doctor guidance = %#v %#v", payload.RecommendedAction, payload.SuggestedCommands)
	}
	mine := payload.SuggestedCommands[0]
	if mine.Intent != "recover_owned_live_claims" || mine.Command != "comments mine" || !containsString(mine.Args, "codex:doctor") || !containsString(mine.Args, "--actor-kind") || !containsString(mine.Args, "codex") || containsString(mine.Args, "--full") || !containsString(mine.Args, server.URL) {
		t.Fatalf("doctor recovery suggestion = %#v", mine)
	}
	work := payload.SuggestedCommands[1]
	if work.Intent != "start_resident_work_loop" || work.Command != "comments work" || work.ClientEventID != "doctor-start-1:work" || !containsString(work.Args, "--actor-kind") || !containsString(work.Args, "codex") || !containsString(work.Args, "--loop") || !containsString(work.Args, "--idle-events") || containsString(work.Args, "--full") || !containsString(work.Args, work.ClientEventID) || !containsString(work.Args, server.URL) {
		t.Fatalf("doctor resident work suggestion = %#v", work)
	}
	inbox := payload.SuggestedCommands[2]
	if inbox.Intent != "snapshot_agent_inbox" || inbox.Command != "comments inbox" || !containsString(inbox.Args, "codex:doctor") || !containsString(inbox.Args, "--actor-kind") || !containsString(inbox.Args, "codex") || containsString(inbox.Args, "--full") || !containsString(inbox.Args, server.URL) {
		t.Fatalf("doctor inbox suggestion = %#v", inbox)
	}

	activities := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "Activities",
		"query":         `query Activities($threadId: ID!) { commentThreadActivities(threadId: $threadId) { type actor { id } clientEventId } }`,
		"variables":     map[string]any{"threadId": threadID},
	})["commentThreadActivities"].([]any)
	if len(activities) != 1 || activities[0].(map[string]any)["type"] != "thread_created" {
		t.Fatalf("doctor should not create read/claim activity: %#v", activities)
	}
}

func TestCommentsCLIDoctorPreservesActorKindInWaitSuggestion(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	out := runCommentsCLIForTest(t, "doctor", "--url", server.URL, "--actor", "coding-agent:dogfood", "--actor-kind", "codex", "--json")
	var payload struct {
		RecommendedAction string                    `json:"recommendedAction"`
		SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands"`
	}
	decodeCLIJSON(t, out, &payload)
	if payload.RecommendedAction != "wait_for_gui_feedback" || len(payload.SuggestedCommands) != 4 {
		t.Fatalf("doctor wait guidance = %#v", payload)
	}
	watch := payload.SuggestedCommands[3]
	if watch.Intent != "watch_open_worklist" || watch.Command != "comments watch" || !containsString(watch.Args, "--actor-kind") || !containsString(watch.Args, "codex") {
		t.Fatalf("doctor watch suggestion = %#v", watch)
	}
}

func TestCommentsCLIDoctorVerifiesReceiptLedgerForRestart(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	receiptLog := filepath.Join(t.TempDir(), "agent-receipts.jsonl")
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please acknowledge this")
	runCommentsCLIForTest(t, "reply", threadID, "--url", server.URL, "--actor", "codex:doctor-ledger", "--actor-kind", "codex", "--client-event-id", "doctor-ledger-reply-1", "--body", "Acknowledged with a receipt ledger", "--receipt-log", receiptLog, "--json")

	out := runCommentsCLIForTest(t, "doctor", "--url", server.URL, "--actor", "codex:doctor-ledger", "--client-event-id", "doctor-ledger-start-1", "--receipt-log", receiptLog, "--json")
	var payload struct {
		RecommendedAction string                                `json:"recommendedAction"`
		ReceiptLedger     commentWriteReceiptLedgerVerification `json:"receiptLedger"`
		SuggestedCommands []commentSuggestedCommand             `json:"suggestedCommands"`
	}
	decodeCLIJSON(t, out, &payload)
	if payload.RecommendedAction != "enter_resident_work_loop" || !payload.ReceiptLedger.OK || payload.ReceiptLedger.Count != 1 || payload.ReceiptLedger.Verified != 1 || payload.ReceiptLedger.Failed != 0 {
		t.Fatalf("doctor ledger payload = %s", out.String())
	}
	if len(payload.SuggestedCommands) != 3 || payload.SuggestedCommands[0].Command != "comments mine" || !containsString(payload.SuggestedCommands[0].Args, server.URL) || !containsString(payload.SuggestedCommands[1].Args, "--receipt-log") || !containsString(payload.SuggestedCommands[1].Args, receiptLog) || !containsString(payload.SuggestedCommands[1].Args, server.URL) || !containsString(payload.SuggestedCommands[2].Args, receiptLog) || !containsString(payload.SuggestedCommands[2].Args, server.URL) {
		t.Fatalf("doctor ledger suggestions = %#v", payload.SuggestedCommands)
	}

	raw, err := os.ReadFile(receiptLog)
	if err != nil {
		t.Fatal(err)
	}
	var broken commentWriteReceipt
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(raw))), &broken); err != nil {
		t.Fatal(err)
	}
	broken.Effects[0].ID = "missing-doctor-ledger-activity"
	brokenRaw, err := json.Marshal(broken)
	if err != nil {
		t.Fatal(err)
	}
	brokenLog := filepath.Join(t.TempDir(), "broken-agent-receipts.jsonl")
	if err := os.WriteFile(brokenLog, append(brokenRaw, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	brokenOut := runCommentsCLIForTest(t, "doctor", "--url", server.URL, "--actor", "codex:doctor-ledger", "--client-event-id", "doctor-ledger-start-2", "--receipt-log", brokenLog, "--json")
	decodeCLIJSON(t, brokenOut, &payload)
	if payload.RecommendedAction != "reconcile_receipt_ledger" || payload.ReceiptLedger.OK || payload.ReceiptLedger.Failed != 1 || len(payload.SuggestedCommands) != 4 || payload.SuggestedCommands[0].Command != "comments verify-receipts" || !containsString(payload.SuggestedCommands[0].Args, brokenLog) || !containsString(payload.SuggestedCommands[0].Args, server.URL) {
		t.Fatalf("doctor broken ledger payload = %s", brokenOut.String())
	}

	missingLog := filepath.Join(t.TempDir(), "missing", "receipts.jsonl")
	missingOut := runCommentsCLIForTest(t, "doctor", "--url", server.URL, "--actor", "codex:doctor-ledger", "--client-event-id", "doctor-ledger-start-3", "--receipt-log", missingLog, "--json")
	decodeCLIJSON(t, missingOut, &payload)
	if payload.RecommendedAction != "enter_resident_work_loop" || !payload.ReceiptLedger.OK || payload.ReceiptLedger.Count != 0 || payload.ReceiptLedger.Verified != 0 || payload.ReceiptLedger.Failed != 0 {
		t.Fatalf("doctor missing ledger payload = %s", missingOut.String())
	}
}

func TestCommentsCLISchemaSurfacesStructuredStdinContracts(t *testing.T) {
	index := runCommentsCLIForTest(t, "schema", "list", "--json")
	var indexPayload commentSchemaIndexOutput
	decodeCLIJSON(t, index, &indexPayload)
	if indexPayload.Name != "commentSchemaIndex" || indexPayload.SchemaVersion != commentsStreamSchemaVersion || len(indexPayload.Schemas) < 20 {
		t.Fatalf("schema index payload = %s", index.String())
	}
	if strings.Contains(index.String(), `"properties"`) || strings.Contains(index.String(), `"example"`) {
		t.Fatalf("schema index should not embed full schemas or examples: %s", index.String())
	}
	foundProtocol := false
	foundResultInput := false
	for _, schema := range indexPayload.Schemas {
		if schema.Name == "commentProtocolManifest" && containsString(schema.SchemaCommand, "commentProtocolManifest") && len(schema.AcceptedBy) > 0 {
			foundProtocol = true
		}
		if schema.Name == "commentResultFileInput" && containsString(schema.SchemaCommand, "commentResultFileInput") && len(schema.AcceptedBy) > 0 {
			foundResultInput = true
		}
	}
	if !foundProtocol || !foundResultInput {
		t.Fatalf("schema index missing expected entries = %#v", indexPayload.Schemas)
	}

	protocol := runCommentsCLIForTest(t, "schema", "protocol", "--json")
	var protocolPayload commentSchemaOutput
	decodeCLIJSON(t, protocol, &protocolPayload)
	if protocolPayload.Name != "commentProtocolManifest" || protocolPayload.Schema["$id"] != "vivi://comments/schemas/commentProtocolManifest" {
		t.Fatalf("protocol schema payload = %s", protocol.String())
	}
	protocolProperties := protocolPayload.Schema["properties"].(map[string]any)
	if protocolProperties["manifestSchema"].(map[string]any)["const"] != "commentProtocolManifest" || protocolProperties["receiptLedger"].(map[string]any)["type"] != "object" || protocolProperties["recovery"].(map[string]any)["type"] != "array" || protocolProperties["outputSchemas"].(map[string]any)["type"] != "object" || protocolProperties["componentSchemas"].(map[string]any)["type"] != "object" || protocolProperties["structuredWrites"].(map[string]any)["type"] != "array" {
		t.Fatalf("protocol schema properties = %#v", protocolPayload)
	}
	protocolExample := protocolPayload.Example
	protocolExampleRecovery := protocolExample["recovery"].([]any)
	protocolExampleLedger := protocolExample["receiptLedger"].(map[string]any)
	if protocolExample["manifestSchema"] != "commentProtocolManifest" || !containsAnyString(protocolExample["manifestSchemaCommand"].([]any), "commentProtocolManifest") || protocolExample["name"] != "vivi-comments-agent-protocol" || protocolExampleLedger["enabled"] != false || protocolExampleLedger["verificationSchema"] != "commentWriteReceiptLedgerVerification" || len(protocolExampleRecovery) != 1 || protocolExampleRecovery[0].(map[string]any)["command"] != "comments mine" {
		t.Fatalf("protocol schema example = %#v", protocolExample)
	}

	doctor := runCommentsCLIForTest(t, "schema", "doctor", "--json")
	var doctorPayload commentSchemaOutput
	decodeCLIJSON(t, doctor, &doctorPayload)
	if doctorPayload.Name != "commentDoctorOutput" || doctorPayload.Schema["$id"] != "vivi://comments/schemas/commentDoctorOutput" {
		t.Fatalf("doctor schema payload = %s", doctor.String())
	}
	doctorProperties := doctorPayload.Schema["properties"].(map[string]any)
	doctorServer := doctorProperties["server"].(map[string]any)
	doctorServerProperties := doctorServer["properties"].(map[string]any)
	doctorRecommendedAction := doctorProperties["recommendedAction"].(map[string]any)
	if doctorRecommendedAction["type"] != "string" || !containsAnyString(doctorRecommendedAction["enum"].([]any), "reconcile_receipt_ledger") || doctorServerProperties["openThreadCount"].(map[string]any)["minimum"] != float64(0) {
		t.Fatalf("doctor schema properties = %#v", doctorPayload)
	}
	if _, ok := doctorProperties["receiptLedger"]; !ok {
		t.Fatalf("doctor schema properties = %#v", doctorPayload)
	}
	doctorExample := doctorPayload.Example
	if doctorExample["ok"] != true || doctorExample["schemaVersion"] != float64(commentsStreamSchemaVersion) && doctorExample["schemaVersion"] != commentsStreamSchemaVersion || doctorExample["recommendedAction"] != "enter_resident_work_loop" {
		t.Fatalf("doctor schema example = %#v", doctorExample)
	}
	doctorExampleSuggestions := doctorExample["suggestedCommands"].([]any)
	if len(doctorExampleSuggestions) < 3 || doctorExampleSuggestions[0].(map[string]any)["command"] != "comments mine" || doctorExampleSuggestions[1].(map[string]any)["command"] != "comments work" {
		t.Fatalf("doctor schema suggestions = %#v", doctorExampleSuggestions)
	}

	claim := runCommentsCLIForTest(t, "schema", "claim", "--json")
	var claimPayload commentSchemaOutput
	decodeCLIJSON(t, claim, &claimPayload)
	if claimPayload.Name != "commentClaimOutput" || claimPayload.Schema["$id"] != "vivi://comments/schemas/commentClaimOutput" {
		t.Fatalf("claim schema payload = %s", claim.String())
	}
	claimProperties := claimPayload.Schema["properties"].(map[string]any)
	claimSummary := claimProperties["summary"].(map[string]any)
	claimSummaryProperties := claimSummary["properties"].(map[string]any)
	if claimProperties["thread"].(map[string]any)["anyOf"] == nil || claimProperties["claim"].(map[string]any)["anyOf"] == nil || claimSummaryProperties["recommendedAction"].(map[string]any)["type"] != "string" || len(claimPayload.AcceptedBy) != 4 {
		t.Fatalf("claim schema properties = %#v", claimPayload)
	}
	claimExampleSummary := claimPayload.Example["summary"].(map[string]any)
	claimExampleSuggestions := claimExampleSummary["suggestedCommands"].([]any)
	if claimExampleSummary["recommendedAction"] != "start_work" || len(claimExampleSuggestions) != 1 || claimExampleSuggestions[0].(map[string]any)["stdinSchema"] != "commentTriageFileInput" {
		t.Fatalf("claim schema example = %#v", claimPayload.Example)
	}

	inbox := runCommentsCLIForTest(t, "schema", "inbox", "--json")
	var inboxPayload commentSchemaOutput
	decodeCLIJSON(t, inbox, &inboxPayload)
	if inboxPayload.Name != "commentInboxOutput" || inboxPayload.Schema["$id"] != "vivi://comments/schemas/commentInboxOutput" {
		t.Fatalf("inbox schema payload = %s", inbox.String())
	}
	inboxProperties := inboxPayload.Schema["properties"].(map[string]any)
	inboxRequired := inboxPayload.Schema["required"].([]any)
	inboxSummary := inboxProperties["summary"].(map[string]any)
	inboxSummaryProperties := inboxSummary["properties"].(map[string]any)
	if inboxSummaryProperties["recommendedAction"].(map[string]any)["type"] != "string" || inboxSummaryProperties["totalOpenThreadCount"].(map[string]any)["minimum"] != float64(0) || inboxSummaryProperties["sourceUnavailableCount"].(map[string]any)["minimum"] != float64(0) || inboxSummaryProperties["mineCount"].(map[string]any)["minimum"] != float64(0) || len(inboxPayload.AcceptedBy) != 2 {
		t.Fatalf("inbox schema properties = %#v", inboxPayload)
	}
	if inboxProperties["schemaVersion"].(map[string]any)["type"] != "integer" || inboxProperties["schemaCommand"].(map[string]any)["type"] != "array" || !containsAnyString(inboxRequired, "schemaVersion") || !containsAnyString(inboxRequired, "schemaCommand") {
		t.Fatalf("inbox schema metadata properties = %#v", inboxPayload.Schema)
	}
	if inboxProperties["sourceUnavailable"].(map[string]any)["type"] != "object" {
		t.Fatalf("inbox sourceUnavailable schema = %#v", inboxPayload)
	}
	inboxExampleSummary := inboxPayload.Example["summary"].(map[string]any)
	if inboxExampleSummary["recommendedAction"] != "resume_owned_work" || !containsAnyString(inboxPayload.Example["schemaCommand"].([]any), "commentInboxOutput") || inboxPayload.Example["mine"].(map[string]any)["count"] != float64(1) && inboxPayload.Example["mine"].(map[string]any)["count"] != 1 || inboxPayload.Example["sourceUnavailable"].(map[string]any)["count"] != float64(0) && inboxPayload.Example["sourceUnavailable"].(map[string]any)["count"] != 0 {
		t.Fatalf("inbox schema example = %#v", inboxPayload.Example)
	}

	mine := runCommentsCLIForTest(t, "schema", "mine", "--json")
	var minePayload commentSchemaOutput
	decodeCLIJSON(t, mine, &minePayload)
	if minePayload.Name != "commentMineOutput" || minePayload.Schema["$id"] != "vivi://comments/schemas/commentMineOutput" {
		t.Fatalf("mine schema payload = %s", mine.String())
	}
	mineProperties := minePayload.Schema["properties"].(map[string]any)
	mineSummary := mineProperties["summary"].(map[string]any)
	mineSummaryProperties := mineSummary["properties"].(map[string]any)
	if mineSummaryProperties["recommendedAction"].(map[string]any)["type"] != "string" || mineSummaryProperties["mineCount"].(map[string]any)["minimum"] != float64(0) || len(minePayload.AcceptedBy) != 2 {
		t.Fatalf("mine schema properties = %#v", minePayload)
	}
	mineExampleSummary := minePayload.Example["summary"].(map[string]any)
	if mineExampleSummary["recommendedAction"] != "resume_owned_work" || minePayload.Example["count"] != float64(1) && minePayload.Example["count"] != 1 {
		t.Fatalf("mine schema example = %#v", minePayload.Example)
	}

	batch := runCommentsCLIForTest(t, "schema", "batch", "--json")
	var batchPayload commentSchemaOutput
	decodeCLIJSON(t, batch, &batchPayload)
	if batchPayload.Name != "commentBatchOutput" || batchPayload.Schema["$id"] != "vivi://comments/schemas/commentBatchOutput" {
		t.Fatalf("batch schema payload = %s", batch.String())
	}
	batchProperties := batchPayload.Schema["properties"].(map[string]any)
	batchOpen := batchProperties["open"].(map[string]any)
	batchOpenProperties := batchOpen["properties"].(map[string]any)
	if _, ok := batchOpenProperties["summary"]; !ok || len(batchPayload.AcceptedBy) != 2 {
		t.Fatalf("batch schema open properties = %#v", batchPayload)
	}
	batchExampleOpen := batchPayload.Example["open"].(map[string]any)
	batchExampleOpenSummary := batchExampleOpen["summary"].(map[string]any)
	if batchExampleOpenSummary["recommendedAction"] != "resume_owned_work" || batchPayload.Example["summary"].(map[string]any)["complete"] != false {
		t.Fatalf("batch schema example = %#v", batchPayload.Example)
	}

	check := runCommentsCLIForTest(t, "schema", "check", "--json")
	var checkPayload commentSchemaOutput
	decodeCLIJSON(t, check, &checkPayload)
	if checkPayload.Name != "commentCheckOutput" || checkPayload.Schema["$id"] != "vivi://comments/schemas/commentCheckOutput" {
		t.Fatalf("check schema payload = %s", check.String())
	}
	checkProperties := checkPayload.Schema["properties"].(map[string]any)
	writePreflight := checkProperties["write"].(map[string]any)
	writePreflightProperties := writePreflight["properties"].(map[string]any)
	if !containsAnyString(writePreflightProperties["reason"].(map[string]any)["enum"].([]any), "owned_live_claim") || !containsAnyString(writePreflightProperties["recommendedAction"].(map[string]any)["enum"].([]any), "write_guarded_reply") || len(checkPayload.AcceptedBy) != 2 {
		t.Fatalf("check schema properties = %#v", checkPayload)
	}
	checkExampleWrite := checkPayload.Example["write"].(map[string]any)
	checkExampleSuggestions := checkExampleWrite["suggestedCommands"].([]any)
	if checkExampleWrite["recommendedAction"] != "write_guarded_reply" || len(checkExampleSuggestions) != 1 || checkExampleSuggestions[0].(map[string]any)["stdinSchema"] != "commentTriageFileInput" {
		t.Fatalf("check schema example = %#v", checkPayload.Example)
	}

	triageOutput := runCommentsCLIForTest(t, "schema", "commentTriageOutput", "--json")
	var triageOutputPayload commentSchemaOutput
	decodeCLIJSON(t, triageOutput, &triageOutputPayload)
	if triageOutputPayload.Name != "commentTriageOutput" || triageOutputPayload.Schema["$id"] != "vivi://comments/schemas/commentTriageOutput" {
		t.Fatalf("triage output schema payload = %s", triageOutput.String())
	}
	triageOutputProperties := triageOutputPayload.Schema["properties"].(map[string]any)
	triageOutputTriage := triageOutputProperties["triage"].(map[string]any)
	triageOutputTriageProperties := triageOutputTriage["properties"].(map[string]any)
	if triageOutputTriageProperties["decision"].(map[string]any)["type"] != "string" || triageOutputProperties["receipt"].(map[string]any)["required"] == nil || len(triageOutputPayload.AcceptedBy) != 2 {
		t.Fatalf("triage output schema properties = %#v", triageOutputPayload)
	}
	triageOutputExampleTriage := triageOutputPayload.Example["triage"].(map[string]any)
	if triageOutputExampleTriage["decision"] != "fixing" || triageOutputPayload.Example["receipt"].(map[string]any)["command"] != "comments triage" {
		t.Fatalf("triage output schema example = %#v", triageOutputPayload.Example)
	}

	releaseOutput := runCommentsCLIForTest(t, "schema", "commentReleaseOutput", "--json")
	var releaseOutputPayload commentSchemaOutput
	decodeCLIJSON(t, releaseOutput, &releaseOutputPayload)
	if releaseOutputPayload.Name != "commentReleaseOutput" || releaseOutputPayload.Schema["$id"] != "vivi://comments/schemas/commentReleaseOutput" {
		t.Fatalf("release output schema payload = %s", releaseOutput.String())
	}
	releaseOutputProperties := releaseOutputPayload.Schema["properties"].(map[string]any)
	releaseOutputTriage := releaseOutputProperties["triage"].(map[string]any)
	releaseOutputTriageProperties := releaseOutputTriage["properties"].(map[string]any)
	if releaseOutputTriageProperties["decision"].(map[string]any)["type"] != "string" || releaseOutputProperties["release"].(map[string]any)["required"] == nil || releaseOutputProperties["receipt"].(map[string]any)["required"] == nil || len(releaseOutputPayload.AcceptedBy) != 4 {
		t.Fatalf("release output schema properties = %#v", releaseOutputPayload)
	}
	releaseOutputExampleTriage := releaseOutputPayload.Example["triage"].(map[string]any)
	if releaseOutputExampleTriage["decision"] != "needs-info" || releaseOutputPayload.Example["release"].(map[string]any)["type"] != "thread_claim_released" || releaseOutputPayload.Example["receipt"].(map[string]any)["command"] != "comments release" {
		t.Fatalf("release output schema example = %#v", releaseOutputPayload.Example)
	}

	resultOutput := runCommentsCLIForTest(t, "schema", "commentResultOutput", "--json")
	var resultOutputPayload commentSchemaOutput
	decodeCLIJSON(t, resultOutput, &resultOutputPayload)
	if resultOutputPayload.Name != "commentResultOutput" || resultOutputPayload.Schema["$id"] != "vivi://comments/schemas/commentResultOutput" {
		t.Fatalf("result output schema payload = %s", resultOutput.String())
	}
	resultOutputProperties := resultOutputPayload.Schema["properties"].(map[string]any)
	resultOutputResult := resultOutputProperties["result"].(map[string]any)
	resultOutputResultProperties := resultOutputResult["properties"].(map[string]any)
	if !containsAnyString(resultOutputResultProperties["outcome"].(map[string]any)["enum"].([]any), "resolved") || resultOutputProperties["receipt"].(map[string]any)["required"] == nil || len(resultOutputPayload.AcceptedBy) != 4 {
		t.Fatalf("result output schema properties = %#v", resultOutputPayload)
	}
	resultOutputExampleResult := resultOutputPayload.Example["result"].(map[string]any)
	if resultOutputExampleResult["outcome"] != "resolved" || resultOutputPayload.Example["thread"].(map[string]any)["status"] != "resolved" || resultOutputPayload.Example["receipt"].(map[string]any)["command"] != "comments done" {
		t.Fatalf("result output schema example = %#v", resultOutputPayload.Example)
	}

	suggestedCommand := runCommentsCLIForTest(t, "schema", "suggestedCommand", "--json")
	var suggestedCommandPayload commentSchemaOutput
	decodeCLIJSON(t, suggestedCommand, &suggestedCommandPayload)
	if suggestedCommandPayload.Name != "commentSuggestedCommand" || suggestedCommandPayload.Schema["$id"] != "vivi://comments/schemas/commentSuggestedCommand" {
		t.Fatalf("suggested command schema payload = %s", suggestedCommand.String())
	}
	suggestedCommandAllOf := suggestedCommandPayload.Schema["allOf"].([]any)
	suggestedCommandShape := suggestedCommandAllOf[0].(map[string]any)
	suggestedCommandProperties := suggestedCommandShape["properties"].(map[string]any)
	if _, ok := suggestedCommandProperties["clientEventId"]; !ok {
		t.Fatalf("suggested command schema missing clientEventId = %#v", suggestedCommandPayload)
	}
	if _, ok := suggestedCommandProperties["displayCommand"]; !ok {
		t.Fatalf("suggested command schema missing displayCommand = %#v", suggestedCommandPayload)
	}
	if _, ok := suggestedCommandProperties["stdinRequired"]; !ok {
		t.Fatalf("suggested command schema missing stdinRequired = %#v", suggestedCommandPayload)
	}
	if _, ok := suggestedCommandProperties["stdinSchemaCommand"]; !ok || len(suggestedCommandPayload.AcceptedBy) < 6 {
		t.Fatalf("suggested command schema properties = %#v", suggestedCommandPayload)
	}
	if suggestedCommandPayload.Example["command"] != "comments done" || suggestedCommandPayload.Example["displayCommand"] == "" || suggestedCommandPayload.Example["stdinSchema"] != "commentResultFileInput" || suggestedCommandPayload.Example["stdinRequired"] != true || suggestedCommandPayload.Example["clientEventId"] == "" {
		t.Fatalf("suggested command schema example = %#v", suggestedCommandPayload.Example)
	}

	writeReceipt := runCommentsCLIForTest(t, "schema", "writeReceipt", "--json")
	var writeReceiptPayload commentSchemaOutput
	decodeCLIJSON(t, writeReceipt, &writeReceiptPayload)
	if writeReceiptPayload.Name != "commentWriteReceipt" || writeReceiptPayload.Schema["$id"] != "vivi://comments/schemas/commentWriteReceipt" {
		t.Fatalf("write receipt schema payload = %s", writeReceipt.String())
	}
	writeReceiptAllOf := writeReceiptPayload.Schema["allOf"].([]any)
	writeReceiptShape := writeReceiptAllOf[0].(map[string]any)
	writeReceiptProperties := writeReceiptShape["properties"].(map[string]any)
	if _, ok := writeReceiptProperties["effects"]; !ok {
		t.Fatalf("write receipt schema missing effects = %#v", writeReceiptPayload)
	}
	if _, ok := writeReceiptProperties["verificationCommand"]; !ok {
		t.Fatalf("write receipt schema missing verificationCommand = %#v", writeReceiptPayload)
	}
	if writeReceiptPayload.Example["command"] != "comments done" || writeReceiptPayload.Example["clientEventId"] == "" || writeReceiptPayload.Example["receiptSchema"] != "commentWriteReceipt" || writeReceiptPayload.Example["verificationSchema"] != "commentWriteReceiptVerification" || len(writeReceiptPayload.AcceptedBy) != 5 {
		t.Fatalf("write receipt schema example = %#v", writeReceiptPayload)
	}
	receiptVerification := runCommentsCLIForTest(t, "schema", "receiptVerification", "--json")
	var receiptVerificationPayload commentSchemaOutput
	decodeCLIJSON(t, receiptVerification, &receiptVerificationPayload)
	if receiptVerificationPayload.Name != "commentWriteReceiptVerification" || receiptVerificationPayload.Schema["$id"] != "vivi://comments/schemas/commentWriteReceiptVerification" {
		t.Fatalf("receipt verification schema payload = %s", receiptVerification.String())
	}
	receiptVerificationProperties := receiptVerificationPayload.Schema["properties"].(map[string]any)
	if _, ok := receiptVerificationProperties["missingEffects"]; !ok || receiptVerificationPayload.Example["ok"] != true || len(receiptVerificationPayload.AcceptedBy) != 1 {
		t.Fatalf("receipt verification schema = %#v", receiptVerificationPayload)
	}
	receiptLedgerVerification := runCommentsCLIForTest(t, "schema", "receiptLedgerVerification", "--json")
	var receiptLedgerVerificationPayload commentSchemaOutput
	decodeCLIJSON(t, receiptLedgerVerification, &receiptLedgerVerificationPayload)
	if receiptLedgerVerificationPayload.Name != "commentWriteReceiptLedgerVerification" || receiptLedgerVerificationPayload.Schema["$id"] != "vivi://comments/schemas/commentWriteReceiptLedgerVerification" {
		t.Fatalf("receipt ledger verification schema payload = %s", receiptLedgerVerification.String())
	}
	receiptLedgerVerificationProperties := receiptLedgerVerificationPayload.Schema["properties"].(map[string]any)
	if _, ok := receiptLedgerVerificationProperties["verifications"]; !ok || receiptLedgerVerificationPayload.Example["ok"] != true || receiptLedgerVerificationPayload.Example["count"] != float64(1) && receiptLedgerVerificationPayload.Example["count"] != 1 || len(receiptLedgerVerificationPayload.AcceptedBy) != 1 {
		t.Fatalf("receipt ledger verification schema = %#v", receiptLedgerVerificationPayload)
	}

	triage := runCommentsCLIForTest(t, "schema", "commentTriageFileInput", "--json")
	var triagePayload commentSchemaOutput
	decodeCLIJSON(t, triage, &triagePayload)
	if triagePayload.Name != "commentTriageFileInput" || triagePayload.Schema["$id"] != "vivi://comments/schemas/commentTriageFileInput" {
		t.Fatalf("triage schema payload = %s", triage.String())
	}
	if triagePayload.Example["decision"] != "fixing" || len(triagePayload.AcceptedBy) != 2 || triagePayload.AcceptedBy[0].Command != "comments triage" || triagePayload.AcceptedBy[1].Command != "comments release" || !containsString(triagePayload.AcceptedBy[0].StdinCommand, "--triage-file") || !containsString(triagePayload.AcceptedBy[1].StdinCommand, "--triage-file") {
		t.Fatalf("triage schema command metadata = %#v", triagePayload)
	}
	properties := triagePayload.Schema["properties"].(map[string]any)
	decision := properties["decision"].(map[string]any)
	enum := decision["enum"].([]any)
	if !containsAnyString(enum, "needs-info") || !containsAnyString(enum, "not-applicable") {
		t.Fatalf("triage decision enum = %#v", enum)
	}

	result := runCommentsCLIForTest(t, "schema", "result", "--json")
	var resultPayload commentSchemaOutput
	decodeCLIJSON(t, result, &resultPayload)
	if resultPayload.Name != "commentResultFileInput" || resultPayload.Schema["$id"] != "vivi://comments/schemas/commentResultFileInput" {
		t.Fatalf("result schema payload = %s", result.String())
	}
	if len(resultPayload.AcceptedBy) != 2 || resultPayload.AcceptedBy[0].Command != "comments done" || resultPayload.AcceptedBy[1].Command != "comments dismiss" || !containsString(resultPayload.AcceptedBy[0].StdinCommand, "--result-file") {
		t.Fatalf("result schema command metadata = %#v", resultPayload.AcceptedBy)
	}
	resultProperties := resultPayload.Schema["properties"].(map[string]any)
	verification := resultProperties["verification"].(map[string]any)
	if verification["type"] != "array" || resultPayload.Example["summary"] == "" {
		t.Fatalf("result schema properties = %#v", resultPayload)
	}

	activityBatch := runCommentsCLIForTest(t, "schema", "activityBatch", "--json")
	var activityBatchPayload commentSchemaOutput
	decodeCLIJSON(t, activityBatch, &activityBatchPayload)
	if activityBatchPayload.Name != "commentActivityBatchEvent" || activityBatchPayload.Schema["$id"] != "vivi://comments/schemas/commentActivityBatchEvent" {
		t.Fatalf("activity batch schema payload = %s", activityBatch.String())
	}
	activityProperties := activityBatchPayload.Schema["properties"].(map[string]any)
	activityType := activityProperties["type"].(map[string]any)
	if activityType["const"] != "comment_thread_activity_batch" || len(activityBatchPayload.AcceptedBy) != 2 {
		t.Fatalf("activity batch schema metadata = %#v", activityBatchPayload)
	}
	if activityProperties["eventSchema"].(map[string]any)["const"] != "commentActivityBatchEvent" || !containsAnyString(activityBatchPayload.Example["eventSchemaCommand"].([]any), "commentActivityBatchEvent") {
		t.Fatalf("activity batch self-description schema = %#v", activityBatchPayload)
	}
	summary := activityProperties["summary"].(map[string]any)
	summaryProperties := summary["properties"].(map[string]any)
	if _, ok := summaryProperties["suggestedCommands"]; !ok {
		t.Fatalf("activity batch summary schema missing suggestedCommands = %#v", summaryProperties)
	}
	suggestedCommandItems := summaryProperties["suggestedCommands"].(map[string]any)["items"].(map[string]any)
	embeddedSuggestedCommandProperties := suggestedCommandItems["properties"].(map[string]any)
	if _, ok := embeddedSuggestedCommandProperties["clientEventId"]; !ok {
		t.Fatalf("suggested command schema missing clientEventId = %#v", embeddedSuggestedCommandProperties)
	}

	workClaimed := runCommentsCLIForTest(t, "schema", "workClaimed", "--json")
	var workClaimedPayload commentSchemaOutput
	decodeCLIJSON(t, workClaimed, &workClaimedPayload)
	if workClaimedPayload.Name != "commentWorkClaimedEvent" || workClaimedPayload.Schema["$id"] != "vivi://comments/schemas/commentWorkClaimedEvent" {
		t.Fatalf("work claimed schema payload = %s", workClaimed.String())
	}
	workProperties := workClaimedPayload.Schema["properties"].(map[string]any)
	workType := workProperties["type"].(map[string]any)
	if workType["const"] != "comment_work_claimed" || len(workClaimedPayload.AcceptedBy) != 1 || workClaimedPayload.Example["type"] != "comment_work_claimed" {
		t.Fatalf("work claimed schema metadata = %#v", workClaimedPayload)
	}
	if workProperties["eventSchema"].(map[string]any)["const"] != "commentWorkClaimedEvent" || !containsAnyString(workClaimedPayload.Example["eventSchemaCommand"].([]any), "commentWorkClaimedEvent") {
		t.Fatalf("work claimed self-description schema = %#v", workClaimedPayload)
	}
	workSummary := workProperties["summary"].(map[string]any)
	if workSummary["type"] != "object" || workClaimedPayload.Example["summary"].(map[string]any)["recommendedAction"] != "start_work" {
		t.Fatalf("work claimed summary schema = %#v", workClaimedPayload)
	}
	workClaimedSummaryExample := workClaimedPayload.Example["summary"].(map[string]any)
	workClaimedSuggestions := workClaimedSummaryExample["suggestedCommands"].([]any)
	if len(workClaimedSuggestions) != 3 || workClaimedSuggestions[0].(map[string]any)["intent"] != "acknowledge_initial_feedback" || workClaimedSuggestions[1].(map[string]any)["stdinSchema"] != "commentResultFileInput" || workClaimedSuggestions[2].(map[string]any)["command"] != "comments dismiss" {
		t.Fatalf("work claimed suggested command example = %#v", workClaimedSummaryExample)
	}
	workBriefProperties := workProperties["brief"].(map[string]any)["properties"].(map[string]any)
	if _, ok := workBriefProperties["suggestedCommands"]; !ok {
		t.Fatalf("work claimed brief schema missing suggestedCommands = %#v", workBriefProperties)
	}
	workClaimedBriefExample := workClaimedPayload.Example["brief"].(map[string]any)
	workClaimedBriefSuggestions := workClaimedBriefExample["suggestedCommands"].([]any)
	if len(workClaimedBriefSuggestions) != 3 || workClaimedBriefSuggestions[0].(map[string]any)["command"] != "comments triage" || workClaimedBriefSuggestions[1].(map[string]any)["stdinSchema"] != "commentResultFileInput" {
		t.Fatalf("work claimed brief suggested command example = %#v", workClaimedBriefExample)
	}

	workIdle := runCommentsCLIForTest(t, "schema", "workIdle", "--json")
	var workIdlePayload commentSchemaOutput
	decodeCLIJSON(t, workIdle, &workIdlePayload)
	if workIdlePayload.Name != "commentWorkIdleEvent" || workIdlePayload.Schema["$id"] != "vivi://comments/schemas/commentWorkIdleEvent" {
		t.Fatalf("work idle schema payload = %s", workIdle.String())
	}
	workIdleProperties := workIdlePayload.Schema["properties"].(map[string]any)
	workIdleType := workIdleProperties["type"].(map[string]any)
	if workIdleType["const"] != "comment_work_idle" || workIdlePayload.Example["reason"] != "no_claimable_work" || !containsAnyString(workIdlePayload.Example["eventSchemaCommand"].([]any), "commentWorkIdleEvent") {
		t.Fatalf("work idle schema metadata = %#v", workIdlePayload)
	}
	if _, ok := workIdleProperties["summary"]; !ok || len(workIdlePayload.AcceptedBy) != 2 || workIdlePayload.Example["summary"].(map[string]any)["recommendedAction"] != "wait_for_gui_feedback" {
		t.Fatalf("work idle summary schema = %#v", workIdlePayload)
	}

	openWorklist := runCommentsCLIForTest(t, "schema", "openWorklist", "--json")
	var openWorklistPayload commentSchemaOutput
	decodeCLIJSON(t, openWorklist, &openWorklistPayload)
	if openWorklistPayload.Name != "commentOpenWorklistEvent" || openWorklistPayload.Schema["$id"] != "vivi://comments/schemas/commentOpenWorklistEvent" {
		t.Fatalf("open worklist schema payload = %s", openWorklist.String())
	}
	openWorklistProperties := openWorklistPayload.Schema["properties"].(map[string]any)
	openWorklistType := openWorklistProperties["type"].(map[string]any)
	if openWorklistType["const"] != "comments_open_worklist" || openWorklistPayload.Example["type"] != "comments_open_worklist" || !containsAnyString(openWorklistPayload.Example["eventSchemaCommand"].([]any), "commentOpenWorklistEvent") {
		t.Fatalf("open worklist schema metadata = %#v", openWorklistPayload)
	}
	openWorklistSummary := openWorklistProperties["summary"].(map[string]any)
	openWorklistSummaryProperties := openWorklistSummary["properties"].(map[string]any)
	if _, ok := openWorklistSummaryProperties["suggestedCommands"]; !ok || openWorklistPayload.Example["summary"].(map[string]any)["recommendedAction"] != "claim_open_work" {
		t.Fatalf("open worklist summary schema = %#v", openWorklistPayload)
	}

	errorSchema := runCommentsCLIForTest(t, "schema", "error", "--json")
	var errorPayload commentSchemaOutput
	decodeCLIJSON(t, errorSchema, &errorPayload)
	if errorPayload.Name != "commentErrorEvent" || errorPayload.Schema["$id"] != "vivi://comments/schemas/commentErrorEvent" {
		t.Fatalf("error schema payload = %s", errorSchema.String())
	}
	errorProperties := errorPayload.Schema["properties"].(map[string]any)
	errorObject := errorProperties["error"].(map[string]any)
	errorObjectProperties := errorObject["properties"].(map[string]any)
	errorCode := errorObjectProperties["code"].(map[string]any)
	if !containsAnyString(errorCode["enum"].([]any), "no_live_claim") || !containsAnyString(errorCode["enum"].([]any), "claimed_by_other_actor") {
		t.Fatalf("error code schema = %#v", errorCode)
	}
	errorExample := errorPayload.Example["error"].(map[string]any)
	errorSuggestions := errorExample["suggestedCommands"].([]any)
	firstErrorSuggestion := errorSuggestions[0].(map[string]any)
	if errorExample["code"] != "no_live_claim" || len(errorSuggestions) != 2 || firstErrorSuggestion["clientEventId"] == "" || !containsAnyString(firstErrorSuggestion["args"].([]any), firstErrorSuggestion["clientEventId"].(string)) || !containsAnyString(firstErrorSuggestion["args"].([]any), "<server-url>") || !containsAnyString(errorExample["schemaCommand"].([]any), "commentErrorEvent") {
		t.Fatalf("error schema example = %#v", errorPayload.Example)
	}

	all := runCommentsCLIForTest(t, "schema", "all", "--json")
	var allPayload commentSchemaOutput
	decodeCLIJSON(t, all, &allPayload)
	if allPayload.Name != "all" || len(allPayload.Schemas) != 21 || allPayload.Schemas[0].Name != "commentProtocolManifest" || allPayload.Schemas[1].Name != "commentDoctorOutput" || allPayload.Schemas[2].Name != "commentTriageFileInput" || allPayload.Schemas[3].Name != "commentResultFileInput" || allPayload.Schemas[4].Name != "commentClaimOutput" || allPayload.Schemas[5].Name != "commentInboxOutput" || allPayload.Schemas[6].Name != "commentMineOutput" || allPayload.Schemas[7].Name != "commentBatchOutput" || allPayload.Schemas[8].Name != "commentCheckOutput" || allPayload.Schemas[9].Name != "commentTriageOutput" || allPayload.Schemas[10].Name != "commentReleaseOutput" || allPayload.Schemas[11].Name != "commentResultOutput" || allPayload.Schemas[12].Name != "commentSuggestedCommand" || allPayload.Schemas[13].Name != "commentWriteReceipt" || allPayload.Schemas[14].Name != "commentWriteReceiptVerification" || allPayload.Schemas[15].Name != "commentWriteReceiptLedgerVerification" || allPayload.Schemas[16].Name != "commentActivityBatchEvent" || allPayload.Schemas[17].Name != "commentWorkClaimedEvent" || allPayload.Schemas[18].Name != "commentWorkIdleEvent" || allPayload.Schemas[19].Name != "commentOpenWorklistEvent" || allPayload.Schemas[20].Name != "commentErrorEvent" {
		t.Fatalf("all schema payload = %s", all.String())
	}

	inboxSummaryBuffer := runCommentsCLIForTest(t, "schema", "commentInboxOutput", "--summary", "--json")
	if inboxSummaryBuffer.Len() >= 8_000 {
		t.Fatalf("inbox schema summary should stay compact, got %d bytes", inboxSummaryBuffer.Len())
	}
	var inboxSummaryPayload commentSchemaSummaryOutput
	decodeCLIJSON(t, inboxSummaryBuffer, &inboxSummaryPayload)
	if inboxSummaryPayload.Name != "commentInboxOutput" || !inboxSummaryPayload.Summary || !containsString(inboxSummaryPayload.SchemaCommand, "--summary") || !containsString(inboxSummaryPayload.FullSchemaCommand, "commentInboxOutput") {
		t.Fatalf("inbox schema summary metadata = %#v", inboxSummaryPayload)
	}
	summaryPaths := commentSchemaSummaryPaths(inboxSummaryPayload.Fields)
	for _, path := range []string{
		"summary.recommendedAction",
		"summary.suggestedCommands",
		"summary.suggestedCommands[].displayCommand",
		"unclaimed.threads[].id",
		"unclaimed.threads[].path",
		"unclaimed.threads[].comments[].body",
	} {
		if !summaryPaths[path] {
			t.Fatalf("inbox schema summary missing path %q in %#v", path, inboxSummaryPayload.Fields)
		}
	}

	suggestedCommandSummary := runCommentsCLIForTest(t, "schema", "suggestedCommand", "--summary", "--json")
	var suggestedCommandSummaryPayload commentSchemaSummaryOutput
	decodeCLIJSON(t, suggestedCommandSummary, &suggestedCommandSummaryPayload)
	suggestedCommandPaths := commentSchemaSummaryPaths(suggestedCommandSummaryPayload.Fields)
	if !suggestedCommandPaths["displayCommand"] || !suggestedCommandPaths["args"] || !suggestedCommandPaths["stdinSchemaCommand"] {
		t.Fatalf("suggested command summary paths = %#v", suggestedCommandSummaryPayload.Fields)
	}

	err := runCommentsCLIErrorForTest("schema", "missing", "--json")
	if err == nil || !strings.Contains(err.Error(), "unknown comments schema") {
		t.Fatalf("schema error = %v", err)
	}
}

func commentSchemaSummaryPaths(fields []commentSchemaFieldSummary) map[string]bool {
	paths := make(map[string]bool, len(fields))
	for _, field := range fields {
		paths[field.Path] = true
	}
	return paths
}

func TestCommentsCLIRequireClaimGuardsAgentWrites(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Guard this feedback")
	receiptLog := filepath.Join(t.TempDir(), "agent-receipts.jsonl")

	structuredErr := run([]string{"comments", "done", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--body", "Finished without a claim", "--require-claim", "--receipt-log", receiptLog, "--json"})
	if structuredErr == nil {
		t.Fatal("expected structured no-claim error")
	}
	payload, ok := cliErrorPayload(structuredErr)
	if !ok {
		t.Fatalf("expected structured no-claim error payload, got %T %v", structuredErr, structuredErr)
	}
	envelope := payload.(commentsErrorEnvelope)
	if envelope.Error.Code != "no_live_claim" || !envelope.Error.Recoverable || envelope.Error.Command != "comments done" {
		t.Fatalf("no-claim error envelope = %#v", envelope)
	}
	if len(envelope.Error.SuggestedCommands) != 2 || envelope.Error.SuggestedCommands[0].Intent != "claim_thread_before_retrying" || envelope.Error.SuggestedCommands[0].ClientEventID == "" || !containsString(envelope.Error.SuggestedCommands[0].Args, envelope.Error.SuggestedCommands[0].ClientEventID) || !containsString(envelope.Error.SuggestedCommands[0].Args, server.URL) || envelope.Error.SuggestedCommands[1].Intent != "check_thread_before_retrying" || !containsString(envelope.Error.SuggestedCommands[1].Args, server.URL) || !containsString(envelope.Error.SuggestedCommands[1].Args, receiptLog) {
		t.Fatalf("no-claim error suggestions = %#v", envelope.Error.SuggestedCommands)
	}

	err := runCommentsCLIErrorForTest("done", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--body", "Finished without a claim", "--require-claim", "--json")
	if err == nil || !strings.Contains(err.Error(), "has no live claim") {
		t.Fatalf("done without claim error = %v", err)
	}

	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "claude-code:guard-other", "--actor-kind", "claude_code", "--client-event-id", "guard-other-claim", "--json")
	structuredOtherErr := run([]string{"comments", "reply", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--body", "Reply from stale agent", "--require-claim", "--receipt-log", receiptLog, "--json"})
	if structuredOtherErr == nil {
		t.Fatal("expected structured claimed-by-other error")
	}
	payload, ok = cliErrorPayload(structuredOtherErr)
	if !ok {
		t.Fatalf("expected structured claimed-by-other error payload, got %T %v", structuredOtherErr, structuredOtherErr)
	}
	envelope = payload.(commentsErrorEnvelope)
	if envelope.Error.Code != "claimed_by_other_actor" || !envelope.Error.Recoverable || len(envelope.Error.SuggestedCommands) != 2 {
		t.Fatalf("claimed-by-other error envelope = %#v", envelope)
	}
	if envelope.Error.SuggestedCommands[0].Intent != "inspect_thread" || !containsString(envelope.Error.SuggestedCommands[0].Args, server.URL) || envelope.Error.SuggestedCommands[1].Intent != "follow_until_released" || !containsString(envelope.Error.SuggestedCommands[1].Args, server.URL) || !containsString(envelope.Error.SuggestedCommands[1].Args, receiptLog) {
		t.Fatalf("claimed-by-other error suggestions = %#v", envelope.Error.SuggestedCommands)
	}
	err = runCommentsCLIErrorForTest("reply", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--body", "Reply from stale agent", "--require-claim", "--json")
	if err == nil || !strings.Contains(err.Error(), "claimed by \"claude-code:guard-other\"") {
		t.Fatalf("reply while claimed by another actor error = %v", err)
	}
	err = runCommentsCLIErrorForTest("release", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--body", "I cannot take this one", "--json")
	if err == nil || !strings.Contains(err.Error(), "claimed by \"claude-code:guard-other\"") {
		t.Fatalf("release with body while claimed by another actor error = %v", err)
	}
	showBeforeRelease := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showBeforeReleasePayload struct {
		Thread commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, showBeforeRelease, &showBeforeReleasePayload)
	if len(showBeforeReleasePayload.Thread.Comments) != 1 {
		t.Fatalf("failed release left a stray comment: %s", showBeforeRelease.String())
	}

	runCommentsCLIForTest(t, "release", threadID, "--url", server.URL, "--actor", "claude-code:guard-other", "--actor-kind", "claude_code", "--client-event-id", "guard-other-release", "--json")
	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--client-event-id", "guard-own-claim", "--json")
	done := runCommentsCLIForTest(t, "done", threadID, "--url", server.URL, "--actor", "codex:guard", "--actor-kind", "codex", "--body", "Finished with a live claim", "--require-claim", "--json")
	var donePayload struct {
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, done, &donePayload)
	if donePayload.Comment.Body != "Finished with a live claim" || donePayload.Thread.Status != "resolved" {
		t.Fatalf("done with claim payload = %s", done.String())
	}
}

func TestCommentsCLICheckReportsWritePreflight(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Preflight this feedback")

	check := runCommentsCLIForTest(t, "check", threadID, "--url", server.URL, "--actor", "codex:check", "--actor-kind", "codex", "--with-activities", "--json")
	var payload struct {
		Thread     commentThreadOutput     `json:"thread"`
		LiveClaim  *commentActivityOutput  `json:"liveClaim"`
		Write      map[string]any          `json:"write"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, check, &payload)
	if payload.Thread.ID != threadID || payload.LiveClaim != nil || payload.Write["canWrite"] != false || payload.Write["reason"] != "no_live_claim" {
		t.Fatalf("check without claim = %s", check.String())
	}
	if payload.Write["recommendedAction"] != "claim_before_writing" {
		t.Fatalf("check without claim recommended action = %#v", payload.Write)
	}
	noClaimSuggestions := payload.Write["suggestedCommands"].([]any)
	noClaimSuggestion := noClaimSuggestions[0].(map[string]any)
	if len(noClaimSuggestions) != 1 || noClaimSuggestion["intent"] != "claim_thread_before_writing" || noClaimSuggestion["command"] != "comments claim" || noClaimSuggestion["clientEventId"] == "" || !containsAnyString(noClaimSuggestion["args"].([]any), "--client-event-id") || !containsAnyString(noClaimSuggestion["args"].([]any), noClaimSuggestion["clientEventId"].(string)) || !containsAnyString(noClaimSuggestion["args"].([]any), "--full") || !containsAnyString(noClaimSuggestion["args"].([]any), server.URL) {
		t.Fatalf("check without claim suggestions = %#v", noClaimSuggestions)
	}
	if containsActivity(payload.Activities, "thread_read", "") {
		t.Fatalf("check should not create read receipts: %#v", payload.Activities)
	}

	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "claude-code:check-other", "--actor-kind", "claude_code", "--client-event-id", "check-other-claim", "--lease", "30s", "--json")
	checkOther := runCommentsCLIForTest(t, "check", threadID, "--url", server.URL, "--actor", "codex:check", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, checkOther, &payload)
	claimedBy := payload.Write["claimedBy"].(map[string]any)
	if payload.LiveClaim == nil || payload.LiveClaim.ClientEventID != "check-other-claim" || payload.Write["canWrite"] != false || payload.Write["reason"] != "claimed_by_other_actor" || claimedBy["id"] != "claude-code:check-other" {
		t.Fatalf("check claimed by other = %s", checkOther.String())
	}
	otherClaimSuggestions := payload.Write["suggestedCommands"].([]any)
	if payload.Write["recommendedAction"] != "inspect_or_wait" || len(otherClaimSuggestions) != 2 || otherClaimSuggestions[0].(map[string]any)["intent"] != "inspect_thread" || otherClaimSuggestions[1].(map[string]any)["intent"] != "follow_until_released" || !containsAnyString(otherClaimSuggestions[0].(map[string]any)["args"].([]any), server.URL) || !containsAnyString(otherClaimSuggestions[1].(map[string]any)["args"].([]any), server.URL) {
		t.Fatalf("check claimed by other suggestions = %#v", payload.Write)
	}

	runCommentsCLIForTest(t, "release", threadID, "--url", server.URL, "--actor", "claude-code:check-other", "--actor-kind", "claude_code", "--client-event-id", "check-other-release", "--json")
	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:check", "--actor-kind", "codex", "--client-event-id", "check-own-claim", "--lease", "30s", "--json")
	checkOwn := runCommentsCLIForTest(t, "check", threadID, "--url", server.URL, "--actor", "codex:check", "--actor-kind", "codex", "--with-context", "--json")
	decodeCLIJSON(t, checkOwn, &payload)
	if payload.LiveClaim == nil || payload.LiveClaim.ClientEventID != "check-own-claim" || payload.Write["canWrite"] != true || payload.Write["reason"] != "owned_live_claim" || payload.Write["leaseExpiresAt"] == "" {
		t.Fatalf("check own claim = %s", checkOwn.String())
	}
	ownClaimSuggestions := payload.Write["suggestedCommands"].([]any)
	renewSuggestion := ownClaimSuggestions[0].(map[string]any)
	replySuggestion := ownClaimSuggestions[1].(map[string]any)
	triageSuggestion := ownClaimSuggestions[2].(map[string]any)
	releaseSuggestion := ownClaimSuggestions[3].(map[string]any)
	doneSuggestion := ownClaimSuggestions[4].(map[string]any)
	dismissSuggestion := ownClaimSuggestions[5].(map[string]any)
	if payload.Write["recommendedAction"] != "write_guarded_reply" || len(ownClaimSuggestions) != 6 || renewSuggestion["intent"] != "renew_current_claim" || renewSuggestion["clientEventId"] == "" || !containsAnyString(renewSuggestion["args"].([]any), "--client-event-id") || !containsAnyString(renewSuggestion["args"].([]any), renewSuggestion["clientEventId"].(string)) || !containsAnyString(renewSuggestion["args"].([]any), server.URL) || replySuggestion["clientEventId"] == "" || !containsAnyString(replySuggestion["args"].([]any), replySuggestion["clientEventId"].(string)) || !containsAnyString(replySuggestion["args"].([]any), server.URL) || triageSuggestion["stdinSchema"] != "commentTriageFileInput" || triageSuggestion["clientEventId"] == "" || !containsAnyString(triageSuggestion["args"].([]any), triageSuggestion["clientEventId"].(string)) || !containsAnyString(triageSuggestion["args"].([]any), server.URL) || releaseSuggestion["command"] != "comments release" || releaseSuggestion["stdinSchema"] != "commentTriageFileInput" || releaseSuggestion["clientEventId"] == "" || !containsAnyString(releaseSuggestion["args"].([]any), releaseSuggestion["clientEventId"].(string)) || !containsAnyString(releaseSuggestion["args"].([]any), server.URL) || doneSuggestion["command"] != "comments done" || doneSuggestion["clientEventId"] == "" || !containsAnyString(doneSuggestion["args"].([]any), doneSuggestion["clientEventId"].(string)) || !containsAnyString(doneSuggestion["args"].([]any), server.URL) || dismissSuggestion["command"] != "comments dismiss" || dismissSuggestion["clientEventId"] == "" || !containsAnyString(dismissSuggestion["args"].([]any), dismissSuggestion["clientEventId"].(string)) || !containsAnyString(dismissSuggestion["args"].([]any), server.URL) {
		t.Fatalf("check own claim suggestions = %#v", payload.Write)
	}
	if triageSuggestion["stdinExample"].(map[string]any)["decision"] != "accepted" || !strings.Contains(triageSuggestion["stdinExample"].(map[string]any)["summary"].(string), "understand") {
		t.Fatalf("check triage stdin example = %#v", triageSuggestion)
	}

	runCommentsCLIForTest(t, "resolve", threadID, "--url", server.URL, "--actor", "codex:check", "--actor-kind", "codex", "--json")
	checkResolved := runCommentsCLIForTest(t, "check", threadID, "--url", server.URL, "--actor", "codex:check", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, checkResolved, &payload)
	if payload.Write["canWrite"] != false || payload.Write["reason"] != "thread_not_open" || payload.Write["status"] != "resolved" {
		t.Fatalf("check terminal thread = %s", checkResolved.String())
	}
	terminalSuggestions := payload.Write["suggestedCommands"].([]any)
	reopenSuggestion := terminalSuggestions[1].(map[string]any)
	if payload.Write["recommendedAction"] != "reopen_before_writing" || len(terminalSuggestions) != 2 || !containsAnyString(terminalSuggestions[0].(map[string]any)["args"].([]any), server.URL) || reopenSuggestion["intent"] != "reopen_before_writing" || reopenSuggestion["clientEventId"] == "" || !containsAnyString(reopenSuggestion["args"].([]any), reopenSuggestion["clientEventId"].(string)) || !containsAnyString(reopenSuggestion["args"].([]any), server.URL) {
		t.Fatalf("check terminal suggestions = %#v", payload.Write)
	}
}

func TestCommentsCLIReceiptLogPropagatesThroughAgentSuggestions(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	receiptLog := filepath.Join(t.TempDir(), "agent-receipts.jsonl")
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Keep the ledger attached")

	watch := runCommentsCLIForTest(t, "watch", "--url", server.URL, "--actor", "codex:propagate", "--receipt-log", receiptLog, "--once", "--json")
	watchEvent := decodeSingleWatchEvent(t, watch)
	if len(watchEvent.Summary.SuggestedCommands) != 1 || watchEvent.Summary.SuggestedCommands[0].Command != "comments work" || !containsString(watchEvent.Summary.SuggestedCommands[0].Args, "--receipt-log") || !containsString(watchEvent.Summary.SuggestedCommands[0].Args, receiptLog) || !containsString(watchEvent.Summary.SuggestedCommands[0].Args, "--url") || !containsString(watchEvent.Summary.SuggestedCommands[0].Args, server.URL) {
		t.Fatalf("watch runtime suggestion = %#v", watchEvent.Summary.SuggestedCommands)
	}

	work := runCommentsCLIForTest(t, "work", threadID, "--url", server.URL, "--actor", "codex:propagate", "--actor-kind", "codex", "--client-event-id", "propagate-work-1", "--lease", "30s", "--full", "--receipt-log", receiptLog, "--once", "--json")
	var claimed commentWorkStreamEvent
	decodeCLIJSON(t, work, &claimed)
	if claimed.Type != "comment_work_claimed" || len(claimed.Summary.SuggestedCommands) != 4 || !containsString(claimed.Summary.SuggestedCommands[0].Args, "--receipt-log") || !containsString(claimed.Summary.SuggestedCommands[2].Args, receiptLog) || !containsString(claimed.Summary.SuggestedCommands[0].Args, "--url") || !containsString(claimed.Summary.SuggestedCommands[2].Args, server.URL) {
		t.Fatalf("work runtime suggestions = %s", work.String())
	}

	check := runCommentsCLIForTest(t, "check", threadID, "--url", server.URL, "--actor", "codex:propagate", "--actor-kind", "codex", "--receipt-log", receiptLog, "--json")
	var checkPayload struct {
		Write map[string]any `json:"write"`
	}
	decodeCLIJSON(t, check, &checkPayload)
	suggestions := checkPayload.Write["suggestedCommands"].([]any)
	replySuggestion := suggestions[1].(map[string]any)
	doneSuggestion := suggestions[4].(map[string]any)
	if !containsAnyString(replySuggestion["args"].([]any), "--receipt-log") || !containsAnyString(replySuggestion["args"].([]any), receiptLog) || !containsAnyString(replySuggestion["args"].([]any), server.URL) || !containsAnyString(doneSuggestion["args"].([]any), "--receipt-log") || !containsAnyString(doneSuggestion["args"].([]any), receiptLog) || !containsAnyString(doneSuggestion["args"].([]any), server.URL) {
		t.Fatalf("check runtime suggestions = %#v", suggestions)
	}
}

func TestCommentsCLIBodyFileFeedsRepliesAndTerminalShortcuts(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)
	tempDir := t.TempDir()
	replyBody := "Implemented triage:\n\n- Reproduced the feedback\n- Added a focused fix\n"
	replyFile := filepath.Join(tempDir, "reply.md")
	if err := os.WriteFile(replyFile, []byte(replyBody), 0o644); err != nil {
		t.Fatal(err)
	}

	reply := runCommentsCLIForTest(t, "reply", threadID, "--url", server.URL, "--actor", "codex:body-file-test", "--actor-kind", "codex", "--body-file", replyFile, "--json")
	var replyPayload struct {
		Comment commentOutput `json:"comment"`
	}
	decodeCLIJSON(t, reply, &replyPayload)
	if replyPayload.Comment.ThreadID != threadID || replyPayload.Comment.Body != strings.TrimSpace(replyBody) {
		t.Fatalf("reply body-file payload = %s", reply.String())
	}

	doneThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please verify with task check")
	doneBody := "Fixed via file:\n\n- npm run test:go -- ./cli passed\n- task check passed"
	doneFile := filepath.Join(tempDir, "done.md")
	if err := os.WriteFile(doneFile, []byte(doneBody), 0o644); err != nil {
		t.Fatal(err)
	}
	done := runCommentsCLIForTest(t, "done", doneThreadID, "--url", server.URL, "--actor", "codex:body-file-test", "--actor-kind", "codex", "--body-file", doneFile, "--json")
	var donePayload struct {
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, done, &donePayload)
	if donePayload.Comment.Body != doneBody || donePayload.Thread.Status != "resolved" {
		t.Fatalf("done body-file payload = %s", done.String())
	}

	stdinThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please archive this request")
	stdinBody := "Not applicable:\n\n- The requested change is outside this workspace\n"
	dismissed := runCommentsCLIWithStdinForTest(t, stdinBody, "dismiss", stdinThreadID, "--url", server.URL, "--actor", "codex:body-file-test", "--actor-kind", "codex", "--body-file", "-", "--json")
	var dismissPayload struct {
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, dismissed, &dismissPayload)
	if dismissPayload.Comment.Body != strings.TrimSpace(stdinBody) || dismissPayload.Thread.Status != "archived" {
		t.Fatalf("dismiss body-file stdin payload = %s", dismissed.String())
	}

	err := runCommentsCLIErrorForTest("reply", threadID, "--url", server.URL, "--body", "inline", "--body-file", replyFile, "--json")
	if err == nil || !strings.Contains(err.Error(), "--body and --body-file are mutually exclusive") {
		t.Fatalf("body/body-file conflict error = %v", err)
	}
}

func TestCommentsCLIResultFileFeedsTerminalShortcuts(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	tempDir := t.TempDir()

	doneThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please complete from structured result")
	runCommentsCLIForTest(t, "claim", doneThreadID, "--url", server.URL, "--actor", "codex:result-file", "--actor-kind", "codex", "--client-event-id", "result-file-claim", "--lease", "30s", "--json")
	resultPath := filepath.Join(tempDir, "result.json")
	if err := os.WriteFile(resultPath, []byte(`{
  "summary": "Implemented the requested CLI behavior.",
  "verification": ["go test ./cli passed", "task check passed"],
  "details": "- Claim was held while writing\n- Completion reply is retry-safe"
}`), 0o644); err != nil {
		t.Fatal(err)
	}
	done := runCommentsCLIForTest(t, "done", doneThreadID, "--url", server.URL, "--actor", "codex:result-file", "--actor-kind", "codex", "--result-file", resultPath, "--require-claim", "--json")
	var payload struct {
		Result  commentResultOutput `json:"result"`
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
		Receipt commentWriteReceipt `json:"receipt"`
	}
	decodeCLIJSON(t, done, &payload)
	if payload.Result.Outcome != "resolved" || payload.Result.Summary != "Implemented the requested CLI behavior." || len(payload.Result.Verification) != 2 || !strings.Contains(payload.Result.Details, "Claim was held") {
		t.Fatalf("result-file payload = %s", done.String())
	}
	if payload.Comment.Body != payload.Result.Body || !strings.Contains(payload.Comment.Body, "Result: resolved") || !strings.Contains(payload.Comment.Body, "- task check passed") || payload.Thread.Status != "resolved" {
		t.Fatalf("result-file comment = %s", done.String())
	}
	if payload.Receipt.Command != "comments done" || payload.Receipt.ThreadID != doneThreadID || payload.Receipt.CommentID != payload.Comment.ID || payload.Receipt.Status != "resolved" {
		t.Fatalf("result-file receipt = %s", done.String())
	}

	retry := runCommentsCLIForTest(t, "done", doneThreadID, "--url", server.URL, "--actor", "codex:result-file", "--actor-kind", "codex", "--result-file", resultPath, "--require-claim", "--json")
	decodeCLIJSON(t, retry, &payload)
	if payload.Comment.Body != payload.Result.Body || payload.Thread.Status != "resolved" {
		t.Fatalf("result-file retry payload = %s", retry.String())
	}

	stdinThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please dismiss from stdin")
	stdin := `{"summary":"This does not apply to the selected root.","verification":["source anchor inspected"],"details":"- No code change needed"}`
	dismissed := runCommentsCLIWithStdinForTest(t, stdin, "dismiss", stdinThreadID, "--url", server.URL, "--actor", "codex:result-file", "--actor-kind", "codex", "--result-file", "-", "--json")
	decodeCLIJSON(t, dismissed, &payload)
	if payload.Result.Outcome != "archived" || !strings.Contains(payload.Comment.Body, "Result: archived") || payload.Thread.Status != "archived" {
		t.Fatalf("result-file stdin payload = %s", dismissed.String())
	}

	err := runCommentsCLIErrorForTest("done", doneThreadID, "--url", server.URL, "--actor", "codex:result-file", "--result-file", resultPath, "--body", "inline", "--json")
	if err == nil || !strings.Contains(err.Error(), "--result-file cannot be combined") {
		t.Fatalf("result-file conflict error = %v", err)
	}
	err = runCommentsCLIErrorForTest("reply", doneThreadID, "--url", server.URL, "--actor", "codex:result-file", "--result-file", resultPath, "--json")
	if err == nil || !strings.Contains(err.Error(), "--result-file is only supported") {
		t.Fatalf("result-file command error = %v", err)
	}
}

func TestCommentsCLIDismissRepliesArchivesAndReusesCompletionReply(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	dismissed := runCommentsCLIForTest(t, "dismiss", threadID, "--url", server.URL, "--actor", "codex:dismiss-test", "--actor-kind", "codex", "--body", "Not applicable for this workspace", "--json")
	var payload struct {
		Comment commentOutput       `json:"comment"`
		Thread  commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, dismissed, &payload)
	if payload.Comment.ThreadID != threadID || payload.Comment.Body != "Not applicable for this workspace" || payload.Comment.CreatedBy.ID != "codex:dismiss-test" {
		t.Fatalf("dismiss comment payload = %s", dismissed.String())
	}
	if payload.Thread.ID != threadID || payload.Thread.Status != "archived" || payload.Thread.ArchivedAt == "" {
		t.Fatalf("dismiss thread payload = %s", dismissed.String())
	}
	firstCompletionCommentID := payload.Comment.ID

	retry := runCommentsCLIForTest(t, "dismiss", threadID, "--url", server.URL, "--actor", "codex:dismiss-test", "--actor-kind", "codex", "--body", "Not applicable for this workspace", "--json")
	decodeCLIJSON(t, retry, &payload)
	if payload.Comment.ID != firstCompletionCommentID || payload.Thread.Status != "archived" {
		t.Fatalf("dismiss retry payload = %s", retry.String())
	}

	show := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showPayload struct {
		Thread commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, show, &showPayload)
	if len(showPayload.Thread.Comments) != 2 {
		t.Fatalf("dismiss retry duplicated comments: %s", show.String())
	}
}

func TestCommentsCLIContextReturnsAnchoredSourceLines(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	contextOutput := runCommentsCLIForTest(t, "context", threadID, "--url", server.URL, "--context-lines", "1", "--with-activities", "--json")
	var payload struct {
		Thread     commentThreadOutput     `json:"thread"`
		Activities []commentActivityOutput `json:"activities"`
		File       struct {
			Path       string `json:"path"`
			ViewerKind string `json:"viewerKind"`
			Encoding   string `json:"encoding"`
		} `json:"file"`
		Source sourceContextOutput `json:"source"`
	}
	decodeCLIJSON(t, contextOutput, &payload)
	if payload.Thread.ID != threadID || payload.File.Path != "README.md" || payload.File.ViewerKind != "markdown" || payload.File.Encoding != "utf8" {
		t.Fatalf("context metadata = %s", contextOutput.String())
	}
	if !payload.Source.Available || payload.Source.StartLine != 1 || payload.Source.EndLine != 2 || payload.Source.AnchorStartLine != 1 || payload.Source.AnchorEndLine != 1 {
		t.Fatalf("source context range = %#v", payload.Source)
	}
	if len(payload.Source.Lines) != 2 || payload.Source.Lines[0].Number != 1 || payload.Source.Lines[0].Text != "# Vivi" || !payload.Source.Lines[0].Anchor {
		t.Fatalf("source context lines = %#v", payload.Source.Lines)
	}
	if payload.Source.Lines[1].Anchor {
		t.Fatalf("non-anchor context line was marked as anchor: %#v", payload.Source.Lines[1])
	}
	if !containsActivity(payload.Activities, "thread_created", "") {
		t.Fatalf("context activities did not include thread_created: %#v", payload.Activities)
	}
}

func TestCommentsCLIContextAndNextCanIncludeCurrentDiff(t *testing.T) {
	server := newCommentsCLITestServerWithSetup(t, func(root string) {
		runGitForCLITest(t, root, "init")
		runGitForCLITest(t, root, "config", "user.email", "vivi@example.test")
		runGitForCLITest(t, root, "config", "user.name", "Vivi")
		runGitForCLITest(t, root, "add", "README.md")
		runGitForCLITest(t, root, "commit", "-m", "initial")
		if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n\nHello from working tree\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	})
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	contextOutput := runCommentsCLIForTest(t, "context", threadID, "--url", server.URL, "--full", "--json")
	var contextPayload struct {
		Activities []commentActivityOutput `json:"activities"`
		Source     sourceContextOutput     `json:"source"`
		Diff       textDiffOutput          `json:"diff"`
	}
	decodeCLIJSON(t, contextOutput, &contextPayload)
	if !contextPayload.Source.Available {
		t.Fatalf("context full source = %s", contextOutput.String())
	}
	if contextPayload.Diff.Status != "available" || contextPayload.Diff.Path != "README.md" || contextPayload.Diff.BaseLabel != "HEAD" {
		t.Fatalf("context diff metadata = %s", contextOutput.String())
	}
	if !strings.Contains(contextPayload.Diff.Content, "-Hello") || !strings.Contains(contextPayload.Diff.Content, "+Hello from working tree") {
		t.Fatalf("context diff content = %s", contextOutput.String())
	}
	if !containsActivity(contextPayload.Activities, "thread_created", "") {
		t.Fatalf("context full activities = %#v", contextPayload.Activities)
	}

	nextOutput := runCommentsCLIForTest(t, "next", "--url", server.URL, "--actor", "codex:diff-test", "--actor-kind", "codex", "--full", "--context-lines", "1", "--json")
	var nextPayload struct {
		Thread     *commentThreadOutput    `json:"thread"`
		Activities []commentActivityOutput `json:"activities"`
		Source     sourceContextOutput     `json:"source"`
		Diff       textDiffOutput          `json:"diff"`
	}
	decodeCLIJSON(t, nextOutput, &nextPayload)
	if nextPayload.Thread == nil || nextPayload.Thread.ID != threadID || !nextPayload.Source.Available {
		t.Fatalf("next with context diff payload = %s", nextOutput.String())
	}
	if nextPayload.Diff.Status != "available" || !strings.Contains(nextPayload.Diff.Content, "+Hello from working tree") {
		t.Fatalf("next diff payload = %s", nextOutput.String())
	}
	if !containsActivity(nextPayload.Activities, "thread_read", "") {
		t.Fatalf("next full activities = %#v", nextPayload.Activities)
	}

	activeOutput := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "codex:diff-active", "--actor-kind", "codex", "--client-event-id", "active-full", "--full", "--context-lines", "1", "--json")
	var activePayload struct {
		Threads []commentThreadOutput   `json:"threads"`
		Count   int                     `json:"count"`
		Items   []commentWorkItemOutput `json:"items"`
	}
	decodeCLIJSON(t, activeOutput, &activePayload)
	if activePayload.Count != 1 || len(activePayload.Threads) != 1 || len(activePayload.Items) != 1 {
		t.Fatalf("active full worklist = %s", activeOutput.String())
	}
	if activePayload.Items[0].Thread.ID != threadID || activePayload.Items[0].Source == nil || !activePayload.Items[0].Source.Available {
		t.Fatalf("active full source item = %#v", activePayload.Items[0])
	}
	if activePayload.Items[0].Diff == nil || activePayload.Items[0].Diff.Status != "available" || !strings.Contains(activePayload.Items[0].Diff.Content, "+Hello from working tree") {
		t.Fatalf("active full diff item = %#v", activePayload.Items[0].Diff)
	}
	if !containsActivity(activePayload.Items[0].Activities, "thread_read", "active-full") {
		t.Fatalf("active full activities did not include read receipt: %#v", activePayload.Items[0].Activities)
	}

	listOutput := runCommentsCLIForTest(t, "list", "--url", server.URL, "--status", "open", "--actor", "codex:diff-list", "--actor-kind", "codex", "--client-event-id", "list-full", "--full", "--json")
	var listPayload struct {
		Threads []commentThreadOutput   `json:"threads"`
		Count   int                     `json:"count"`
		Items   []commentWorkItemOutput `json:"items"`
	}
	decodeCLIJSON(t, listOutput, &listPayload)
	if listPayload.Count != 1 || len(listPayload.Items) != 1 || listPayload.Items[0].Thread.ID != threadID {
		t.Fatalf("list full worklist = %s", listOutput.String())
	}
	if listPayload.Items[0].Source == nil || !listPayload.Items[0].Source.Available || listPayload.Items[0].Diff == nil || listPayload.Items[0].Diff.Status != "available" {
		t.Fatalf("list full item = %#v", listPayload.Items[0])
	}
	if !containsActivity(listPayload.Items[0].Activities, "thread_read", "list-full") {
		t.Fatalf("list full activities did not include read receipt: %#v", listPayload.Items[0].Activities)
	}

	watchOutput := runCommentsCLIForTest(t, "watch", "--url", server.URL, "--actor", "codex:diff-test", "--actor-kind", "codex", "--client-event-id", "watch-diff-activities", "--full", "--once", "--json")
	watchEvent := decodeSingleWatchEvent(t, watchOutput)
	if watchEvent.Count != 1 || len(watchEvent.Threads) != 1 || watchEvent.Threads[0].ID != threadID {
		t.Fatalf("watch worklist payload = %s", watchOutput.String())
	}
	if len(watchEvent.Items) != 1 || watchEvent.Items[0].Thread.ID != threadID {
		t.Fatalf("watch work items = %s", watchOutput.String())
	}
	if watchEvent.Items[0].Source == nil || !watchEvent.Items[0].Source.Available {
		t.Fatalf("watch source context = %#v", watchEvent.Items[0].Source)
	}
	if watchEvent.Items[0].Diff == nil || watchEvent.Items[0].Diff.Status != "available" || !strings.Contains(watchEvent.Items[0].Diff.Content, "+Hello from working tree") {
		t.Fatalf("watch diff payload = %#v", watchEvent.Items[0].Diff)
	}
	if !containsActivity(watchEvent.Items[0].Activities, "thread_read", "watch-diff-activities:"+watchEvent.Cursor) {
		t.Fatalf("watch activities did not include delivered read receipt: %#v", watchEvent.Items[0].Activities)
	}
}

func TestCommentsCLIWatchStreamsOpenWorklistSnapshots(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWatchForTest(t, ctx, "watch", "--url", server.URL, "--actor", "claude-code", "--actor-name", "Claude Code", "--interval", "10ms", "--max-events", "3", "--json")

	initial := receiveWatchEvent(t, events)
	if initial.Type != "comments_open_worklist" || initial.Reason != "initial" || initial.Count != 1 || initial.Threads[0].ID != threadID {
		t.Fatalf("initial watch event = %#v", initial)
	}
	if initial.SchemaVersion != commentsStreamSchemaVersion || initial.EventSchema != "commentOpenWorklistEvent" || !containsString(initial.EventSchemaCommand, "commentOpenWorklistEvent") {
		t.Fatalf("initial watch event schema metadata = %#v", initial)
	}
	if initial.Summary.RecommendedAction != "claim_open_work" || initial.Summary.OpenThreadCount != 1 || !containsString(initial.Summary.AttentionReasons, "open_threads_available") {
		t.Fatalf("initial watch summary = %#v", initial.Summary)
	}
	if len(initial.Summary.SuggestedCommands) != 1 || initial.Summary.SuggestedCommands[0].Intent != "claim_next_open_thread" || initial.Summary.SuggestedCommands[0].Command != "comments work" || initial.Summary.SuggestedCommands[0].ClientEventID == "" || !containsString(initial.Summary.SuggestedCommands[0].Args, "--client-event-id") || !containsString(initial.Summary.SuggestedCommands[0].Args, initial.Summary.SuggestedCommands[0].ClientEventID) || !containsString(initial.Summary.SuggestedCommands[0].Args, "--once") || !containsString(initial.Summary.SuggestedCommands[0].Args, "--full") || !containsString(initial.Summary.SuggestedCommands[0].Args, server.URL) {
		t.Fatalf("initial watch suggested commands = %#v", initial.Summary.SuggestedCommands)
	}
	if initial.Threads[0].Status != "open" || len(initial.Threads[0].Comments) != 1 {
		t.Fatalf("initial watch worklist = %#v", initial.Threads)
	}

	runCommentsCLIForTest(t, "reply", threadID, "--url", server.URL, "--actor", "codex:watch-test", "--actor-kind", "codex", "--body", "Taking this one", "--json")
	updated := receiveWatchEvent(t, events)
	if updated.Count != 1 || updated.Threads[0].ID != threadID || len(updated.Threads[0].Comments) != 2 || !containsString(updated.Changes, "open_thread_updated") {
		t.Fatalf("updated watch event = %#v", updated)
	}
	if updated.Cursor == initial.Cursor {
		t.Fatalf("cursor did not change after reply: %s", updated.Cursor)
	}

	runCommentsCLIForTest(t, "resolve", threadID, "--url", server.URL, "--actor", "codex:watch-test", "--actor-kind", "codex", "--json")
	removed := receiveWatchEvent(t, events)
	if removed.Count != 0 || !containsString(removed.Changes, "open_thread_removed") {
		t.Fatalf("removed watch event = %#v", removed)
	}
	if removed.Summary.RecommendedAction != "wait_for_open_work" || removed.Summary.RequiresAttention || len(removed.Summary.SuggestedCommands) != 0 {
		t.Fatalf("removed watch summary = %#v", removed.Summary)
	}
	if err := <-done; err != nil {
		t.Fatalf("watch returned error: %v", err)
	}
}

func TestCommentsCLIWatchHidesDraftsUntilPublish(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWatchForTest(t, ctx, "watch", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--interval", "10ms", "--max-events", "2", "--json")

	initial := receiveWatchEvent(t, events)
	if initial.Count != 0 {
		t.Fatalf("initial event included comments before publish: %#v", initial)
	}

	graphqlForCLI(t, server.URL, map[string]any{"operationName": "CreateDraftReviewComment", "query": `mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input: $input) { id } }`, "variables": map[string]any{"input": map[string]any{
		"path": "README.md",
		"body": "Draft-only feedback",
		"anchor": map[string]any{
			"surface": "source",
			"canonical": map[string]any{
				"path":      "README.md",
				"lineStart": float64(1),
			},
		},
	}}})
	expectNoWatchEvent(t, events, 50*time.Millisecond)

	published := graphqlForCLI(t, server.URL, map[string]any{"operationName": "PublishDraftReviewComments", "query": `mutation PublishDraftReviewComments { publishDraftReviewComments { reviewBatchId threads { id } } }`})["publishDraftReviewComments"].(map[string]any)
	publishedEvent := receiveWatchEvent(t, events)
	if publishedEvent.Count != 1 || !containsString(publishedEvent.Changes, "open_thread_added") {
		t.Fatalf("published watch event = %#v", publishedEvent)
	}
	if publishedEvent.Threads[0].ReviewBatchID != published["reviewBatchId"].(string) {
		t.Fatalf("watch event did not keep reviewBatchId as metadata: %#v", publishedEvent.Threads[0])
	}
	if publishedEvent.Threads[0].Comments[0].Body != "Draft-only feedback" {
		t.Fatalf("watch event missing published comment body: %#v", publishedEvent.Threads[0].Comments)
	}
	if err := <-done; err != nil {
		t.Fatalf("watch returned error: %v", err)
	}
}

func TestCommentsCLIWatchCursorSuppressesDuplicateResume(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	first := runCommentsCLIForTest(t, "watch", "--url", server.URL, "--actor", "claude-code", "--client-event-id", "resume-test", "--once", "--json")
	firstEvent := decodeSingleWatchEvent(t, first)
	if firstEvent.Count != 1 || firstEvent.Threads[0].ID != threadID {
		t.Fatalf("first watch event = %s", first.String())
	}

	duplicate := runCommentsCLIForTest(t, "watch", "--url", server.URL, "--actor", "claude-code", "--client-event-id", "resume-test", "--once", "--cursor", firstEvent.Cursor, "--json")
	if strings.TrimSpace(duplicate.String()) != "" {
		t.Fatalf("duplicate resume emitted output: %s", duplicate.String())
	}

	activities := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "Activities",
		"query":         `query Activities($threadId: ID!) { commentThreadActivities(threadId: $threadId) { type actor { id } clientEventId } }`,
		"variables":     map[string]any{"threadId": threadID},
	})["commentThreadActivities"].([]any)
	readReceipts := 0
	for _, activity := range activities {
		item := activity.(map[string]any)
		actor := item["actor"].(map[string]any)
		if item["type"] == "thread_read" && actor["id"] == "claude-code" && item["clientEventId"] == "resume-test:"+firstEvent.Cursor {
			readReceipts++
		}
	}
	if readReceipts != 1 {
		t.Fatalf("expected one idempotent watch read receipt, got %d in %#v", readReceipts, activities)
	}

	runCommentsCLIForTest(t, "reply", threadID, "--url", server.URL, "--actor", "codex:watch-test", "--actor-kind", "codex", "--body", "Cursor should advance", "--json")
	resumed := runCommentsCLIForTest(t, "watch", "--url", server.URL, "--actor", "claude-code", "--client-event-id", "resume-test", "--once", "--cursor", firstEvent.Cursor, "--json")
	resumedEvent := decodeSingleWatchEvent(t, resumed)
	if resumedEvent.Reason != "resumed" || resumedEvent.Cursor == firstEvent.Cursor || !containsString(resumedEvent.Changes, "open_worklist_changed") {
		t.Fatalf("resumed watch event = %s", resumed.String())
	}
}

func TestCommentsCLIFollowStreamsThreadActivity(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Initial feedback")

	initial := runCommentsCLIForTest(t, "follow", threadID, "--url", server.URL, "--once", "--json")
	initialEvent := decodeSingleFollowEvent(t, initial)
	if initialEvent.Type != "comment_thread_activity_batch" || initialEvent.Reason != "initial" || initialEvent.ThreadID != threadID || initialEvent.Count == 0 || initialEvent.Cursor == "" {
		t.Fatalf("initial follow event = %s", initial.String())
	}
	if !containsActivity(initialEvent.Activities, "thread_created", "") {
		t.Fatalf("initial follow activities = %#v", initialEvent.Activities)
	}

	duplicate := runCommentsCLIForTest(t, "follow", threadID, "--url", server.URL, "--once", "--cursor", initialEvent.Cursor, "--json")
	if strings.TrimSpace(duplicate.String()) != "" {
		t.Fatalf("duplicate follow resume emitted output: %s", duplicate.String())
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsFollowForTest(t, ctx, "follow", threadID, "--url", server.URL, "--actor", "codex:follow-test", "--actor-kind", "codex", "--cursor", initialEvent.Cursor, "--with-context", "--interval", "10ms", "--max-events", "1", "--json")
	graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "HumanFollowUp",
		"query":         `mutation HumanFollowUp($threadId: ID!, $input: AddCommentInput!) { addComment(threadId: $threadId, input: $input) { id } }`,
		"variables": map[string]any{
			"threadId": threadID,
			"input": map[string]any{
				"body":  "One more human note while the agent is working",
				"actor": map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"},
			},
		},
	})
	changed := receiveFollowEvent(t, events)
	if changed.ThreadID != threadID || changed.Count != 1 || changed.Cursor == initialEvent.Cursor {
		t.Fatalf("changed follow event = %#v", changed)
	}
	if initialEvent.SchemaVersion != 1 || changed.SchemaVersion != 1 || initialEvent.SessionID == "" || changed.SessionID == "" || initialEvent.Sequence != 1 || changed.Sequence != 1 {
		t.Fatalf("follow stream metadata initial=%#v changed=%#v", initialEvent, changed)
	}
	if initialEvent.EventSchema != "commentActivityBatchEvent" || !containsString(initialEvent.EventSchemaCommand, "commentActivityBatchEvent") || changed.EventSchema != "commentActivityBatchEvent" || !containsString(changed.EventSchemaCommand, "commentActivityBatchEvent") {
		t.Fatalf("follow event schema metadata initial=%#v changed=%#v", initialEvent, changed)
	}
	if !containsActivity(changed.Activities, "comment_added", "") {
		t.Fatalf("changed follow activities = %#v", changed.Activities)
	}
	if len(changed.Comments) != 1 || changed.Comments[0].ThreadID != threadID || changed.Comments[0].Body != "One more human note while the agent is working" || changed.Comments[0].CreatedBy.ID != "human:tasuku" {
		t.Fatalf("changed follow comments = %#v", changed.Comments)
	}
	if changed.Source == nil || !changed.Source.Available || changed.Source.Path != "README.md" || changed.Source.AnchorStartLine != 1 {
		t.Fatalf("changed follow source context = %#v", changed.Source)
	}
	if changed.Summary.HumanCommentCount != 1 || !containsString(changed.Summary.Kinds, "human_comment") {
		t.Fatalf("changed follow summary = %#v", changed.Summary)
	}
	if changed.Summary.ExternalActivityCount != 1 || changed.Summary.OwnActivityCount != 0 {
		t.Fatalf("changed follow actor-relative summary = %#v", changed.Summary)
	}
	if !changed.Summary.RequiresAttention || changed.Summary.RecommendedAction != "reconsider_work" || !containsString(changed.Summary.AttentionReasons, "external_human_comment") {
		t.Fatalf("changed follow attention summary = %#v", changed.Summary)
	}
	if len(changed.Summary.SuggestedCommands) != 4 || changed.Summary.SuggestedCommands[0].Intent != "acknowledge_follow_up" || changed.Summary.SuggestedCommands[0].Command != "comments triage" || !containsString(changed.Summary.SuggestedCommands[0].Args, "--triage-file") || !containsString(changed.Summary.SuggestedCommands[0].Args, server.URL) || changed.Summary.SuggestedCommands[0].StdinSchema != "commentTriageFileInput" {
		t.Fatalf("changed follow suggested commands = %#v", changed.Summary.SuggestedCommands)
	}
	if changed.Summary.SuggestedCommands[1].Intent != "handoff_after_blocked_or_needs_info" || changed.Summary.SuggestedCommands[1].Command != "comments release" || !containsString(changed.Summary.SuggestedCommands[1].Args, "--triage-file") || !containsString(changed.Summary.SuggestedCommands[1].Args, server.URL) || changed.Summary.SuggestedCommands[1].StdinSchema != "commentTriageFileInput" {
		t.Fatalf("changed follow release command suggestion = %#v", changed.Summary.SuggestedCommands)
	}
	if changed.Summary.SuggestedCommands[2].Intent != "complete_after_verification" || changed.Summary.SuggestedCommands[2].Command != "comments done" || !containsString(changed.Summary.SuggestedCommands[2].Args, "--result-file") || !containsString(changed.Summary.SuggestedCommands[2].Args, server.URL) || changed.Summary.SuggestedCommands[2].StdinSchema != "commentResultFileInput" {
		t.Fatalf("changed follow terminal command suggestion = %#v", changed.Summary.SuggestedCommands)
	}
	if changed.Summary.SuggestedCommands[3].Intent != "archive_after_decision" || changed.Summary.SuggestedCommands[3].Command != "comments dismiss" || !containsString(changed.Summary.SuggestedCommands[3].Args, "--result-file") || !containsString(changed.Summary.SuggestedCommands[3].Args, server.URL) || changed.Summary.SuggestedCommands[3].StdinSchema != "commentResultFileInput" {
		t.Fatalf("changed follow archive command suggestion = %#v", changed.Summary.SuggestedCommands)
	}
	if err := <-done; err != nil {
		t.Fatalf("follow returned error: %v", err)
	}
}

func TestCommentsCLIWorkClaimsAndFollowsThreadActivity(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Work on this feedback")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", threadID, "--url", server.URL, "--actor", "codex:work-1", "--actor-kind", "codex", "--client-event-id", "work-open-1", "--lease", "30s", "--full", "--interval", "10ms", "--max-events", "2", "--json")
	claimed := receiveWorkEvent(t, events)
	if claimed.Type != "comment_work_claimed" || claimed.Thread.ID != threadID || claimed.Claim.Type != "thread_claimed" || claimed.Claim.Actor.ID != "codex:work-1" {
		t.Fatalf("claimed work event = %#v", claimed)
	}
	if claimed.Claim.ID == "" || claimed.Claim.LeaseExpiresAt == "" {
		t.Fatalf("claimed work event missing claim cursor/lease = %#v", claimed.Claim)
	}
	if claimed.Source == nil || !claimed.Source.Available {
		t.Fatalf("claimed work event missing source context = %#v", claimed.Source)
	}
	if !containsActivity(claimed.Activities, "thread_claimed", "work-open-1") {
		t.Fatalf("claimed work activities did not include claim: %#v", claimed.Activities)
	}
	if claimed.SchemaVersion != 1 || claimed.SessionID == "" || claimed.Sequence != 1 {
		t.Fatalf("claimed work stream metadata = %#v", claimed)
	}
	if claimed.EventSchema != "commentWorkClaimedEvent" || !containsString(claimed.EventSchemaCommand, "commentWorkClaimedEvent") {
		t.Fatalf("claimed work event schema metadata = %#v", claimed)
	}
	if claimed.Summary.RecommendedAction != "start_work" || !claimed.Summary.RequiresAttention || !containsString(claimed.Summary.Kinds, "claimed_work") || !containsString(claimed.Summary.Kinds, "human_comment") {
		t.Fatalf("claimed work summary = %#v", claimed.Summary)
	}
	if claimed.Brief.ThreadID != threadID || claimed.Brief.Path != "README.md" || claimed.Brief.RecommendedAction != "start_work" || claimed.Brief.LatestComment != "Work on this feedback" || claimed.Brief.LatestCommentAuthor != "human:tasuku" || !containsString(claimed.Brief.SuggestedCommandIntents, "acknowledge_initial_feedback") {
		t.Fatalf("claimed work brief = %#v", claimed.Brief)
	}
	if len(claimed.Summary.SuggestedCommands) != 4 || claimed.Summary.SuggestedCommands[0].Intent != "acknowledge_initial_feedback" || !containsString(claimed.Summary.SuggestedCommands[0].Args, server.URL) || !containsString(claimed.Summary.SuggestedCommands[0].Args, "--actor-kind") || !containsString(claimed.Summary.SuggestedCommands[0].Args, "codex") || claimed.Summary.SuggestedCommands[0].StdinSchema != "commentTriageFileInput" || claimed.Summary.SuggestedCommands[1].Command != "comments release" || !containsString(claimed.Summary.SuggestedCommands[1].Args, server.URL) || claimed.Summary.SuggestedCommands[1].StdinSchema != "commentTriageFileInput" || claimed.Summary.SuggestedCommands[2].StdinSchema != "commentResultFileInput" || !containsString(claimed.Summary.SuggestedCommands[2].Args, server.URL) || !containsString(claimed.Summary.SuggestedCommands[2].Args, "--actor-kind") || !containsString(claimed.Summary.SuggestedCommands[2].Args, "codex") || claimed.Summary.SuggestedCommands[3].Command != "comments dismiss" || !containsString(claimed.Summary.SuggestedCommands[3].Args, server.URL) {
		t.Fatalf("claimed work suggested commands = %#v", claimed.Summary.SuggestedCommands)
	}
	if len(claimed.Brief.SuggestedCommands) != len(claimed.Summary.SuggestedCommands) || claimed.Brief.SuggestedCommands[0].DisplayCommand != claimed.Summary.SuggestedCommands[0].DisplayCommand || claimed.Brief.SuggestedCommands[0].StdinSchema != "commentTriageFileInput" {
		t.Fatalf("claimed work brief suggested commands = brief %#v summary %#v", claimed.Brief.SuggestedCommands, claimed.Summary.SuggestedCommands)
	}

	graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "HumanFollowUp",
		"query":         `mutation HumanFollowUp($threadId: ID!, $input: AddCommentInput!) { addComment(threadId: $threadId, input: $input) { id } }`,
		"variables": map[string]any{
			"threadId": threadID,
			"input": map[string]any{
				"body":  "Additional human note during the work session",
				"actor": map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"},
			},
		},
	})
	followed := receiveWorkEvent(t, events)
	if followed.Type != "comment_thread_activity_batch" || followed.ThreadID != threadID || followed.Cursor == claimed.Claim.ID {
		t.Fatalf("followed work event = %#v", followed)
	}
	if followed.SchemaVersion != 1 || followed.SessionID != claimed.SessionID || followed.Sequence != 2 {
		t.Fatalf("followed work stream metadata claimed=%#v followed=%#v", claimed, followed)
	}
	if followed.EventSchema != "commentActivityBatchEvent" || !containsString(followed.EventSchemaCommand, "commentActivityBatchEvent") {
		t.Fatalf("followed work event schema metadata = %#v", followed)
	}
	if !containsActivity(followed.Activities, "comment_added", "") {
		t.Fatalf("followed work activities = %#v", followed.Activities)
	}
	if len(followed.Comments) != 1 || followed.Comments[0].ThreadID != threadID || followed.Comments[0].Body != "Additional human note during the work session" || followed.Comments[0].CreatedBy.ID != "human:tasuku" {
		t.Fatalf("followed work comments = %#v", followed.Comments)
	}
	if followed.Source == nil || !followed.Source.Available || followed.Source.Path != "README.md" || followed.Source.AnchorStartLine != 1 {
		t.Fatalf("followed work source context = %#v", followed.Source)
	}
	if followed.Summary.HumanCommentCount != 1 || !containsString(followed.Summary.Kinds, "human_comment") {
		t.Fatalf("followed work summary = %#v", followed.Summary)
	}
	if followed.Summary.ExternalActivityCount != 1 || followed.Summary.ExternalCommentCount != 1 || followed.Summary.OwnActivityCount != 0 {
		t.Fatalf("followed work actor-relative summary = %#v", followed.Summary)
	}
	if !followed.Summary.RequiresAttention || followed.Summary.RecommendedAction != "reconsider_work" || !containsString(followed.Summary.AttentionReasons, "external_human_comment") {
		t.Fatalf("followed work attention summary = %#v", followed.Summary)
	}
	if len(followed.Summary.SuggestedCommands) != 4 || followed.Summary.SuggestedCommands[0].Intent != "acknowledge_follow_up" || !containsString(followed.Summary.SuggestedCommands[0].Args, threadID) || !containsString(followed.Summary.SuggestedCommands[0].Args, "codex:work-1") || !containsString(followed.Summary.SuggestedCommands[0].Args, "--actor-kind") || !containsString(followed.Summary.SuggestedCommands[0].Args, "codex") || !containsString(followed.Summary.SuggestedCommands[0].Args, server.URL) || followed.Summary.SuggestedCommands[1].Command != "comments release" || !containsString(followed.Summary.SuggestedCommands[1].Args, server.URL) || followed.Summary.SuggestedCommands[3].Command != "comments dismiss" || !containsString(followed.Summary.SuggestedCommands[3].Args, server.URL) {
		t.Fatalf("followed work suggested commands = %#v", followed.Summary.SuggestedCommands)
	}
	if err := <-done; err != nil {
		t.Fatalf("work returned error: %v", err)
	}
}

func TestCommentsCLIWorkPlacesBriefBeforeDiffInRawJSON(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Start here before reading the diff")

	output := runCommentsCLIForTest(t, "work", threadID, "--url", server.URL, "--actor", "codex:brief-order", "--actor-kind", "codex", "--client-event-id", "brief-order-1", "--lease", "30s", "--full", "--max-events", "1", "--json")
	raw := output.String()
	briefIndex := strings.Index(raw, `"brief":`)
	diffIndex := strings.Index(raw, `"diff":`)
	if briefIndex < 0 || diffIndex < 0 || briefIndex > diffIndex {
		t.Fatalf("brief should appear before diff in raw work JSON: %s", raw)
	}
	var event commentWorkStreamEvent
	decodeCLIJSON(t, output, &event)
	if event.Brief.LatestComment != "Start here before reading the diff" || event.Brief.RecommendedAction != "start_work" || len(event.Brief.SuggestedCommands) == 0 || event.Brief.SuggestedCommands[0].Command != "comments triage" {
		t.Fatalf("brief payload = %#v", event.Brief)
	}
}

func TestCommentsCLIWorkCanLimitEmittedHistory(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Initial feedback")
	for _, body := range []string{"Second note", "Third note"} {
		graphqlForCLI(t, server.URL, map[string]any{
			"operationName": "AddComment",
			"query":         `mutation AddComment($threadId: ID!, $input: AddCommentInput!) { addComment(threadId: $threadId, input: $input) { id } }`,
			"variables": map[string]any{
				"threadId": threadID,
				"input": map[string]any{
					"body":  body,
					"actor": map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"},
				},
			},
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", threadID, "--url", server.URL, "--actor", "codex:history-limit", "--actor-kind", "codex", "--client-event-id", "work-history-limit-1", "--full", "--activity-limit", "1", "--comment-limit", "2", "--max-events", "1", "--json")
	claimed := receiveWorkEvent(t, events)
	if claimed.Type != "comment_work_claimed" {
		t.Fatalf("claimed work event = %#v", claimed)
	}
	if len(claimed.Activities) != 1 || claimed.Activities[0].Type != "thread_claimed" || claimed.Activities[0].ClientEventID != "work-history-limit-1" {
		t.Fatalf("limited activities = %#v", claimed.Activities)
	}
	if len(claimed.Thread.Comments) != 2 {
		t.Fatalf("limited thread comments = %#v", claimed.Thread.Comments)
	}
	if claimed.Thread.Comments[0].Body != "Second note" || claimed.Thread.Comments[1].Body != "Third note" {
		t.Fatalf("limited comments kept wrong tail = %#v", claimed.Thread.Comments)
	}
	if err := <-done; err != nil {
		t.Fatalf("work returned error: %v", err)
	}
}

func TestCommentsCLIWorkRenewsLeaseWhileFollowing(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Keep this claim warm")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", threadID, "--url", server.URL, "--actor", "codex:work-renew", "--actor-kind", "codex", "--client-event-id", "work-renew-1", "--lease", "30s", "--renew-interval", "10ms", "--interval", "10ms", "--max-events", "2", "--json")
	claimed := receiveWorkEvent(t, events)
	if claimed.Type != "comment_work_claimed" || claimed.Claim.ID == "" {
		t.Fatalf("claimed work event = %#v", claimed)
	}

	renewed := receiveWorkEvent(t, events)
	if renewed.Type != "comment_thread_activity_batch" || renewed.ThreadID != threadID || renewed.Cursor == claimed.Claim.ID {
		t.Fatalf("renewed work event = %#v", renewed)
	}
	if renewed.SchemaVersion != 1 || renewed.SessionID != claimed.SessionID || renewed.Sequence != 2 {
		t.Fatalf("renewed work stream metadata claimed=%#v renewed=%#v", claimed, renewed)
	}
	if !containsActivity(renewed.Activities, "thread_claimed", "work-renew-1:renew:1") {
		t.Fatalf("renewed work activities = %#v", renewed.Activities)
	}
	if renewed.Summary.ClaimCount != 1 || !containsString(renewed.Summary.Kinds, "claim") {
		t.Fatalf("renewed work summary = %#v", renewed.Summary)
	}
	if renewed.Summary.OwnActivityCount != 1 || renewed.Summary.OwnClaimCount != 1 || renewed.Summary.ExternalActivityCount != 0 || !containsString(renewed.Summary.Kinds, "own_claim") {
		t.Fatalf("renewed work actor-relative summary = %#v", renewed.Summary)
	}
	if renewed.Summary.RequiresAttention || renewed.Summary.RecommendedAction != "ignore_own_heartbeat" || len(renewed.Summary.AttentionReasons) != 0 {
		t.Fatalf("renewed work attention summary = %#v", renewed.Summary)
	}
	if len(renewed.Summary.SuggestedCommands) != 0 {
		t.Fatalf("renewed work should not suggest commands = %#v", renewed.Summary.SuggestedCommands)
	}
	if len(renewed.Comments) != 0 {
		t.Fatalf("renewed work should not include comments = %#v", renewed.Comments)
	}
	if err := <-done; err != nil {
		t.Fatalf("work returned error: %v", err)
	}
}

func TestCommentsCLIWorkIdleEventIsSelfDescribing(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()

	out := runCommentsCLIForTest(t, "work", "--url", server.URL, "--actor", "codex:idle", "--actor-kind", "codex", "--once", "--json")
	var event commentWorkStreamEvent
	decodeCLIJSON(t, out, &event)
	if event.Type != "comment_work_idle" || event.SchemaVersion != 1 || event.EventSchema != "commentWorkIdleEvent" || !containsString(event.EventSchemaCommand, "commentWorkIdleEvent") {
		t.Fatalf("idle work event schema metadata = %s", out.String())
	}
	if event.Reason != "no_claimable_work" || event.Count != 0 || event.Thread.ID != "" || event.Claim.ID != "" {
		t.Fatalf("idle work event payload = %#v", event)
	}
	if event.Summary.RecommendedAction != "wait_for_gui_feedback" || event.Summary.RequiresAttention {
		t.Fatalf("idle work summary = %#v", event.Summary)
	}
}

func TestCommentsCLIWorkWaitCanEmitIdleHeartbeat(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Please handle this when the other claim releases")

	runCommentsCLIForTest(t, "claim", threadID, "--url", server.URL, "--actor", "codex:other", "--actor-kind", "codex", "--client-event-id", "other-claim-1", "--json")

	out := runCommentsCLIForTest(t, "work", "--url", server.URL, "--actor", "codex:idle-wait", "--actor-kind", "codex", "--client-event-id", "idle-wait-1", "--wait", "--idle-events", "--interval", "10ms", "--max-events", "1", "--json")
	var event commentWorkStreamEvent
	decodeCLIJSON(t, out, &event)
	if event.Type != "comment_work_idle" || event.SchemaVersion != 1 || event.EventSchema != "commentWorkIdleEvent" || event.Sequence != 1 {
		t.Fatalf("idle heartbeat metadata = %s", out.String())
	}
	if event.Reason != "no_claimable_work" || event.Count != 1 || event.Thread.ID != "" || event.Claim.ID != "" {
		t.Fatalf("idle heartbeat payload = %#v", event)
	}
	if event.Summary.RecommendedAction != "wait_for_claim_release" || !event.Summary.RequiresAttention || !hasAttentionReason(event.Summary, "open_threads_claimed_by_others") {
		t.Fatalf("idle heartbeat summary = %#v", event.Summary)
	}
	if len(event.Summary.SuggestedCommands) != 2 || event.Summary.SuggestedCommands[0].Command != "comments inbox" || !containsString(event.Summary.SuggestedCommands[0].Args, "codex:idle-wait") || event.Summary.SuggestedCommands[1].Command != "comments watch" || !containsString(event.Summary.SuggestedCommands[1].Args, event.Cursor) {
		t.Fatalf("idle heartbeat suggestions = %#v", event.Summary.SuggestedCommands)
	}
}

func TestCommentsCLIWorkStopsAfterTerminalStatus(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Close this work session")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", threadID, "--url", server.URL, "--actor", "codex:work-terminal", "--actor-kind", "codex", "--client-event-id", "work-terminal-1", "--lease", "30s", "--interval", "10ms", "--json")
	claimed := receiveWorkEvent(t, events)
	if claimed.Type != "comment_work_claimed" || claimed.Claim.ID == "" {
		t.Fatalf("claimed work event = %#v", claimed)
	}

	runCommentsCLIForTest(t, "done", threadID, "--url", server.URL, "--actor", "codex:work-terminal", "--actor-kind", "codex", "--body", "Finished from the work session", "--require-claim", "--json")
	terminal := receiveWorkEvent(t, events)
	if terminal.Type != "comment_thread_activity_batch" || terminal.ThreadID != threadID {
		t.Fatalf("terminal work event = %#v", terminal)
	}
	if terminal.SchemaVersion != 1 || terminal.SessionID != claimed.SessionID || terminal.Sequence != 2 {
		t.Fatalf("terminal work stream metadata claimed=%#v terminal=%#v", claimed, terminal)
	}
	if terminal.EventSchema != "commentActivityBatchEvent" || !containsString(terminal.EventSchemaCommand, "commentActivityBatchEvent") {
		t.Fatalf("terminal work event schema metadata = %#v", terminal)
	}
	if !containsActivity(terminal.Activities, "comment_added", "") || !containsActivity(terminal.Activities, "thread_status_changed", "") {
		t.Fatalf("terminal work activities = %#v", terminal.Activities)
	}
	if len(terminal.Comments) != 1 || terminal.Comments[0].Body != "Finished from the work session" || terminal.Comments[0].CreatedBy.ID != "codex:work-terminal" {
		t.Fatalf("terminal work comments = %#v", terminal.Comments)
	}
	if terminal.Summary.AgentCommentCount != 1 || terminal.Summary.TerminalStatus != "resolved" || !containsString(terminal.Summary.Kinds, "terminal_status") {
		t.Fatalf("terminal work summary = %#v", terminal.Summary)
	}
	if terminal.Summary.OwnActivityCount != 2 || terminal.Summary.OwnCommentCount != 1 || terminal.Summary.OwnStatusChangeCount != 1 || terminal.Summary.ExternalActivityCount != 0 {
		t.Fatalf("terminal work actor-relative summary = %#v", terminal.Summary)
	}
	if terminal.Summary.RequiresAttention || terminal.Summary.RecommendedAction != "finish_current_work" || !containsString(terminal.Summary.AttentionReasons, "terminal_status") {
		t.Fatalf("terminal work attention summary = %#v", terminal.Summary)
	}
	if len(terminal.Summary.SuggestedCommands) != 0 {
		t.Fatalf("terminal work should not suggest commands = %#v", terminal.Summary.SuggestedCommands)
	}
	if err := <-done; err != nil {
		t.Fatalf("work returned error: %v", err)
	}
}

func TestCommentsCLIWorkLoopClaimsNextThreadAfterTerminalStatus(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	firstThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Handle the first loop item")
	secondThreadID := createCommentThreadForCLIWithBody(t, server.URL, "README.md", "Handle the second loop item")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, done := startCommentsWorkForTest(t, ctx, "work", "--loop", "--url", server.URL, "--actor", "codex:work-loop", "--actor-kind", "codex", "--client-event-id", "work-loop-1", "--lease", "30s", "--interval", "10ms", "--max-events", "4", "--json")

	firstClaim := receiveWorkEvent(t, events)
	if firstClaim.Type != "comment_work_claimed" || firstClaim.Thread.ID != firstThreadID {
		t.Fatalf("first loop claim = %#v", firstClaim)
	}
	runCommentsCLIForTest(t, "done", firstThreadID, "--url", server.URL, "--actor", "codex:work-loop", "--actor-kind", "codex", "--body", "Finished first loop item", "--require-claim", "--json")
	firstTerminal := receiveWorkEvent(t, events)
	if firstTerminal.Type != "comment_thread_activity_batch" || firstTerminal.ThreadID != firstThreadID || !containsActivity(firstTerminal.Activities, "thread_status_changed", "") {
		t.Fatalf("first loop terminal event = %#v", firstTerminal)
	}
	if firstClaim.SchemaVersion != 1 || firstClaim.SessionID == "" || firstClaim.Sequence != 1 || firstTerminal.SessionID != firstClaim.SessionID || firstTerminal.Sequence != 2 {
		t.Fatalf("first loop stream metadata claim=%#v terminal=%#v", firstClaim, firstTerminal)
	}

	secondClaim := receiveWorkEvent(t, events)
	if secondClaim.Type != "comment_work_claimed" || secondClaim.Thread.ID != secondThreadID {
		t.Fatalf("second loop claim = %#v", secondClaim)
	}
	if secondClaim.SessionID != firstClaim.SessionID || secondClaim.Sequence != 3 {
		t.Fatalf("second loop claim stream metadata first=%#v second=%#v", firstClaim, secondClaim)
	}
	if secondClaim.Claim.ClientEventID != "work-loop-1" {
		t.Fatalf("second loop claim should preserve idempotency key, got %#v", secondClaim.Claim)
	}
	runCommentsCLIForTest(t, "done", secondThreadID, "--url", server.URL, "--actor", "codex:work-loop", "--actor-kind", "codex", "--body", "Finished second loop item", "--require-claim", "--json")
	secondTerminal := receiveWorkEvent(t, events)
	if secondTerminal.Type != "comment_thread_activity_batch" || secondTerminal.ThreadID != secondThreadID || !containsActivity(secondTerminal.Activities, "thread_status_changed", "") {
		t.Fatalf("second loop terminal event = %#v", secondTerminal)
	}
	if secondTerminal.SessionID != firstClaim.SessionID || secondTerminal.Sequence != 4 {
		t.Fatalf("second loop terminal stream metadata first=%#v terminal=%#v", firstClaim, secondTerminal)
	}
	if err := <-done; err != nil {
		t.Fatalf("work loop returned error: %v", err)
	}
}

func TestCommentsCLIWorkLoopRejectsSingleThreadModes(t *testing.T) {
	var output bytes.Buffer
	if err := runCommentsCommand(context.Background(), []string{"work", "thread-1", "--loop", "--actor", "codex:work-loop"}, &output); err == nil || !strings.Contains(err.Error(), "explicit thread id") {
		t.Fatalf("work --loop with thread id error = %v", err)
	}
	if err := runCommentsCommand(context.Background(), []string{"work", "--loop", "--once", "--actor", "codex:work-loop"}, &output); err == nil || !strings.Contains(err.Error(), "--once") {
		t.Fatalf("work --loop --once error = %v", err)
	}
}

type commentsCLITestServer struct {
	URL        string
	Root       string
	oldClient  *http.Client
	httpClient *http.Client
	service    *application.Service
}

func (server *commentsCLITestServer) Close() {
	http.DefaultClient = server.oldClient
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newCommentsCLITestServer(t *testing.T) *commentsCLITestServer {
	t.Helper()
	return newCommentsCLITestServerWithSetup(t, nil)
}

func newCommentsCLITestServerWithSetup(t *testing.T, setup func(root string)) *commentsCLITestServer {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n\nHello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if setup != nil {
		setup(root)
	}
	fsys, err := workspace.New(workspace.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	reviewer, err := gitreview.New(root, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	store, err := comments.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := application.NewService(application.Options{
		Workspace: fsys,
		Git:       reviewer,
		Comments:  store,
	})
	handler := vivigraphql.NewHandler(service, func(*http.Request) bool { return true })
	oldClient := http.DefaultClient
	httpClient := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder.Result(), nil
	})}
	http.DefaultClient = httpClient
	return &commentsCLITestServer{
		URL:        "http://vivi.test",
		Root:       root,
		oldClient:  oldClient,
		httpClient: httpClient,
		service:    service,
	}
}

func runGitForCLITest(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, string(output))
	}
}

func expectActivityEvent(t *testing.T, events <-chan map[string]any, eventType, threadID string) {
	t.Helper()
	select {
	case event := <-events:
		if event["type"] != eventType || event["threadId"] != threadID {
			t.Fatalf("activity event = %#v, want type=%s thread=%s", event, eventType, threadID)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for activity event %s", eventType)
	}
}

func createCommentThreadForCLI(t *testing.T, serverURL string) string {
	t.Helper()
	return createCommentThreadForCLIWithBody(t, serverURL, "README.md", "Please check the docs")
}

func createCommentThreadForCLIWithBody(t *testing.T, serverURL, path, body string) string {
	t.Helper()
	data := graphqlForCLI(t, serverURL, map[string]any{
		"operationName": "CreateThread",
		"query": `mutation CreateThread($input: CommentInput!) {
			createThread(input: $input) { id }
		}`,
		"variables": map[string]any{"input": map[string]any{
			"path": path,
			"body": body,
			"actor": map[string]any{
				"id":          "human:tasuku",
				"kind":        "human",
				"displayName": "Tasuku",
			},
			"anchor": map[string]any{
				"surface": "source",
				"canonical": map[string]any{
					"path":      path,
					"lineStart": float64(1),
					"lineEnd":   float64(1),
					"quote":     "# Vivi",
				},
			},
		}},
	})
	created := data["createThread"].(map[string]any)
	return created["id"].(string)
}

func runCommentsCLIForTest(t *testing.T, args ...string) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	if err := runCommentsCommand(context.Background(), args, &output); err != nil {
		t.Fatalf("runCommentsCommand(%v): %v\noutput:\n%s", args, err, output.String())
	}
	return &output
}

func runCommentsCLIWithStdinForTest(t *testing.T, stdin string, args ...string) *bytes.Buffer {
	t.Helper()
	originalStdin := os.Stdin
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.WriteString(stdin); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	os.Stdin = reader
	defer func() {
		os.Stdin = originalStdin
		_ = reader.Close()
	}()
	return runCommentsCLIForTest(t, args...)
}

func runCommentsCLIErrorForTest(args ...string) error {
	var output bytes.Buffer
	return runCommentsCommand(context.Background(), args, &output)
}

func decodeCLIJSON(t *testing.T, output *bytes.Buffer, target any) {
	t.Helper()
	if err := json.Unmarshal(output.Bytes(), target); err != nil {
		t.Fatalf("invalid json %q: %v", output.String(), err)
	}
}

func startCommentsWatchForTest(t *testing.T, ctx context.Context, args ...string) (<-chan commentWatchEvent, <-chan error) {
	t.Helper()
	reader, writer := io.Pipe()
	events := make(chan commentWatchEvent, 8)
	done := make(chan error, 1)
	go func() {
		err := runCommentsCommand(ctx, args, writer)
		_ = writer.CloseWithError(err)
		done <- err
	}()
	go func() {
		defer close(events)
		decoder := json.NewDecoder(reader)
		for {
			var event commentWatchEvent
			if err := decoder.Decode(&event); err != nil {
				if errors.Is(err, io.EOF) || strings.Contains(err.Error(), "file already closed") {
					return
				}
				t.Errorf("decode watch event: %v", err)
				return
			}
			events <- event
		}
	}()
	return events, done
}

func startCommentsFollowForTest(t *testing.T, ctx context.Context, args ...string) (<-chan commentFollowEvent, <-chan error) {
	t.Helper()
	reader, writer := io.Pipe()
	events := make(chan commentFollowEvent, 8)
	done := make(chan error, 1)
	go func() {
		err := runCommentsCommand(ctx, args, writer)
		_ = writer.CloseWithError(err)
		done <- err
	}()
	go func() {
		defer close(events)
		decoder := json.NewDecoder(reader)
		for {
			var event commentFollowEvent
			if err := decoder.Decode(&event); err != nil {
				if errors.Is(err, io.EOF) || strings.Contains(err.Error(), "file already closed") {
					return
				}
				t.Errorf("decode follow event: %v", err)
				return
			}
			events <- event
		}
	}()
	return events, done
}

type commentWorkStreamEvent struct {
	Type               string                      `json:"type"`
	SchemaVersion      int                         `json:"schemaVersion"`
	EventSchema        string                      `json:"eventSchema"`
	EventSchemaCommand []string                    `json:"eventSchemaCommand"`
	SessionID          string                      `json:"sessionId"`
	Sequence           int                         `json:"sequence"`
	Reason             string                      `json:"reason"`
	ThreadID           string                      `json:"threadId"`
	Cursor             string                      `json:"cursor"`
	Count              int                         `json:"count"`
	Thread             commentThreadOutput         `json:"thread"`
	Claim              commentActivityOutput       `json:"claim"`
	Brief              commentBriefOutput          `json:"brief"`
	Source             *sourceContextOutput        `json:"source"`
	Diff               *textDiffOutput             `json:"diff"`
	Summary            commentActivityBatchSummary `json:"summary"`
	Activities         []commentActivityOutput     `json:"activities"`
	Comments           []commentOutput             `json:"comments"`
}

func startCommentsWorkForTest(t *testing.T, ctx context.Context, args ...string) (<-chan commentWorkStreamEvent, <-chan error) {
	t.Helper()
	reader, writer := io.Pipe()
	events := make(chan commentWorkStreamEvent, 8)
	done := make(chan error, 1)
	go func() {
		err := runCommentsCommand(ctx, args, writer)
		_ = writer.CloseWithError(err)
		done <- err
	}()
	go func() {
		defer close(events)
		decoder := json.NewDecoder(reader)
		for {
			var event commentWorkStreamEvent
			if err := decoder.Decode(&event); err != nil {
				if errors.Is(err, io.EOF) || strings.Contains(err.Error(), "file already closed") {
					return
				}
				t.Errorf("decode work event: %v", err)
				return
			}
			events <- event
		}
	}()
	return events, done
}

func receiveWatchEvent(t *testing.T, events <-chan commentWatchEvent) commentWatchEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("watch event stream closed")
		}
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for watch event")
		return commentWatchEvent{}
	}
}

func receiveFollowEvent(t *testing.T, events <-chan commentFollowEvent) commentFollowEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("follow event stream closed")
		}
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for follow event")
		return commentFollowEvent{}
	}
}

func receiveWorkEvent(t *testing.T, events <-chan commentWorkStreamEvent) commentWorkStreamEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("work event stream closed")
		}
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for work event")
		return commentWorkStreamEvent{}
	}
}

func expectNoWatchEvent(t *testing.T, events <-chan commentWatchEvent, duration time.Duration) {
	t.Helper()
	select {
	case event := <-events:
		t.Fatalf("unexpected watch event: %#v", event)
	case <-time.After(duration):
	}
}

func decodeSingleWatchEvent(t *testing.T, output *bytes.Buffer) commentWatchEvent {
	t.Helper()
	var event commentWatchEvent
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("invalid watch event %q: %v", output.String(), err)
	}
	var extra commentWatchEvent
	if err := decoder.Decode(&extra); err != nil && !errors.Is(err, io.EOF) {
		t.Fatalf("invalid trailing watch event data %q: %v", output.String(), err)
	} else if err == nil {
		t.Fatalf("expected one watch event, got %q", output.String())
	}
	return event
}

func decodeSingleFollowEvent(t *testing.T, output *bytes.Buffer) commentFollowEvent {
	t.Helper()
	var event commentFollowEvent
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("invalid follow event %q: %v", output.String(), err)
	}
	var extra commentFollowEvent
	if err := decoder.Decode(&extra); err != nil && !errors.Is(err, io.EOF) {
		t.Fatalf("invalid trailing follow event data %q: %v", output.String(), err)
	} else if err == nil {
		t.Fatalf("expected one follow event, got %q", output.String())
	}
	return event
}

func containsString(items []string, expected string) bool {
	for _, item := range items {
		if item == expected {
			return true
		}
	}
	return false
}

func containsAnyString(items []any, expected string) bool {
	for _, item := range items {
		if item == expected {
			return true
		}
	}
	return false
}

func containsActivity(items []commentActivityOutput, activityType, clientEventID string) bool {
	for _, item := range items {
		if item.Type != activityType {
			continue
		}
		if clientEventID != "" && item.ClientEventID != clientEventID {
			continue
		}
		return true
	}
	return false
}

func containsReceiptEffect(items []commentWriteReceiptEffect, activityType, clientEventID string) bool {
	for _, item := range items {
		if item.Type != activityType {
			continue
		}
		if clientEventID != "" && item.ClientEventID != clientEventID {
			continue
		}
		return true
	}
	return false
}

func countActivity(items []commentActivityOutput, activityType, clientEventID string) int {
	count := 0
	for _, item := range items {
		if item.Type != activityType {
			continue
		}
		if clientEventID != "" && item.ClientEventID != clientEventID {
			continue
		}
		count++
	}
	return count
}

func containsCommentThread(items []commentThreadOutput, threadID string) bool {
	for _, item := range items {
		if item.ID == threadID {
			return true
		}
	}
	return false
}

func graphqlForCLI(t *testing.T, serverURL string, request map[string]any) map[string]any {
	t.Helper()
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.Post(serverURL+"/graphql", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var payload struct {
		Data   map[string]any   `json:"data"`
		Errors []map[string]any `json:"errors"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || len(payload.Errors) > 0 {
		t.Fatalf("graphql status=%d errors=%#v", res.StatusCode, payload.Errors)
	}
	return payload.Data
}
