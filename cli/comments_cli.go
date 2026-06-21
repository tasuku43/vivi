package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultCommentsURL = "http://127.0.0.1:4317"

type commentsCommandOptions struct {
	URL           string
	JSON          bool
	Path          string
	Status        string
	ActorID       string
	ActorKind     string
	ActorName     string
	ClientEventID string
	Body          string
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
		URL:    strings.TrimRight(os.Getenv("VIVI_URL"), "/"),
		Status: "",
		JSON:   true,
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
	flagArgs, positional := splitCommentsFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return options, nil, err
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
	case "url", "path", "status", "actor", "actor-kind", "actor-name", "client-event-id", "body":
		return true
	default:
		return false
	}
}

func commentsList(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	variables := map[string]any{}
	if options.Path != "" {
		variables["path"] = options.Path
	}
	if options.Status != "" {
		variables["status"] = options.Status
	}
	var data struct {
		CommentThreads []commentThreadOutput `json:"commentThreads"`
	}
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
	}, "commentThreads", &data.CommentThreads); err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"threads": data.CommentThreads, "count": len(data.CommentThreads)})
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
	}, "\n")
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
