package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

const defaultCommentsURL = "http://127.0.0.1:4317"

type commentsCommandOptions struct {
	URL            string
	JSON           bool
	Path           string
	Status         string
	ActorID        string
	ActorKind      string
	ActorName      string
	ClientEventID  string
	Body           string
	WatchInterval  time.Duration
	WatchInitial   bool
	WatchOnce      bool
	WatchMaxEvents int
	ResumeCursor   string
}

type graphqlRequest struct {
	OperationName string         `json:"operationName"`
	Query         string         `json:"query"`
	Variables     map[string]any `json:"variables,omitempty"`
}

type graphqlResponse struct {
	Data   map[string]json.RawMessage `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func runCommentsCommand(ctx context.Context, args []string, stdout io.Writer) error {
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		fmt.Fprintln(stdout, commentsHelpText())
		return nil
	}
	command := args[0]
	switch command {
	case "active":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		options.Status = "open"
		return commentsList(ctx, stdout, options)
	case "list":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		return commentsList(ctx, stdout, options)
	case "watch":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		return commentsWatch(ctx, stdout, options)
	case "show":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("show requires exactly one thread id")
		}
		return commentsShow(ctx, stdout, options, positional[0])
	case "reply":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("reply requires exactly one thread id")
		}
		if strings.TrimSpace(options.Body) == "" {
			return errors.New("reply requires --body")
		}
		return commentsReply(ctx, stdout, options, positional[0])
	case "resolve", "archive", "reopen":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return fmt.Errorf("%s requires exactly one thread id", command)
		}
		return commentsLifecycle(ctx, stdout, options, positional[0], command)
	default:
		return fmt.Errorf("unknown comments command %q", command)
	}
}

func parseCommentsFlags(command string, args []string) (commentsCommandOptions, []string, error) {
	options := commentsCommandOptions{
		URL:           strings.TrimRight(os.Getenv("VIVI_URL"), "/"),
		Status:        "",
		JSON:          true,
		WatchInterval: 2 * time.Second,
		WatchInitial:  true,
	}
	if options.URL == "" {
		options.URL = defaultCommentsURL
	}
	flags := flag.NewFlagSet("vivi comments "+command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.URL, "url", options.URL, "Vivi server URL")
	flags.BoolVar(&options.JSON, "json", true, "write JSON output")
	flags.StringVar(&options.Path, "path", "", "comment path filter")
	flags.StringVar(&options.Status, "status", "", "thread status filter")
	flags.StringVar(&options.ActorID, "actor", "", "actor id for attribution")
	flags.StringVar(&options.ActorKind, "actor-kind", "", "actor kind: human, claude_code, codex, or unknown")
	flags.StringVar(&options.ActorName, "actor-name", "", "actor display name")
	flags.StringVar(&options.ClientEventID, "client-event-id", "", "idempotency key for read activity")
	flags.StringVar(&options.Body, "body", "", "reply body")
	flags.DurationVar(&options.WatchInterval, "interval", options.WatchInterval, "watch polling interval")
	flags.StringVar(&options.ResumeCursor, "cursor", "", "resume cursor from a previous watch event")
	flags.BoolVar(&options.WatchInitial, "initial", options.WatchInitial, "emit current open worklist on startup")
	suppressInitial := false
	flags.BoolVar(&suppressInitial, "no-initial", false, "suppress current open worklist on startup")
	flags.BoolVar(&options.WatchOnce, "once", false, "poll once and exit")
	flags.IntVar(&options.WatchMaxEvents, "max-events", 0, "stop after emitting this many watch events")
	flagArgs, positional := splitCommentsFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return options, nil, err
	}
	if suppressInitial {
		options.WatchInitial = false
	}
	options.URL = strings.TrimRight(options.URL, "/")
	if options.URL == "" {
		options.URL = defaultCommentsURL
	}
	if _, err := url.ParseRequestURI(options.URL); err != nil {
		return options, nil, fmt.Errorf("invalid --url: %w", err)
	}
	options.Status = normalizeStatusFlag(options.Status)
	options.ActorKind = inferActorKind(options.ActorID, options.ActorKind)
	return options, append(positional, flags.Args()...), nil
}

func splitCommentsFlagsAndPositionals(args []string) ([]string, []string) {
	flagArgs := []string{}
	positionals := []string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positionals = append(positionals, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			positionals = append(positionals, arg)
			continue
		}
		flagArgs = append(flagArgs, arg)
		if commentsFlagRequiresValue(arg) && !strings.Contains(arg, "=") && i+1 < len(args) {
			i++
			flagArgs = append(flagArgs, args[i])
		}
	}
	return flagArgs, positionals
}

func commentsFlagRequiresValue(arg string) bool {
	name := strings.TrimLeft(arg, "-")
	if before, _, ok := strings.Cut(name, "="); ok {
		name = before
	}
	switch name {
	case "url", "path", "status", "actor", "actor-kind", "actor-name", "client-event-id", "body", "interval", "cursor", "max-events":
		return true
	default:
		return false
	}
}

func commentsList(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	threads, _, err := fetchCommentThreads(ctx, options, options.Status)
	if err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"threads": threads, "count": len(threads)})
}

func fetchCommentThreads(ctx context.Context, options commentsCommandOptions, status string) ([]commentThreadOutput, string, error) {
	variables := map[string]any{}
	if options.Path != "" {
		variables["path"] = options.Path
	}
	if status != "" {
		variables["status"] = status
	}
	var threads []commentThreadOutput
	if err := postGraphQL(ctx, options, graphqlRequest{
		OperationName: "AgentCommentThreads",
		Query: `query AgentCommentThreads($path: String, $status: CommentStatus) {
			commentThreads(path: $path, status: $status) {
				id
				path
				status
				reviewBatchId
				anchor
				createdAt
				updatedAt
				resolvedAt
				archivedAt
				comments {
					id
					threadId
					path
					viewerKind
					reviewBatchId
					anchor
					body
					createdAt
					updatedAt
					resolvedAt
					archivedAt
					status
					createdBy { id kind displayName }
				}
			}
		}`,
		Variables: variables,
	}, "commentThreads", &threads); err != nil {
		return nil, "", err
	}
	return threads, commentThreadsCursor(threads), nil
}

func commentsWatch(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	if options.Status != "" && options.Status != "open" {
		return errors.New("comments watch only supports open threads")
	}
	if options.WatchInterval <= 0 {
		return errors.New("comments watch requires a positive --interval")
	}
	if options.WatchMaxEvents < 0 {
		return errors.New("comments watch requires a non-negative --max-events")
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	var previous []commentThreadOutput
	lastCursor := strings.TrimSpace(options.ResumeCursor)
	emitted := 0
	first := true
	for {
		probeThreads, probeCursor, err := fetchCommentThreads(ctx, withoutReadHeaders(options), "open")
		if err != nil {
			if options.WatchOnce {
				return err
			}
			if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
				return err
			}
			continue
		}
		shouldEmit := false
		reason := "open_worklist_changed"
		if first {
			reason = "initial"
			shouldEmit = options.WatchInitial && (lastCursor == "" || probeCursor != lastCursor)
		} else {
			shouldEmit = probeCursor != lastCursor
		}
		if shouldEmit {
			deliveredOptions := options
			deliveredOptions.Status = "open"
			deliveredOptions.ClientEventID = watchClientEventID(options, probeCursor)
			threads, cursor, err := fetchCommentThreads(ctx, deliveredOptions, "open")
			if err != nil {
				if options.WatchOnce {
					return err
				}
				if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
					return err
				}
				continue
			}
			if !first && cursor == lastCursor {
				previous = threads
				first = false
			} else {
				event := commentWatchEvent{
					Type:      "comments_open_worklist",
					Reason:    reason,
					Changes:   watchChanges(previous, threads),
					Cursor:    cursor,
					EmittedAt: time.Now().UTC().Format(time.RFC3339Nano),
					Count:     len(threads),
					Threads:   threads,
				}
				if first && strings.TrimSpace(options.ResumeCursor) != "" {
					event.Reason = "resumed"
					event.Changes = []string{"open_worklist_changed"}
				}
				if err := encoder.Encode(event); err != nil {
					return err
				}
				lastCursor = cursor
				previous = threads
				emitted++
				if options.WatchMaxEvents > 0 && emitted >= options.WatchMaxEvents {
					return nil
				}
			}
		} else {
			previous = probeThreads
			lastCursor = probeCursor
		}
		first = false
		if options.WatchOnce {
			return nil
		}
		if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
			return err
		}
	}
}

func waitForWatchInterval(ctx context.Context, interval time.Duration) error {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func watchClientEventID(options commentsCommandOptions, cursor string) string {
	if strings.TrimSpace(options.ActorID) == "" {
		return options.ClientEventID
	}
	base := strings.TrimSpace(options.ClientEventID)
	if base == "" {
		base = "comments-watch"
	}
	return base + ":" + cursor
}

func watchChanges(previous, current []commentThreadOutput) []string {
	if previous == nil {
		if len(current) == 0 {
			return []string{}
		}
		return []string{"open_thread_added"}
	}
	previousByID := map[string]string{}
	currentByID := map[string]string{}
	for _, thread := range previous {
		previousByID[thread.ID] = commentThreadFingerprint(thread)
	}
	for _, thread := range current {
		currentByID[thread.ID] = commentThreadFingerprint(thread)
	}
	changes := []string{}
	for id := range currentByID {
		if _, ok := previousByID[id]; !ok {
			changes = appendUnique(changes, "open_thread_added")
		}
	}
	for id := range previousByID {
		if _, ok := currentByID[id]; !ok {
			changes = appendUnique(changes, "open_thread_removed")
		}
	}
	for id, fingerprint := range currentByID {
		if previousByID[id] != "" && previousByID[id] != fingerprint {
			changes = appendUnique(changes, "open_thread_updated")
		}
	}
	if len(changes) == 0 && commentThreadsCursor(previous) != commentThreadsCursor(current) {
		changes = append(changes, "open_worklist_changed")
	}
	return changes
}

func appendUnique(items []string, value string) []string {
	for _, item := range items {
		if item == value {
			return items
		}
	}
	return append(items, value)
}

func commentThreadsCursor(threads []commentThreadOutput) string {
	fingerprints := make([]string, 0, len(threads))
	for _, thread := range threads {
		fingerprints = append(fingerprints, commentThreadFingerprint(thread))
	}
	sort.Strings(fingerprints)
	bytes, _ := json.Marshal(fingerprints)
	sum := sha256.Sum256(bytes)
	return "open:" + hex.EncodeToString(sum[:])
}

func commentThreadFingerprint(thread commentThreadOutput) string {
	type cursorComment struct {
		ID            string `json:"id"`
		UpdatedAt     string `json:"updatedAt"`
		Status        string `json:"status"`
		ReviewBatchID string `json:"reviewBatchId,omitempty"`
	}
	type cursorThread struct {
		ID            string          `json:"id"`
		Path          string          `json:"path"`
		Status        string          `json:"status"`
		ReviewBatchID string          `json:"reviewBatchId,omitempty"`
		UpdatedAt     string          `json:"updatedAt,omitempty"`
		Comments      []cursorComment `json:"comments"`
	}
	value := cursorThread{
		ID:            thread.ID,
		Path:          thread.Path,
		Status:        thread.Status,
		ReviewBatchID: thread.ReviewBatchID,
		UpdatedAt:     thread.UpdatedAt,
		Comments:      make([]cursorComment, 0, len(thread.Comments)),
	}
	for _, comment := range thread.Comments {
		value.Comments = append(value.Comments, cursorComment{
			ID:            comment.ID,
			UpdatedAt:     comment.UpdatedAt,
			Status:        comment.Status,
			ReviewBatchID: comment.ReviewBatchID,
		})
	}
	bytes, _ := json.Marshal(value)
	return string(bytes)
}

func commentsShow(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	variables := map[string]any{}
	if options.Path != "" {
		variables["path"] = options.Path
	}
	var threads []commentThreadOutput
	if err := postGraphQL(ctx, options, graphqlRequest{
		OperationName: "AgentCommentThreadsForShow",
		Query: `query AgentCommentThreadsForShow($path: String) {
			commentThreads(path: $path) {
				id
				path
				status
				reviewBatchId
				anchor
				createdAt
				updatedAt
				resolvedAt
				archivedAt
				comments {
					id
					threadId
					path
					viewerKind
					reviewBatchId
					anchor
					body
					createdAt
					updatedAt
					resolvedAt
					archivedAt
					status
					createdBy { id kind displayName }
				}
			}
		}`,
		Variables: variables,
	}, "commentThreads", &threads); err != nil {
		return err
	}
	var selected *commentThreadOutput
	for index := range threads {
		if threads[index].ID == threadID {
			selected = &threads[index]
			break
		}
	}
	if selected == nil {
		return fmt.Errorf("comment thread %q not found", threadID)
	}
	var activities []commentActivityOutput
	if err := postGraphQL(ctx, withoutReadHeaders(options), graphqlRequest{
		OperationName: "AgentCommentThreadActivities",
		Query: `query AgentCommentThreadActivities($threadId: ID!) {
			commentThreadActivities(threadId: $threadId) {
				id
				threadId
				type
				actor { id kind displayName }
				commentId
				previousStatus
				status
				clientEventId
				createdAt
			}
		}`,
		Variables: map[string]any{"threadId": threadID},
	}, "commentThreadActivities", &activities); err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"thread": selected, "activities": activities})
}

func commentsReply(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	var reply commentOutput
	input := map[string]any{"body": options.Body}
	if actor := actorInput(options); actor != nil {
		input["actor"] = actor
	}
	if err := postGraphQL(ctx, withoutReadHeaders(options), graphqlRequest{
		OperationName: "AgentReplyToCommentThread",
		Query: `mutation AgentReplyToCommentThread($threadId: ID!, $input: AddCommentInput!) {
			addComment(threadId: $threadId, input: $input) {
				id
				threadId
				path
				viewerKind
				anchor
				body
				createdAt
				updatedAt
				resolvedAt
				archivedAt
				status
				createdBy { id kind displayName }
			}
		}`,
		Variables: map[string]any{"threadId": threadID, "input": input},
	}, "addComment", &reply); err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"comment": reply})
}

func commentsLifecycle(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID, action string) error {
	field := action + "Thread"
	operation := "Agent" + strings.Title(action) + "CommentThread"
	var thread commentThreadOutput
	variables := map[string]any{"id": threadID}
	query := fmt.Sprintf(`mutation %s($id: ID!, $actor: CommentActorInput) {
		%s(id: $id, actor: $actor) {
			id
			path
			status
			reviewBatchId
			anchor
			createdAt
			updatedAt
			resolvedAt
			archivedAt
			comments {
				id
				threadId
				path
				viewerKind
				reviewBatchId
				anchor
				body
				createdAt
				updatedAt
				resolvedAt
				archivedAt
				status
				createdBy { id kind displayName }
			}
		}
	}`, operation, field)
	if actor := actorInput(options); actor != nil {
		variables["actor"] = actor
	}
	if err := postGraphQL(ctx, withoutReadHeaders(options), graphqlRequest{
		OperationName: operation,
		Query:         query,
		Variables:     variables,
	}, field, &thread); err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"thread": thread})
}

func postGraphQL(ctx context.Context, options commentsCommandOptions, request graphqlRequest, dataKey string, target any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, options.URL+"/graphql", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if options.ActorID != "" {
		req.Header.Set("X-Vivi-Actor-Id", options.ActorID)
		req.Header.Set("X-Vivi-Actor-Kind", options.ActorKind)
		if options.ActorName != "" {
			req.Header.Set("X-Vivi-Actor-Name", options.ActorName)
		}
		if options.ClientEventID != "" {
			req.Header.Set("X-Vivi-Client-Event-Id", options.ClientEventID)
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, 4*1024*1024))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("graphql request failed with status %d: %s", res.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	var payload graphqlResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return err
	}
	if len(payload.Errors) > 0 {
		messages := make([]string, 0, len(payload.Errors))
		for _, item := range payload.Errors {
			messages = append(messages, item.Message)
		}
		return fmt.Errorf("graphql error: %s", strings.Join(messages, "; "))
	}
	raw, ok := payload.Data[dataKey]
	if !ok {
		return fmt.Errorf("graphql response missing data.%s", dataKey)
	}
	return json.Unmarshal(raw, target)
}

func withoutReadHeaders(options commentsCommandOptions) commentsCommandOptions {
	options.ActorID = ""
	options.ActorKind = ""
	options.ActorName = ""
	options.ClientEventID = ""
	return options
}

func writeJSON(stdout io.Writer, value any) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func actorInput(options commentsCommandOptions) map[string]any {
	if strings.TrimSpace(options.ActorID) == "" {
		return nil
	}
	actor := map[string]any{"id": options.ActorID, "kind": options.ActorKind}
	if strings.TrimSpace(options.ActorName) != "" {
		actor["displayName"] = options.ActorName
	}
	return actor
}

func inferActorKind(actorID, explicit string) string {
	kind := strings.ReplaceAll(strings.TrimSpace(explicit), "-", "_")
	if kind == "" {
		lowerActor := strings.ToLower(actorID)
		switch {
		case strings.Contains(lowerActor, "claude"):
			kind = "claude_code"
		case strings.Contains(lowerActor, "codex"):
			kind = "codex"
		case strings.Contains(lowerActor, "human"):
			kind = "human"
		default:
			kind = "unknown"
		}
	}
	switch kind {
	case "human", "claude_code", "codex", "unknown":
		return kind
	default:
		return "unknown"
	}
}

func normalizeStatusFlag(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "all":
		return ""
	case "open", "resolved", "archived":
		return strings.ToLower(strings.TrimSpace(status))
	default:
		return status
	}
}

func commentsHelpText() string {
	return strings.Join([]string{
		"vivi comments - agent-oriented comment thread CLI",
		"",
		"Usage:",
		"  vivi comments active --actor claude-code --json",
		"  vivi comments watch --actor claude-code --json",
		"  vivi comments list --status resolved --json",
		"  vivi comments show <thread-id> --json",
		"  vivi comments reply <thread-id> --body \"Fixed\" --actor codex --json",
		"  vivi comments resolve <thread-id> --actor codex --json",
		"  vivi comments archive <thread-id> --actor codex --json",
		"  vivi comments reopen <thread-id> --actor codex --json",
		"",
		"Options:",
		"  --url <url>                Vivi server URL (default: VIVI_URL or http://127.0.0.1:4317)",
		"  --json                     Write stable JSON output (default)",
		"  --path <path>              Filter threads by path where supported",
		"  --status <status>          open, resolved, archived, or all",
		"  --actor <id>               Actor id for comments and read receipts",
		"  --actor-kind <kind>        human, claude_code, codex, or unknown",
		"  --actor-name <name>        Actor display name",
		"  --client-event-id <id>     Idempotency key for read receipts",
		"  --body <text>              Reply body",
		"  --interval <duration>      Watch polling interval (default 2s)",
		"  --cursor <cursor>          Suppress an already delivered watch snapshot",
		"  --no-initial               Wait for the next open-worklist change",
		"  --once                     Poll once and exit",
		"  --max-events <count>       Stop watch after emitting count events",
	}, "\n")
}

type commentWatchEvent struct {
	Type      string                `json:"type"`
	Reason    string                `json:"reason"`
	Changes   []string              `json:"changes"`
	Cursor    string                `json:"cursor"`
	EmittedAt string                `json:"emittedAt"`
	Count     int                   `json:"count"`
	Threads   []commentThreadOutput `json:"threads"`
}

type commentThreadOutput struct {
	ID            string          `json:"id"`
	Path          string          `json:"path"`
	Status        string          `json:"status"`
	ReviewBatchID string          `json:"reviewBatchId,omitempty"`
	Anchor        json.RawMessage `json:"anchor,omitempty"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt,omitempty"`
	ResolvedAt    string          `json:"resolvedAt,omitempty"`
	ArchivedAt    string          `json:"archivedAt,omitempty"`
	Comments      []commentOutput `json:"comments"`
}

type commentOutput struct {
	ID            string          `json:"id"`
	ThreadID      string          `json:"threadId,omitempty"`
	Path          string          `json:"path"`
	ViewerKind    string          `json:"viewerKind"`
	ReviewBatchID string          `json:"reviewBatchId,omitempty"`
	Anchor        json.RawMessage `json:"anchor,omitempty"`
	Body          string          `json:"body"`
	Status        string          `json:"status"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
	ResolvedAt    string          `json:"resolvedAt,omitempty"`
	ArchivedAt    string          `json:"archivedAt,omitempty"`
	CreatedBy     actorOutput     `json:"createdBy"`
}

type commentActivityOutput struct {
	ID             string      `json:"id"`
	ThreadID       string      `json:"threadId"`
	Type           string      `json:"type"`
	Actor          actorOutput `json:"actor"`
	CommentID      string      `json:"commentId,omitempty"`
	PreviousStatus string      `json:"previousStatus,omitempty"`
	Status         string      `json:"status,omitempty"`
	ClientEventID  string      `json:"clientEventId,omitempty"`
	CreatedAt      string      `json:"createdAt"`
}

type actorOutput struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	DisplayName string `json:"displayName,omitempty"`
}
