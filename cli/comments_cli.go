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
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	defaultCommentsURL          = "http://127.0.0.1:4317"
	commentsStreamSchemaVersion = 1
	defaultAgentActivityLimit   = "20"
	defaultAgentCommentLimit    = "10"
)

type commentsCommandOptions struct {
	URL            string
	JSON           bool
	Path           string
	Status         string
	ReviewBatchID  string
	ActorID        string
	ActorKind      string
	ActorName      string
	ClientEventID  string
	Body           string
	BodyFile       string
	TriageFile     string
	ResultFile     string
	ReceiptFile    string
	ReceiptLog     string
	Result         *commentResultOutput
	TriageDecision string
	TriageSummary  string
	TriageNext     string
	Full           bool
	WithContext    bool
	WithDiff       bool
	WithActivities bool
	ActivityLimit  int
	CommentLimit   int
	RequireClaim   bool
	WaitForWork    bool
	DiffBase       string
	ContextLines   int
	WatchInterval  time.Duration
	WatchInitial   bool
	WatchOnce      bool
	WorkIdleEvents bool
	WorkLoop       bool
	WatchMaxEvents int
	ResumeCursor   string
	LeaseDuration  time.Duration
	RenewInterval  time.Duration
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

type commentsCommandError struct {
	cause   error
	payload commentsErrorEnvelope
}

type commentsErrorEnvelope struct {
	Error commentsErrorOutput `json:"error"`
}

type commentsErrorOutput struct {
	SchemaVersion     int                       `json:"schemaVersion"`
	Code              string                    `json:"code"`
	Message           string                    `json:"message"`
	Command           string                    `json:"command"`
	Args              []string                  `json:"args,omitempty"`
	Recoverable       bool                      `json:"recoverable"`
	SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands,omitempty"`
	SchemaCommand     []string                  `json:"schemaCommand,omitempty"`
}

func (err *commentsCommandError) Error() string {
	return err.cause.Error()
}

func (err *commentsCommandError) Unwrap() error {
	return err.cause
}

func (err *commentsCommandError) CLIPayload() any {
	return err.payload
}

func newCommentsCommandError(args []string, cause error) error {
	command := "comments"
	commandName := ""
	if len(args) > 0 {
		commandName = args[0]
		command = "comments " + commandName
	}
	code := commentsErrorCode(commandName, cause)
	output := commentsErrorOutput{
		SchemaVersion:     commentsStreamSchemaVersion,
		Code:              code,
		Message:           cause.Error(),
		Command:           command,
		Args:              append([]string{"comments"}, args...),
		Recoverable:       commentsErrorRecoverable(code),
		SuggestedCommands: suggestedCommandsForCommentsError(commandName, args, code),
		SchemaCommand:     commentSchemaCommandArgs("commentErrorEvent"),
	}
	return &commentsCommandError{
		cause: cause,
		payload: commentsErrorEnvelope{
			Error: output,
		},
	}
}

func commentsWantsJSON(args []string) bool {
	for index, arg := range args {
		if arg == "--" {
			return true
		}
		if arg == "--json=false" || arg == "--json=0" {
			return false
		}
		if arg == "--json" && index+1 < len(args) {
			next := strings.TrimSpace(strings.ToLower(args[index+1]))
			if next == "false" || next == "0" {
				return false
			}
		}
	}
	return true
}

func commentsErrorCode(command string, err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "connection refused") ||
		strings.Contains(message, "connect:") ||
		strings.Contains(message, "no such host") ||
		strings.Contains(message, "context deadline exceeded"):
		return "server_unreachable"
	case strings.Contains(message, "no live claim") || strings.Contains(message, "has no live claim"):
		return "no_live_claim"
	case strings.Contains(message, "claimed by") || strings.Contains(message, "already claimed"):
		return "claimed_by_other_actor"
	case strings.Contains(message, "not found"):
		return "not_found"
	case strings.Contains(message, "graphql error"):
		return "upstream_graphql_error"
	case strings.Contains(message, "requires") ||
		strings.Contains(message, "unexpected argument") ||
		strings.Contains(message, "cannot be combined") ||
		strings.Contains(message, "mutually exclusive") ||
		strings.Contains(message, "unknown comments command") ||
		strings.Contains(message, "unknown comments schema"):
		return "invalid_arguments"
	default:
		if command == "" {
			return "invalid_arguments"
		}
		return "comments_command_failed"
	}
}

func commentsErrorRecoverable(code string) bool {
	switch code {
	case "server_unreachable", "no_live_claim", "claimed_by_other_actor", "thread_not_open", "upstream_graphql_error", "comments_command_failed":
		return true
	default:
		return false
	}
}

func suggestedCommandsForCommentsError(command string, args []string, code string) []commentSuggestedCommand {
	actorID := commentsArgValue(args, "--actor")
	serverURL := commentsSuggestedServerURL(args)
	receiptLog := commentsArgValue(args, "--receipt-log")
	if code == "invalid_arguments" {
		if positionalURL := commentsPositionalURLArg(args); positionalURL != "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("retry_with_url_flag", "comments "+command, withURLArg(removeFirstArg(append([]string{"comments"}, args...), positionalURL), strings.TrimRight(positionalURL, "/")), "", "Move the Vivi server URL into --url; positional URLs are treated as unexpected arguments."),
			}
		}
	}
	if code == "server_unreachable" {
		doctorArgs := []string{"comments", "doctor"}
		if actorID != "" {
			doctorArgs = append(doctorArgs, "--actor", actorID)
		}
		if clientEventID := commentsArgValue(args, "--client-event-id"); clientEventID != "" {
			doctorArgs = append(doctorArgs, "--client-event-id", clientEventID)
		}
		doctorArgs = append(doctorArgs, "--json")
		return []commentSuggestedCommand{
			suggestedCommentsCommand("load_protocol_offline", "comments protocol", withReceiptLogArg([]string{"comments", "protocol", "--json"}, receiptLog), "", "Load the server-independent agent protocol while waiting for Vivi to start."),
			suggestedCommentsCommand("retry_server_readiness", "comments doctor", withRuntimeArgs(doctorArgs, serverURL, receiptLog), "", "After starting Vivi or correcting --url/VIVI_URL, retry the online readiness check."),
		}
	}
	threadID := firstCommentsPositionalArg(command, args)
	if threadID == "" {
		return nil
	}
	switch code {
	case "no_live_claim":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the thread before retrying the failed write."),
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("claim_thread_before_retrying", "comments claim", withURLArg([]string{"comments", "claim", threadID, "--actor", actorID, "--full", "--json"}, serverURL), "", "Claim this thread before retrying the failed guarded write.", commentSuggestedClientEventID("error", threadID, "claim")),
			suggestedCommentsCommand("check_thread_before_retrying", "comments check", withRuntimeArgs([]string{"comments", "check", threadID, "--actor", actorID, "--full", "--json"}, serverURL, receiptLog), "", "Inspect live claim ownership and use write.suggestedCommands for the next safe write."),
		}
	case "claimed_by_other_actor":
		showArgs := []string{"comments", "show", threadID, "--json"}
		if actorID != "" {
			showArgs = []string{"comments", "show", threadID, "--actor", actorID, "--json"}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_thread", "comments show", withURLArg(showArgs, serverURL), "", "Inspect the current claim owner and latest thread state."),
			suggestedCommentsCommand("follow_until_released", "comments follow", withRuntimeArgs([]string{"comments", "follow", threadID, "--no-initial", "--json"}, serverURL, receiptLog), "", "Watch for release, terminal status, or new human feedback before retrying."),
		}
	case "not_found":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_open_work", "comments active", withURLArg([]string{"comments", "active", "--json"}, serverURL), "", "Inspect the current open worklist before retrying with a fresh thread id."),
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_open_work", "comments inbox", withRuntimeArgs([]string{"comments", "inbox", "--actor", actorID, "--json"}, serverURL, receiptLog), "", "Inspect the current open work queues before retrying with a fresh thread id."),
		}
	default:
		return nil
	}
}

func commentsSuggestedServerURL(args []string) string {
	if serverURL := commentsArgValue(args, "--url"); serverURL != "" {
		return serverURL
	}
	return strings.TrimSpace(os.Getenv("VIVI_URL"))
}

func commentsPositionalURLArg(args []string) string {
	if len(args) < 2 {
		return ""
	}
	_, positional := splitCommentsFlagsAndPositionals(args[1:])
	for _, arg := range positional {
		if looksLikeServerURL(arg) {
			return arg
		}
	}
	return ""
}

func commentsArgValue(args []string, flagName string) string {
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == "--" {
			return ""
		}
		if before, after, ok := strings.Cut(arg, "="); ok && before == flagName {
			return strings.TrimSpace(after)
		}
		if arg == flagName && index+1 < len(args) {
			return strings.TrimSpace(args[index+1])
		}
	}
	return ""
}

func firstCommentsPositionalArg(command string, args []string) string {
	if len(args) == 0 {
		return ""
	}
	rest := args[1:]
	for index := 0; index < len(rest); index++ {
		arg := rest[index]
		if arg == "--" {
			if index+1 < len(rest) {
				return rest[index+1]
			}
			return ""
		}
		if strings.HasPrefix(arg, "-") && arg != "-" {
			if commentsFlagRequiresValue(arg) && !strings.Contains(arg, "=") && index+1 < len(rest) {
				index++
			}
			continue
		}
		return arg
	}
	return ""
}

func runCommentsCommand(ctx context.Context, args []string, stdout io.Writer) error {
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" || hasHelpFlag(args[1:]) {
		fmt.Fprintln(stdout, commentsHelpText())
		return nil
	}
	command := args[0]
	switch command {
	case "protocol":
		options, positional, err := parseCommentsProtocolFlags(args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		return commentsProtocol(stdout, options)
	case "schema":
		options, positional, err := parseCommentsSchemaFlags(args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("schema requires exactly one schema name")
		}
		return commentsSchema(stdout, options, positional[0])
	case "doctor":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		return commentsDoctor(ctx, stdout, options)
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
	case "next":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		if options.ContextLines < 0 {
			return errors.New("next requires a non-negative --context-lines")
		}
		return commentsNext(ctx, stdout, options)
	case "claim":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 1 {
			return errors.New("claim accepts at most one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("claim requires --actor")
		}
		if options.ContextLines < 0 {
			return errors.New("claim requires a non-negative --context-lines")
		}
		if options.LeaseDuration <= 0 {
			return errors.New("claim requires a positive --lease")
		}
		threadID := ""
		if len(positional) == 1 {
			threadID = positional[0]
		}
		if options.WaitForWork {
			if threadID != "" {
				return errors.New("claim --wait cannot be used with an explicit thread id")
			}
			if options.WatchInterval <= 0 {
				return errors.New("claim --wait requires a positive --interval")
			}
			return commentsClaimWait(ctx, stdout, options)
		}
		return commentsClaim(ctx, stdout, options, threadID)
	case "work":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 1 {
			return errors.New("work accepts at most one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("work requires --actor")
		}
		if options.ContextLines < 0 {
			return errors.New("work requires a non-negative --context-lines")
		}
		if options.LeaseDuration <= 0 {
			return errors.New("work requires a positive --lease")
		}
		if options.WatchInterval <= 0 {
			return errors.New("work requires a positive --interval")
		}
		if options.RenewInterval < 0 {
			return errors.New("work requires a non-negative --renew-interval")
		}
		if options.WatchMaxEvents < 0 {
			return errors.New("work requires a non-negative --max-events")
		}
		threadID := ""
		if len(positional) == 1 {
			threadID = positional[0]
		}
		if options.WorkLoop && threadID != "" {
			return errors.New("work --loop cannot be used with an explicit thread id")
		}
		if options.WorkLoop && options.WatchOnce {
			return errors.New("work --loop cannot be used with --once")
		}
		return commentsWork(ctx, stdout, options, threadID)
	case "renew":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("renew requires exactly one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("renew requires --actor")
		}
		if options.LeaseDuration <= 0 {
			return errors.New("renew requires a positive --lease")
		}
		return commentsRenew(ctx, stdout, options, positional[0])
	case "hold":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("hold requires exactly one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("hold requires --actor")
		}
		if options.LeaseDuration <= 0 {
			return errors.New("hold requires a positive --lease")
		}
		if options.WatchInterval <= 0 {
			return errors.New("hold requires a positive --interval")
		}
		if options.WatchMaxEvents < 0 {
			return errors.New("hold requires a non-negative --max-events")
		}
		return commentsHold(ctx, stdout, options, positional[0])
	case "inbox":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("inbox requires --actor")
		}
		if options.ContextLines < 0 {
			return errors.New("inbox requires a non-negative --context-lines")
		}
		return commentsInbox(ctx, stdout, options)
	case "batch":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 1 {
			return errors.New("batch accepts at most one review batch id")
		}
		if len(positional) == 1 {
			if strings.TrimSpace(options.ReviewBatchID) != "" && strings.TrimSpace(options.ReviewBatchID) != positional[0] {
				return errors.New("batch review batch id conflicts with --review-batch")
			}
			options.ReviewBatchID = positional[0]
		}
		if strings.TrimSpace(options.ReviewBatchID) == "" {
			return errors.New("batch requires a review batch id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("batch requires --actor")
		}
		if options.ContextLines < 0 {
			return errors.New("batch requires a non-negative --context-lines")
		}
		return commentsBatch(ctx, stdout, options)
	case "mine":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("mine requires --actor")
		}
		return commentsMine(ctx, stdout, options)
	case "release":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("release requires exactly one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("release requires --actor")
		}
		if options.RequireClaim && strings.TrimSpace(options.ActorID) == "" {
			return errors.New("release --require-claim requires --actor")
		}
		return commentsRelease(ctx, stdout, options, positional[0])
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
	case "follow":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("follow requires exactly one thread id")
		}
		if options.WatchInterval <= 0 {
			return errors.New("follow requires a positive --interval")
		}
		if options.WatchMaxEvents < 0 {
			return errors.New("follow requires a non-negative --max-events")
		}
		return commentsFollow(ctx, stdout, options, positional[0])
	case "show":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("show requires exactly one thread id")
		}
		return commentsShow(ctx, stdout, options, positional[0])
	case "check":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("check requires exactly one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("check requires --actor")
		}
		if options.ContextLines < 0 {
			return errors.New("check requires a non-negative --context-lines")
		}
		return commentsCheck(ctx, stdout, options, positional[0])
	case "verify-receipt", "receipt":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		if strings.TrimSpace(options.ReceiptFile) == "" {
			return errors.New("verify-receipt requires --receipt-file")
		}
		return commentsVerifyReceipt(ctx, stdout, options)
	case "verify-receipts", "receipts":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		if strings.TrimSpace(options.ReceiptLog) == "" {
			return errors.New("verify-receipts requires --receipt-log")
		}
		return commentsVerifyReceiptLog(ctx, stdout, options)
	case "context":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("context requires exactly one thread id")
		}
		if options.ContextLines < 0 {
			return errors.New("context requires a non-negative --context-lines")
		}
		return commentsContext(ctx, stdout, options, positional[0])
	case "reply":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("reply requires exactly one thread id")
		}
		if strings.TrimSpace(options.Body) == "" {
			return errors.New("reply requires --body or --body-file")
		}
		if options.RequireClaim && strings.TrimSpace(options.ActorID) == "" {
			return errors.New("reply --require-claim requires --actor")
		}
		return commentsReply(ctx, stdout, options, positional[0])
	case "triage":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return errors.New("triage requires exactly one thread id")
		}
		if strings.TrimSpace(options.ActorID) == "" {
			return errors.New("triage requires --actor")
		}
		if strings.TrimSpace(options.TriageDecision) == "" {
			return errors.New("triage requires --decision")
		}
		if strings.TrimSpace(options.TriageSummary) == "" && strings.TrimSpace(options.Body) == "" {
			return errors.New("triage requires --summary, --body, or --body-file")
		}
		if options.RequireClaim && strings.TrimSpace(options.ActorID) == "" {
			return errors.New("triage --require-claim requires --actor")
		}
		return commentsTriage(ctx, stdout, options, positional[0])
	case "done", "dismiss":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return fmt.Errorf("%s requires exactly one thread id", command)
		}
		if strings.TrimSpace(options.Body) == "" {
			return fmt.Errorf("%s requires --body, --body-file, or --result-file", command)
		}
		if options.RequireClaim && strings.TrimSpace(options.ActorID) == "" {
			return fmt.Errorf("%s --require-claim requires --actor", command)
		}
		if command == "dismiss" {
			return commentsDismiss(ctx, stdout, options, positional[0])
		}
		return commentsDone(ctx, stdout, options, positional[0])
	case "resolve", "archive", "reopen":
		options, positional, err := parseCommentsFlags(command, args[1:])
		if err != nil {
			return err
		}
		if len(positional) != 1 {
			return fmt.Errorf("%s requires exactly one thread id", command)
		}
		if options.RequireClaim && strings.TrimSpace(options.ActorID) == "" {
			return fmt.Errorf("%s --require-claim requires --actor", command)
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
		ContextLines:  6,
		WatchInterval: 2 * time.Second,
		WatchInitial:  true,
		LeaseDuration: 10 * time.Minute,
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
	flags.StringVar(&options.ReviewBatchID, "review-batch", "", "review batch id filter")
	flags.StringVar(&options.ActorID, "actor", "", "actor id for attribution")
	flags.StringVar(&options.ActorKind, "actor-kind", "", "actor kind: human, claude_code, codex, or unknown")
	flags.StringVar(&options.ActorName, "actor-name", "", "actor display name")
	flags.StringVar(&options.ClientEventID, "client-event-id", "", "idempotency key for read activity")
	flags.StringVar(&options.Body, "body", "", "reply body")
	flags.StringVar(&options.BodyFile, "body-file", "", "path to read reply body from")
	flags.StringVar(&options.TriageFile, "triage-file", "", "path to read structured triage JSON from")
	flags.StringVar(&options.ResultFile, "result-file", "", "path to read structured terminal result JSON from")
	flags.StringVar(&options.ReceiptFile, "receipt-file", "", "path to read a write receipt JSON object or command payload from")
	flags.StringVar(&options.ReceiptLog, "receipt-log", "", "path to append successful write receipts as JSONL")
	flags.StringVar(&options.TriageDecision, "decision", "", "triage decision for comments triage")
	flags.StringVar(&options.TriageSummary, "summary", "", "triage summary for comments triage")
	flags.StringVar(&options.TriageNext, "next-action", "", "next action for comments triage")
	flags.BoolVar(&options.Full, "full", false, "include source context, current diff, and activity history")
	flags.BoolVar(&options.WithContext, "with-context", false, "include source context with next, context, or watch")
	flags.BoolVar(&options.WithDiff, "with-diff", false, "include current Git diff with next, context, or watch")
	flags.BoolVar(&options.WithActivities, "with-activities", false, "include thread activity history with next, context, or watch")
	flags.IntVar(&options.ActivityLimit, "activity-limit", 0, "limit emitted activity history to the most recent count")
	flags.IntVar(&options.CommentLimit, "comment-limit", 0, "limit emitted thread comments to the most recent count")
	flags.BoolVar(&options.RequireClaim, "require-claim", false, "require the current actor to hold the live thread claim before writing")
	flags.BoolVar(&options.WaitForWork, "wait", false, "wait until claimable comment work is available")
	flags.StringVar(&options.DiffBase, "diff-base", "", "Git diff base ref")
	flags.IntVar(&options.ContextLines, "context-lines", options.ContextLines, "source lines around the anchor")
	flags.DurationVar(&options.WatchInterval, "interval", options.WatchInterval, "watch polling interval")
	flags.StringVar(&options.ResumeCursor, "cursor", "", "resume cursor from a previous watch event")
	flags.BoolVar(&options.WatchInitial, "initial", options.WatchInitial, "emit current open worklist on startup")
	suppressInitial := false
	flags.BoolVar(&suppressInitial, "no-initial", false, "suppress current open worklist on startup")
	flags.BoolVar(&options.WatchOnce, "once", false, "poll once and exit")
	flags.BoolVar(&options.WorkIdleEvents, "idle-events", false, "emit comment_work_idle events while comments work is waiting")
	flags.BoolVar(&options.WorkLoop, "loop", false, "keep comments work running after terminal status and claim the next item")
	flags.IntVar(&options.WatchMaxEvents, "max-events", 0, "stop after emitting this many watch events")
	flags.DurationVar(&options.LeaseDuration, "lease", options.LeaseDuration, "claim lease duration")
	flags.DurationVar(&options.RenewInterval, "renew-interval", options.RenewInterval, "work lease renewal interval")
	flagArgs, positional := splitCommentsFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return options, nil, err
	}
	if suppressInitial {
		options.WatchInitial = false
	}
	if strings.TrimSpace(options.ReceiptFile) != "" {
		if command != "verify-receipt" && command != "receipt" {
			return options, nil, fmt.Errorf("--receipt-file is only supported with comments verify-receipt")
		}
		if strings.TrimSpace(options.Body) != "" || strings.TrimSpace(options.BodyFile) != "" || strings.TrimSpace(options.TriageFile) != "" || strings.TrimSpace(options.ResultFile) != "" {
			return options, nil, errors.New("--receipt-file cannot be combined with --body, --body-file, --triage-file, or --result-file")
		}
	}
	if strings.TrimSpace(options.ReceiptLog) != "" && !commentsCommandWritesReceipt(command) && !commentsCommandVerifiesReceiptLog(command) && !commentsCommandPropagatesReceiptLog(command) && command != "doctor" {
		return options, nil, fmt.Errorf("--receipt-log is only supported with comments reply, triage, release, done, dismiss, verify-receipts, doctor, claim, work, watch, follow, check, inbox, or batch")
	}
	if strings.TrimSpace(options.ReceiptLog) != "" && (commentsCommandVerifiesReceiptLog(command) || command == "doctor") {
		if strings.TrimSpace(options.Body) != "" || strings.TrimSpace(options.BodyFile) != "" || strings.TrimSpace(options.TriageFile) != "" || strings.TrimSpace(options.ResultFile) != "" || strings.TrimSpace(options.ReceiptFile) != "" {
			return options, nil, errors.New("--receipt-log cannot be combined with --body, --body-file, --triage-file, --result-file, or --receipt-file")
		}
	}
	if strings.TrimSpace(options.ReceiptLog) == "-" && !commentsCommandVerifiesReceiptLog(command) {
		return options, nil, fmt.Errorf("%s --receipt-log requires a path, not -", command)
	}
	if strings.TrimSpace(options.TriageFile) != "" {
		if command != "triage" && command != "release" {
			return options, nil, fmt.Errorf("--triage-file is only supported with comments triage or release")
		}
		if strings.TrimSpace(options.ResultFile) != "" || strings.TrimSpace(options.TriageDecision) != "" || strings.TrimSpace(options.TriageSummary) != "" || strings.TrimSpace(options.TriageNext) != "" || strings.TrimSpace(options.Body) != "" || strings.TrimSpace(options.BodyFile) != "" {
			return options, nil, errors.New("--triage-file cannot be combined with --result-file, --decision, --summary, --next-action, --body, or --body-file")
		}
		input, err := readCommentTriageFile(options.TriageFile)
		if err != nil {
			return options, nil, fmt.Errorf("read --triage-file: %w", err)
		}
		options.TriageDecision = input.Decision
		options.TriageSummary = input.Summary
		options.TriageNext = input.NextAction
		options.Body = input.Details
	}
	if strings.TrimSpace(options.ResultFile) != "" {
		if command != "done" && command != "dismiss" {
			return options, nil, fmt.Errorf("--result-file is only supported with comments done or dismiss")
		}
		if strings.TrimSpace(options.Body) != "" || strings.TrimSpace(options.BodyFile) != "" || strings.TrimSpace(options.TriageFile) != "" {
			return options, nil, errors.New("--result-file cannot be combined with --body, --body-file, or --triage-file")
		}
		result, err := readCommentResultFile(options.ResultFile, command)
		if err != nil {
			return options, nil, fmt.Errorf("read --result-file: %w", err)
		}
		options.Result = &result
		options.Body = result.Body
	}
	if strings.TrimSpace(options.Body) != "" && strings.TrimSpace(options.BodyFile) != "" {
		return options, nil, errors.New("--body and --body-file are mutually exclusive")
	}
	if strings.TrimSpace(options.BodyFile) != "" {
		body, err := readCommentBodyFile(options.BodyFile)
		if err != nil {
			return options, nil, fmt.Errorf("read --body-file: %w", err)
		}
		options.Body = string(body)
	}
	if options.ActivityLimit < 0 {
		return options, nil, errors.New("--activity-limit must be greater than or equal to 0")
	}
	if options.CommentLimit < 0 {
		return options, nil, errors.New("--comment-limit must be greater than or equal to 0")
	}
	if options.Full {
		options.WithContext = true
		options.WithDiff = true
		options.WithActivities = true
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

func parseCommentsSchemaFlags(args []string) (commentsCommandOptions, []string, error) {
	options := commentsCommandOptions{JSON: true}
	flags := flag.NewFlagSet("vivi comments schema", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.URL, "url", "", "Vivi server URL")
	flags.BoolVar(&options.JSON, "json", true, "write JSON output")
	flagArgs, positional := splitCommentsFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return options, nil, err
	}
	options.URL = strings.TrimRight(options.URL, "/")
	if options.URL != "" {
		if _, err := url.ParseRequestURI(options.URL); err != nil {
			return options, nil, fmt.Errorf("invalid --url: %w", err)
		}
	}
	return options, append(positional, flags.Args()...), nil
}

func parseCommentsProtocolFlags(args []string) (commentsCommandOptions, []string, error) {
	options := commentsCommandOptions{JSON: true}
	flags := flag.NewFlagSet("vivi comments protocol", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.URL, "url", "", "Vivi server URL")
	flags.BoolVar(&options.JSON, "json", true, "write JSON output")
	flags.StringVar(&options.ReceiptLog, "receipt-log", "", "path to append successful write receipts as JSONL")
	flagArgs, positional := splitCommentsFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return options, nil, err
	}
	options.URL = strings.TrimRight(options.URL, "/")
	if options.URL != "" {
		if _, err := url.ParseRequestURI(options.URL); err != nil {
			return options, nil, fmt.Errorf("invalid --url: %w", err)
		}
	}
	if strings.TrimSpace(options.ReceiptLog) == "-" {
		return options, nil, errors.New("protocol --receipt-log requires a path, not -")
	}
	return options, append(positional, flags.Args()...), nil
}

func readCommentBodyFile(path string) ([]byte, error) {
	if strings.TrimSpace(path) == "-" {
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(path)
}

func readCommentTriageFile(path string) (commentTriageFileInput, error) {
	raw, err := readCommentBodyFile(path)
	if err != nil {
		return commentTriageFileInput{}, err
	}
	var input commentTriageFileInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return commentTriageFileInput{}, err
	}
	return input, nil
}

func readCommentResultFile(path string, command string) (commentResultOutput, error) {
	raw, err := readCommentBodyFile(path)
	if err != nil {
		return commentResultOutput{}, err
	}
	var input commentResultFileInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return commentResultOutput{}, err
	}
	return commentResultPayload(command, input)
}

func readCommentWriteReceiptFile(path string) (commentWriteReceipt, error) {
	raw, err := readCommentBodyFile(path)
	if err != nil {
		return commentWriteReceipt{}, err
	}
	var envelope struct {
		Receipt *commentWriteReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil && envelope.Receipt != nil {
		return *envelope.Receipt, nil
	}
	var receipt commentWriteReceipt
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return commentWriteReceipt{}, err
	}
	return receipt, nil
}

func readCommentWriteReceiptLog(path string) ([]commentWriteReceipt, error) {
	raw, err := readCommentBodyFile(path)
	if err != nil {
		return nil, err
	}
	receipts := []commentWriteReceipt{}
	for index, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var receipt commentWriteReceipt
		if err := json.Unmarshal([]byte(line), &receipt); err != nil {
			return nil, fmt.Errorf("line %d: %w", index+1, err)
		}
		receipts = append(receipts, receipt)
	}
	return receipts, nil
}

func appendCommentWriteReceiptLog(path string, receipt commentWriteReceipt) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	if path == "-" {
		return errors.New("--receipt-log cannot be -")
	}
	dir := filepath.Dir(path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(receipt)
	if err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func commentsSchema(stdout io.Writer, _ commentsCommandOptions, name string) error {
	schema, ok := commentSchemaByName(name)
	if !ok {
		return fmt.Errorf("unknown comments schema %q", name)
	}
	return writeJSON(stdout, schema)
}

func commentsProtocol(stdout io.Writer, options commentsCommandOptions) error {
	return writeJSON(stdout, commentsProtocolPayload(options))
}

func commentsProtocolPayload(options commentsCommandOptions) map[string]any {
	actor := "<actor-id>"
	thread := "<thread-id>"
	receiptLog := strings.TrimSpace(options.ReceiptLog)
	serverURL := strings.TrimSpace(options.URL)
	return map[string]any{
		"name":                  "vivi-comments-agent-protocol",
		"version":               commentsStreamSchemaVersion,
		"manifestSchema":        "commentProtocolManifest",
		"manifestSchemaCommand": commentSchemaCommandArgs("commentProtocolManifest"),
		"description":           "Machine-readable startup manifest for coding-agent adapters that consume GUI comment feedback through the Vivi CLI.",
		"defaultURL":            defaultCommentsURL,
		"schemaCommand":         []string{"comments", "schema", "all", "--json"},
		"receiptLedger":         commentProtocolReceiptLedger(receiptLog),
		"principles": []string{
			"Prefer suggestedCommands emitted by runtime events over hard-coded command recipes.",
			"Recover owned live claims with comments mine --full before claiming new GUI feedback after an adapter restart.",
			"Use comments work --wait --loop --idle-events as the resident owned-work intake for background agents.",
			"Run comments check immediately before guarded writes when ownership may be stale.",
			"Use structured stdin schemas for triage and terminal results.",
			"Keep a local write receipt ledger when the adapter needs restart-safe reconciliation of agent comments.",
		},
		"startup": []map[string]any{
			{
				"intent":  "load_protocol_manifest",
				"command": "comments protocol",
				"args":    withRuntimeArgs([]string{"comments", "protocol", "--json"}, serverURL, receiptLog),
				"reason":  "Discover the preferred agent loop, schema commands, event names, and write preflight contract.",
			},
			{
				"intent":  "cache_runtime_schemas",
				"command": "comments schema",
				"args":    withURLArg([]string{"comments", "schema", "all", "--json"}, serverURL),
				"reason":  "Cache stdin and stream JSON Schemas without contacting a Vivi server.",
			},
			{
				"intent":  "check_server_readiness",
				"command": "comments doctor",
				"args":    withRuntimeArgs([]string{"comments", "doctor", "--actor", actor, "--client-event-id", "<client-event-id>", "--json"}, serverURL, receiptLog),
				"reason":  "Verify the selected Vivi server is reachable and discover the current open-work readiness before entering a resident loop.",
			},
		},
		"recovery": []map[string]any{
			{
				"intent":  "recover_owned_live_claims",
				"command": "comments mine",
				"args":    withURLArg([]string{"comments", "mine", "--actor", actor, "--full", "--json"}, serverURL),
				"reason":  "After an adapter restart, inspect live claims already owned by this actor before claiming new GUI feedback.",
			},
		},
		"preferredLoop": map[string]any{
			"intent":  "resident_owned_work_loop",
			"command": "comments work",
			"args":    withRuntimeArgs([]string{"comments", "work", "--actor", actor, "--client-event-id", "<client-event-id>", "--wait", "--loop", "--idle-events", "--full", "--json"}, serverURL, receiptLog),
			"events":  []string{"commentWorkClaimedEvent", "commentActivityBatchEvent", "commentWorkIdleEvent"},
			"reason":  "Claim GUI feedback as owned work, keep the lease alive while working, observe follow-up activity, and continue to the next thread after terminal status.",
		},
		"intakeAlternatives": []map[string]any{
			{
				"intent":  "passive_open_worklist",
				"command": "comments watch",
				"args":    withRuntimeArgs([]string{"comments", "watch", "--actor", actor, "--client-event-id", "<client-event-id>", "--full", "--json"}, serverURL, receiptLog),
				"events":  []string{"commentOpenWorklistEvent"},
				"reason":  "Observe GUI-published open threads without claiming them; follow the event's claim_next_open_thread suggestion to take ownership.",
			},
			{
				"intent":  "blocking_single_claim",
				"command": "comments claim",
				"args":    withRuntimeArgs([]string{"comments", "claim", "--actor", actor, "--client-event-id", "<client-event-id>", "--wait", "--full", "--json"}, serverURL, receiptLog),
				"reason":  "Wait for one claimable thread and return a single rich work item.",
			},
		},
		"threadCompanions": []map[string]any{
			{
				"intent":  "follow_active_thread",
				"command": "comments follow",
				"args":    withRuntimeArgs([]string{"comments", "follow", thread, "--actor", actor, "--full", "--json"}, serverURL, receiptLog),
				"events":  []string{"commentActivityBatchEvent"},
				"reason":  "Watch human follow-up, own replies, status changes, and releases for a thread already in progress.",
			},
			{
				"intent":  "preflight_guarded_write",
				"command": "comments check",
				"args":    withRuntimeArgs([]string{"comments", "check", thread, "--actor", actor, "--full", "--json"}, serverURL, receiptLog),
				"reason":  "Branch on live claim ownership before using --require-claim writes; prefer write.suggestedCommands when present.",
			},
		},
		"structuredWrites": []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("acknowledge_feedback", "comments triage", withRuntimeArgs([]string{"comments", "triage", thread, "--actor", actor, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a non-terminal structured acknowledgement, clarification request, or blocked status.", "<client-event-id>"),
			suggestedCommentsCommandWithClientEventID("handoff_after_blocked_or_needs_info", "comments release", withRuntimeArgs([]string{"comments", "release", thread, "--actor", actor, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured blocked or needs-info handoff comment, then release the live claim for another attempt.", "<client-event-id>"),
			suggestedCommentsCommandWithClientEventID("complete_after_verification", "comments done", withRuntimeArgs([]string{"comments", "done", thread, "--actor", actor, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Resolve the thread with structured verification after the fix is complete.", "<client-event-id>"),
			suggestedCommentsCommandWithClientEventID("archive_after_decision", "comments dismiss", withRuntimeArgs([]string{"comments", "dismiss", thread, "--actor", actor, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Archive the thread with a structured explanation when the feedback is intentionally not fixed.", "<client-event-id>"),
		},
		"eventSchemas": map[string]any{
			"commentOpenWorklistEvent":  commentSchemaCommandArgs("commentOpenWorklistEvent"),
			"commentWorkClaimedEvent":   commentSchemaCommandArgs("commentWorkClaimedEvent"),
			"commentWorkIdleEvent":      commentSchemaCommandArgs("commentWorkIdleEvent"),
			"commentActivityBatchEvent": commentSchemaCommandArgs("commentActivityBatchEvent"),
		},
		"outputSchemas": map[string]any{
			"commentClaimOutput":                    commentSchemaCommandArgs("commentClaimOutput"),
			"commentInboxOutput":                    commentSchemaCommandArgs("commentInboxOutput"),
			"commentMineOutput":                     commentSchemaCommandArgs("commentMineOutput"),
			"commentBatchOutput":                    commentSchemaCommandArgs("commentBatchOutput"),
			"commentCheckOutput":                    commentSchemaCommandArgs("commentCheckOutput"),
			"commentTriageOutput":                   commentSchemaCommandArgs("commentTriageOutput"),
			"commentReleaseOutput":                  commentSchemaCommandArgs("commentReleaseOutput"),
			"commentResultOutput":                   commentSchemaCommandArgs("commentResultOutput"),
			"commentWriteReceiptVerification":       commentSchemaCommandArgs("commentWriteReceiptVerification"),
			"commentWriteReceiptLedgerVerification": commentSchemaCommandArgs("commentWriteReceiptLedgerVerification"),
		},
		"componentSchemas": map[string]any{
			"commentSuggestedCommand": commentSchemaCommandArgs("commentSuggestedCommand"),
			"commentWriteReceipt":     commentSchemaCommandArgs("commentWriteReceipt"),
		},
		"errorSchemas": map[string]any{
			"commentErrorEvent": commentSchemaCommandArgs("commentErrorEvent"),
		},
		"startupSchemas": map[string]any{
			"commentDoctorOutput": commentSchemaCommandArgs("commentDoctorOutput"),
		},
		"errorPolicy": map[string]any{
			"transport":     "stdout_json_on_nonzero_exit",
			"schema":        "commentErrorEvent",
			"schemaCommand": commentSchemaCommandArgs("commentErrorEvent"),
			"branchOn":      []string{"error.code", "error.suggestedCommands", "error.recoverable"},
			"codes": []map[string]any{
				{
					"code":        "server_unreachable",
					"recoverable": true,
					"action":      "Start Vivi or correct --url/VIVI_URL, then rerun comments doctor before entering a resident loop.",
				},
				{
					"code":        "invalid_arguments",
					"recoverable": false,
					"action":      "Treat as an adapter bug or stale protocol cache; refresh comments protocol/schema before retrying.",
				},
				{
					"code":        "no_live_claim",
					"recoverable": true,
					"action":      "Run the claim/check suggestedCommands, then retry the guarded write only if the same actor owns a live claim.",
				},
				{
					"code":        "claimed_by_other_actor",
					"recoverable": true,
					"action":      "Inspect or follow the thread and wait for release, terminal status, or new human feedback before retrying.",
				},
				{
					"code":        "not_found",
					"recoverable": false,
					"action":      "Drop the stale thread id and refresh the open worklist or inbox before continuing.",
				},
				{
					"code":        "upstream_graphql_error",
					"recoverable": true,
					"action":      "Retry with the same clientEventId only when repeating the same logical operation.",
				},
				{
					"code":        "comments_command_failed",
					"recoverable": true,
					"action":      "Inspect the message and suggestedCommands; prefer a fresh check before repeating writes.",
				},
			},
		},
		"stdinSchemas": map[string]any{
			"commentTriageFileInput": commentSchemaCommandArgs("commentTriageFileInput"),
			"commentResultFileInput": commentSchemaCommandArgs("commentResultFileInput"),
		},
		"adapterNotes": []string{
			"Command args are subcommand argv beginning with comments; prefix the Vivi executable selected by the host adapter.",
			"Runtime events and write preflight responses may include more specific suggestedCommands than this startup manifest.",
			"Replace <client-event-id> with a stable id for a single logical attempt; reuse it only for retries of that attempt.",
			"Structured stdin examples are available on each suggested command when stdinSchema is present.",
		},
	}
}

func commentProtocolReceiptLedger(receiptLog string) map[string]any {
	ledger := map[string]any{
		"enabled":                   receiptLog != "",
		"path":                      receiptLog,
		"verificationCommand":       []string{"comments", "verify-receipts", "--receipt-log", receiptLog, "--json"},
		"verificationSchema":        "commentWriteReceiptLedgerVerification",
		"verificationSchemaCommand": commentSchemaCommandArgs("commentWriteReceiptLedgerVerification"),
		"receiptSchema":             "commentWriteReceipt",
		"receiptSchemaCommand":      commentSchemaCommandArgs("commentWriteReceipt"),
	}
	if receiptLog == "" {
		ledger["verificationCommand"] = []string{"comments", "verify-receipts", "--receipt-log", "<receipt-log-path>", "--json"}
	}
	return ledger
}

func addCommentEventSchemaMetadata(payload map[string]any, name string) {
	payload["eventSchema"] = name
	payload["eventSchemaCommand"] = commentSchemaCommandArgs(name)
}

func commentSchemaCommandArgs(name string) []string {
	return []string{"comments", "schema", name, "--json"}
}

func commentSchemaByName(name string) (commentSchemaOutput, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "protocol", "manifest", "protocol-manifest", "commentprotocolmanifest":
		return commentProtocolManifestSchema(), true
	case "doctor", "doctor-output", "commentdoctoroutput":
		return commentDoctorOutputSchema(), true
	case "triage", "triage-file", "commenttriagefileinput":
		return commentTriageFileSchema(), true
	case "result", "result-file", "commentresultfileinput":
		return commentResultFileSchema(), true
	case "claim", "commentclaimoutput":
		return commentClaimOutputSchema(), true
	case "inbox", "commentinboxoutput":
		return commentInboxOutputSchema(), true
	case "mine", "commentmineoutput":
		return commentMineOutputSchema(), true
	case "batch", "commentbatchoutput":
		return commentBatchOutputSchema(), true
	case "check", "commentcheckout", "write-preflight", "writepreflight", "commentwritepreflight":
		return commentCheckOutputSchema(), true
	case "triage-output", "triageoutput", "commenttriageoutput":
		return commentTriageWriteOutputSchema(), true
	case "release-output", "releaseoutput", "commentreleaseoutput":
		return commentReleaseWriteOutputSchema(), true
	case "result-output", "resultoutput", "commentresultoutput":
		return commentResultWriteOutputSchema(), true
	case "suggested-command", "suggestedcommand", "commentsuggestedcommand":
		return commentSuggestedCommandOutputSchema(), true
	case "write-receipt", "writereceipt", "commentwritereceipt":
		return commentWriteReceiptOutputSchema(), true
	case "receipt-verification", "receiptverification", "write-receipt-verification", "writereceiptverification", "commentwritereceiptverification":
		return commentWriteReceiptVerificationOutputSchema(), true
	case "receipt-ledger-verification", "receiptledgerverification", "write-receipt-ledger-verification", "writereceiptledgerverification", "commentwritereceiptledgerverification":
		return commentWriteReceiptLedgerVerificationOutputSchema(), true
	case "activity-batch", "activitybatch", "commentactivitybatchevent", "commentthreadactivitybatchevent":
		return commentActivityBatchEventSchema(), true
	case "work-claimed", "workclaimed", "commentworkclaimedevent":
		return commentWorkClaimedEventSchema(), true
	case "work-idle", "workidle", "commentworkidleevent":
		return commentWorkIdleEventSchema(), true
	case "open-worklist", "openworklist", "watch", "commentopenworklistevent":
		return commentOpenWorklistEventSchema(), true
	case "error", "commenterror", "commenterrorevent":
		return commentErrorEventSchema(), true
	case "all":
		return commentSchemaOutput{
			Name: "all",
			Schema: map[string]any{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"type":    "object",
			},
			Schemas: []commentSchemaOutput{
				commentProtocolManifestSchema(),
				commentDoctorOutputSchema(),
				commentTriageFileSchema(),
				commentResultFileSchema(),
				commentClaimOutputSchema(),
				commentInboxOutputSchema(),
				commentMineOutputSchema(),
				commentBatchOutputSchema(),
				commentCheckOutputSchema(),
				commentTriageWriteOutputSchema(),
				commentReleaseWriteOutputSchema(),
				commentResultWriteOutputSchema(),
				commentSuggestedCommandOutputSchema(),
				commentWriteReceiptOutputSchema(),
				commentWriteReceiptVerificationOutputSchema(),
				commentWriteReceiptLedgerVerificationOutputSchema(),
				commentActivityBatchEventSchema(),
				commentWorkClaimedEventSchema(),
				commentWorkIdleEventSchema(),
				commentOpenWorklistEventSchema(),
				commentErrorEventSchema(),
			},
		}, true
	default:
		return commentSchemaOutput{}, false
	}
}

func commentProtocolManifestSchema() commentSchemaOutput {
	commandRecipe := map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"intent", "command", "args", "reason"},
		"properties": map[string]any{
			"intent":  map[string]any{"type": "string"},
			"command": map[string]any{"type": "string"},
			"args":    arraySchema(map[string]any{"type": "string"}),
			"events":  arraySchema(map[string]any{"type": "string"}),
			"reason":  map[string]any{"type": "string"},
		},
	}
	schemaCommandMap := map[string]any{
		"type":                 "object",
		"additionalProperties": arraySchema(map[string]any{"type": "string"}),
	}
	return commentSchemaOutput{
		Name:        "commentProtocolManifest",
		Description: "Machine-readable startup manifest emitted by comments protocol --json for coding-agent adapters.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentProtocolManifest",
			"title":                "commentProtocolManifest",
			"type":                 "object",
			"additionalProperties": true,
			"required": []string{
				"name",
				"version",
				"manifestSchema",
				"manifestSchemaCommand",
				"schemaCommand",
				"receiptLedger",
				"startup",
				"recovery",
				"preferredLoop",
				"intakeAlternatives",
				"threadCompanions",
				"structuredWrites",
				"eventSchemas",
				"outputSchemas",
				"componentSchemas",
				"errorSchemas",
				"startupSchemas",
				"errorPolicy",
				"stdinSchemas",
				"adapterNotes",
			},
			"properties": map[string]any{
				"name":                  map[string]any{"type": "string", "const": "vivi-comments-agent-protocol"},
				"version":               map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"manifestSchema":        map[string]any{"type": "string", "const": "commentProtocolManifest"},
				"manifestSchemaCommand": arraySchema(map[string]any{"type": "string"}),
				"description":           map[string]any{"type": "string"},
				"defaultURL":            map[string]any{"type": "string"},
				"schemaCommand":         arraySchema(map[string]any{"type": "string"}),
				"receiptLedger": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"enabled", "path", "verificationCommand", "verificationSchema", "verificationSchemaCommand", "receiptSchema", "receiptSchemaCommand"},
					"properties": map[string]any{
						"enabled":                   map[string]any{"type": "boolean"},
						"path":                      map[string]any{"type": "string"},
						"verificationCommand":       arraySchema(map[string]any{"type": "string"}),
						"verificationSchema":        map[string]any{"type": "string", "const": "commentWriteReceiptLedgerVerification"},
						"verificationSchemaCommand": arraySchema(map[string]any{"type": "string"}),
						"receiptSchema":             map[string]any{"type": "string", "const": "commentWriteReceipt"},
						"receiptSchemaCommand":      arraySchema(map[string]any{"type": "string"}),
					},
				},
				"principles":         arraySchema(map[string]any{"type": "string"}),
				"startup":            arraySchema(commandRecipe),
				"recovery":           arraySchema(commandRecipe),
				"preferredLoop":      commandRecipe,
				"intakeAlternatives": arraySchema(commandRecipe),
				"threadCompanions":   arraySchema(commandRecipe),
				"structuredWrites":   arraySchema(commentSuggestedCommandSchema()),
				"eventSchemas":       schemaCommandMap,
				"outputSchemas":      schemaCommandMap,
				"componentSchemas":   schemaCommandMap,
				"errorSchemas":       schemaCommandMap,
				"startupSchemas":     schemaCommandMap,
				"stdinSchemas":       schemaCommandMap,
				"errorPolicy": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"transport", "schema", "schemaCommand", "branchOn", "codes"},
					"properties": map[string]any{
						"transport":     map[string]any{"type": "string", "const": "stdout_json_on_nonzero_exit"},
						"schema":        map[string]any{"type": "string", "const": "commentErrorEvent"},
						"schemaCommand": arraySchema(map[string]any{"type": "string"}),
						"branchOn":      arraySchema(map[string]any{"type": "string"}),
						"codes": arraySchema(map[string]any{
							"type":                 "object",
							"additionalProperties": true,
							"required":             []string{"code", "recoverable", "action"},
							"properties": map[string]any{
								"code": map[string]any{
									"type": "string",
									"enum": []string{"server_unreachable", "invalid_arguments", "no_live_claim", "claimed_by_other_actor", "not_found", "upstream_graphql_error", "comments_command_failed"},
								},
								"recoverable": map[string]any{"type": "boolean"},
								"action":      map[string]any{"type": "string"},
							},
						}),
					},
				},
				"adapterNotes": arraySchema(map[string]any{"type": "string"}),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments protocol --json"},
		},
		Example: commentsProtocolPayload(commentsCommandOptions{}),
	}
}

func commentDoctorOutputSchema() commentSchemaOutput {
	exampleOptions := commentsCommandOptions{
		URL:           defaultCommentsURL,
		ActorID:       "codex:agent",
		ActorKind:     "codex",
		ClientEventID: "doctor-start-1",
	}
	return commentSchemaOutput{
		Name:        "commentDoctorOutput",
		Description: "Online startup readiness payload emitted by comments doctor --json before an agent enters a resident loop.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentDoctorOutput",
			"title":                "commentDoctorOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"ok", "url", "schemaVersion", "protocol", "server", "recommendedAction", "suggestedCommands"},
			"properties": map[string]any{
				"ok":            map[string]any{"type": "boolean", "const": true},
				"url":           map[string]any{"type": "string"},
				"schemaVersion": map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"protocol": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"name", "version", "manifestSchema", "manifestSchemaCommand", "schemaCommand"},
					"properties": map[string]any{
						"name":                  map[string]any{"type": "string", "const": "vivi-comments-agent-protocol"},
						"version":               map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
						"manifestSchema":        map[string]any{"type": "string", "const": "commentProtocolManifest"},
						"manifestSchemaCommand": arraySchema(map[string]any{"type": "string"}),
						"schemaCommand":         arraySchema(map[string]any{"type": "string"}),
					},
				},
				"server": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"reachable", "openThreadCount", "cursor"},
					"properties": map[string]any{
						"reachable":       map[string]any{"type": "boolean", "const": true},
						"openThreadCount": map[string]any{"type": "integer", "minimum": 0},
						"cursor":          map[string]any{"type": "string"},
					},
				},
				"actor":             commentActorSchema(),
				"receiptLedger":     commentWriteReceiptLedgerVerificationOutputSchema().Schema,
				"recommendedAction": map[string]any{"type": "string", "enum": []string{"configure_actor", "reconcile_receipt_ledger", "enter_resident_work_loop", "wait_for_gui_feedback"}},
				"suggestedCommands": arraySchema(commentSuggestedCommandSchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments doctor --json"},
		},
		Example: commentsDoctorPayload(exampleOptions, 1, "open:..."),
	}
}

func commentInboxOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentInboxOutput",
		Description: "Agent routing snapshot emitted by comments inbox --json without creating read receipts, claims, or comments.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentInboxOutput",
			"title":                "commentInboxOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"schemaVersion", "schemaCommand", "actor", "cursor", "count", "summary", "mine", "unclaimed", "claimedByOthers", "sourceUnavailable"},
			"properties": map[string]any{
				"schemaVersion":     map[string]any{"type": "integer", "minimum": 1},
				"schemaCommand":     arraySchema(map[string]any{"type": "string"}),
				"actor":             commentActorSchema(),
				"cursor":            map[string]any{"type": "string"},
				"count":             map[string]any{"type": "integer", "minimum": 0},
				"summary":           commentRoutingSummarySchema(),
				"mine":              commentInboxGroupSchema(),
				"unclaimed":         commentInboxGroupSchema(),
				"claimedByOthers":   commentInboxGroupSchema(),
				"sourceUnavailable": commentInboxGroupSchema(),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments inbox --json"},
			{Command: "comments inbox --full --json"},
		},
		Example: commentInboxOutputExample(),
	}
}

func commentClaimOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentClaimOutput",
		Description: "Lease-aware intake payload emitted by comments claim and comments claim --wait --json for background agents.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentClaimOutput",
			"title":                "commentClaimOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"thread", "claim", "cursor", "count", "remaining", "summary"},
			"properties": map[string]any{
				"thread":     nullableSchema(commentThreadSchema()),
				"claim":      nullableSchema(commentActivitySchema()),
				"cursor":     map[string]any{"type": "string"},
				"count":      map[string]any{"type": "integer", "minimum": 0},
				"remaining":  map[string]any{"type": "integer", "minimum": 0},
				"summary":    commentClaimSummarySchema(),
				"file":       map[string]any{"type": "object"},
				"source":     sourceContextSchema(),
				"diff":       textDiffSchema(),
				"activities": arraySchema(commentActivitySchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments claim --json"},
			{Command: "comments claim --full --json"},
			{Command: "comments claim --wait --json"},
			{Command: "comments claim --wait --full --json"},
		},
		Example: commentClaimOutputExample(),
	}
}

func commentMineOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentMineOutput",
		Description: "Agent restart-recovery snapshot emitted by comments mine --json without creating read receipts, claims, or comments.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentMineOutput",
			"title":                "commentMineOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"actor", "cursor", "count", "summary", "threads", "claims"},
			"properties": map[string]any{
				"actor":   commentActorSchema(),
				"cursor":  map[string]any{"type": "string"},
				"count":   map[string]any{"type": "integer", "minimum": 0},
				"summary": commentRoutingSummarySchema(),
				"threads": arraySchema(commentThreadSchema()),
				"claims":  arraySchema(commentActivitySchema()),
				"items":   arraySchema(commentWorkItemSchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments mine --json"},
			{Command: "comments mine --full --json"},
		},
		Example: commentMineOutputExample(),
	}
}

func commentBatchOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentBatchOutput",
		Description: "Published review-batch routing snapshot emitted by comments batch <review-batch-id> --json.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentBatchOutput",
			"title":                "commentBatchOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"reviewBatchId", "actor", "cursor", "count", "summary", "threads", "open"},
			"properties": map[string]any{
				"reviewBatchId": map[string]any{"type": "string"},
				"actor":         commentActorSchema(),
				"cursor":        map[string]any{"type": "string"},
				"count":         map[string]any{"type": "integer", "minimum": 0},
				"summary":       commentBatchProgressSummarySchema(),
				"threads":       arraySchema(commentThreadSchema()),
				"open": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"count", "summary", "mine", "unclaimed", "claimedByOthers", "sourceUnavailable"},
					"properties": map[string]any{
						"count":             map[string]any{"type": "integer", "minimum": 0},
						"summary":           commentRoutingSummarySchema(),
						"mine":              commentInboxGroupSchema(),
						"unclaimed":         commentInboxGroupSchema(),
						"claimedByOthers":   commentInboxGroupSchema(),
						"sourceUnavailable": commentInboxGroupSchema(),
					},
				},
				"items": arraySchema(commentWorkItemSchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments batch <review-batch-id> --json"},
			{Command: "comments batch <review-batch-id> --full --json"},
		},
		Example: commentBatchOutputExample(),
	}
}

func commentCheckOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentCheckOutput",
		Description: "Guarded-write preflight emitted by comments check <thread-id> --json so agents can branch on claim ownership before writing.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentCheckOutput",
			"title":                "commentCheckOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"thread", "write"},
			"properties": map[string]any{
				"thread":     commentThreadSchema(),
				"liveClaim":  nullableSchema(commentActivitySchema()),
				"write":      commentWritePreflightSchema(),
				"file":       map[string]any{"type": "object"},
				"source":     sourceContextSchema(),
				"diff":       textDiffSchema(),
				"activities": arraySchema(commentActivitySchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments check <thread-id> --json"},
			{Command: "comments check <thread-id> --full --json"},
		},
		Example: commentCheckOutputExample(),
	}
}

func commentTriageWriteOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentTriageOutput",
		Description: "Structured acknowledgement output emitted by comments triage <thread-id> --json after posting or reusing the agent triage comment.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentTriageOutput",
			"title":                "commentTriageOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"triage", "comment", "thread", "receipt"},
			"properties": map[string]any{
				"triage":  commentTriagePayloadSchema(),
				"comment": commentSchema(),
				"thread":  commentThreadSchema(),
				"receipt": commentWriteReceiptSchema(),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments triage <thread-id> --json"},
			{Command: "comments triage <thread-id> --triage-file <path|-> --json"},
		},
		Example: commentTriageOutputExample(),
	}
}

func commentReleaseWriteOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentReleaseOutput",
		Description: "Structured handoff output emitted by comments release <thread-id> --json after releasing the agent's live claim, optionally with a triage handoff comment.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentReleaseOutput",
			"title":                "commentReleaseOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"thread", "release", "receipt"},
			"properties": map[string]any{
				"triage":     commentTriagePayloadSchema(),
				"comment":    commentSchema(),
				"thread":     commentThreadSchema(),
				"release":    commentActivitySchema(),
				"receipt":    commentWriteReceiptSchema(),
				"activities": arraySchema(commentActivitySchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments release <thread-id> --json"},
			{Command: "comments release <thread-id> --body-file <path|-> --json"},
			{Command: "comments release <thread-id> --triage-file <path|-> --json"},
			{Command: "comments release <thread-id> --with-activities --json"},
		},
		Example: commentReleaseOutputExample(),
	}
}

func commentResultWriteOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentResultOutput",
		Description: "Structured terminal reply output emitted by comments done/dismiss <thread-id> --json after posting or reusing the agent completion or archival comment.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentResultOutput",
			"title":                "commentResultOutput",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"comment", "thread", "receipt"},
			"properties": map[string]any{
				"result":  commentResultPayloadSchema(),
				"comment": commentSchema(),
				"thread":  commentThreadSchema(),
				"receipt": commentWriteReceiptSchema(),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments done <thread-id> --json"},
			{Command: "comments done <thread-id> --result-file <path|-> --json"},
			{Command: "comments dismiss <thread-id> --json"},
			{Command: "comments dismiss <thread-id> --result-file <path|-> --json"},
		},
		Example: commentResultOutputExample(),
	}
}

func commentSuggestedCommandOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentSuggestedCommand",
		Description: "Reusable command recipe object embedded in comments protocol, doctor, inbox, batch, stream summaries, write preflights, and JSON error envelopes.",
		Schema: map[string]any{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"$id":     "vivi://comments/schemas/commentSuggestedCommand",
			"title":   "commentSuggestedCommand",
			"type":    "object",
			"allOf":   []map[string]any{commentSuggestedCommandSchema()},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments protocol --json", Flag: "structuredWrites"},
			{Command: "comments doctor --json", Flag: "suggestedCommands"},
			{Command: "comments inbox --json", Flag: "summary.suggestedCommands"},
			{Command: "comments batch <review-batch-id> --json", Flag: "open.summary.suggestedCommands"},
			{Command: "comments work --json", Flag: "summary.suggestedCommands"},
			{Command: "comments follow <thread-id> --json", Flag: "summary.suggestedCommands"},
			{Command: "vivi comments <command> --json", Flag: "error.suggestedCommands"},
		},
		Example: map[string]any{
			"intent":        "complete_after_verification",
			"command":       "comments done",
			"args":          []string{"comments", "done", "comment-thread-1", "--actor", "codex:agent", "--result-file", "-", "--require-claim", "--client-event-id", "activity:comment-thread-1:done:activity-1", "--json"},
			"clientEventId": "activity:comment-thread-1:done:activity-1",
			"stdinRequired": true,
			"stdinSchema":   "commentResultFileInput",
			"stdinSchemaCommand": []string{
				"comments",
				"schema",
				"commentResultFileInput",
				"--json",
			},
			"stdinExample": commentResultFileSchema().Example,
			"reason":       "Resolve the thread with structured verification after the fix is complete.",
		},
	}
}

func commentWriteReceiptOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentWriteReceipt",
		Description: "Reusable write receipt object returned by agent write commands so adapters can correlate a suggested command's clientEventId with the comment, status, and activity effects it produced.",
		Schema: map[string]any{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"$id":     "vivi://comments/schemas/commentWriteReceipt",
			"title":   "commentWriteReceipt",
			"type":    "object",
			"allOf":   []map[string]any{commentWriteReceiptSchema()},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments reply --json", Flag: "receipt"},
			{Command: "comments triage --json", Flag: "receipt"},
			{Command: "comments release --json", Flag: "receipt"},
			{Command: "comments done --json", Flag: "receipt"},
			{Command: "comments dismiss --json", Flag: "receipt"},
		},
		Example: map[string]any{
			"schemaVersion":             commentsStreamSchemaVersion,
			"receiptSchema":             "commentWriteReceipt",
			"receiptSchemaCommand":      commentSchemaCommandArgs("commentWriteReceipt"),
			"verificationCommand":       []string{"comments", "verify-receipt", "--receipt-file", "-", "--url", "<server-url>", "--json"},
			"verificationSchema":        "commentWriteReceiptVerification",
			"verificationSchemaCommand": commentSchemaCommandArgs("commentWriteReceiptVerification"),
			"command":                   "comments done",
			"threadId":                  "comment-thread-1",
			"actorId":                   "codex:agent",
			"clientEventId":             "activity:comment-thread-1:done:activity-1",
			"commentId":                 "comment-2",
			"status":                    "resolved",
			"effects": []map[string]any{
				{
					"id":            "activity-2",
					"type":          "comment_added",
					"commentId":     "comment-2",
					"clientEventId": "activity:comment-thread-1:done:activity-1",
					"createdAt":     "2026-01-01T00:00:00Z",
				},
				{
					"id":             "activity-3",
					"type":           "thread_status_changed",
					"previousStatus": "open",
					"status":         "resolved",
					"clientEventId":  "activity:comment-thread-1:done:activity-1",
					"createdAt":      "2026-01-01T00:00:01Z",
				},
			},
		},
	}
}

func commentWriteReceiptVerificationOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentWriteReceiptVerification",
		Description: "Output returned by comments verify-receipt so adapters can decide whether a saved write receipt still matches the server's thread, comment, status, and activity history.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentWriteReceiptVerification",
			"title":                "commentWriteReceiptVerification",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"schemaVersion", "ok", "receipt", "thread", "checks", "matchedEffects", "missingEffects"},
			"properties": map[string]any{
				"schemaVersion": map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"ok":            map[string]any{"type": "boolean"},
				"receipt":       commentWriteReceiptSchema(),
				"thread":        commentThreadSchema(),
				"checks": arraySchema(map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"name", "ok", "message"},
					"properties": map[string]any{
						"name":    map[string]any{"type": "string"},
						"ok":      map[string]any{"type": "boolean"},
						"message": map[string]any{"type": "string"},
					},
				}),
				"matchedEffects":    arraySchema(commentWriteReceiptEffectSchema()),
				"missingEffects":    arraySchema(commentWriteReceiptEffectSchema()),
				"suggestedCommands": arraySchema(commentSuggestedCommandSchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments verify-receipt --json", Flag: "receipt"},
		},
		Example: map[string]any{
			"schemaVersion": commentsStreamSchemaVersion,
			"ok":            true,
			"receipt":       commentWriteReceiptOutputSchema().Example,
			"thread":        commentSchemaExampleThread("comment-thread-1", "README.md", "resolved"),
			"checks": []map[string]any{
				{"name": "thread_exists", "ok": true, "message": "Thread exists and matches receipt.threadId."},
				{"name": "comment_exists", "ok": true, "message": "Returned comment exists on the thread."},
				{"name": "status_matches", "ok": true, "message": "Thread status matches receipt.status."},
				{"name": "effects_match", "ok": true, "message": "All receipt effects are present in thread activity history."},
			},
			"matchedEffects": commentWriteReceiptOutputSchema().Example["effects"],
			"missingEffects": []map[string]any{},
		},
	}
}

func commentWriteReceiptLedgerVerificationOutputSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentWriteReceiptLedgerVerification",
		Description: "Output returned by comments verify-receipts so adapters can verify every JSONL receipt in a durable agent write ledger before resuming work.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentWriteReceiptLedgerVerification",
			"title":                "commentWriteReceiptLedgerVerification",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"schemaVersion", "ok", "count", "verified", "failed", "verifications"},
			"properties": map[string]any{
				"schemaVersion":     map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"ok":                map[string]any{"type": "boolean"},
				"count":             map[string]any{"type": "integer", "minimum": 0},
				"verified":          map[string]any{"type": "integer", "minimum": 0},
				"failed":            map[string]any{"type": "integer", "minimum": 0},
				"verifications":     arraySchema(commentWriteReceiptVerificationOutputSchema().Schema),
				"suggestedCommands": arraySchema(commentSuggestedCommandSchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments verify-receipts --json", Flag: "receiptLog"},
		},
		Example: map[string]any{
			"schemaVersion": commentsStreamSchemaVersion,
			"ok":            true,
			"count":         1,
			"verified":      1,
			"failed":        0,
			"verifications": []map[string]any{
				commentWriteReceiptVerificationOutputSchema().Example,
			},
		},
	}
}

func commentInboxOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	claim := commentSchemaExampleClaim("claim-1", "codex:agent")
	return map[string]any{
		"schemaVersion": commentsStreamSchemaVersion,
		"schemaCommand": commentSchemaCommandArgs("commentInboxOutput"),
		"actor":         map[string]any{"id": "codex:agent", "kind": "codex"},
		"cursor":        "open:...",
		"count":         2,
		"summary": map[string]any{
			"requiresAttention":      true,
			"attentionReasons":       []string{"owned_live_claims"},
			"recommendedAction":      "resume_owned_work",
			"totalOpenThreadCount":   2,
			"openThreadCount":        2,
			"sourceUnavailableCount": 0,
			"mineCount":              1,
			"unclaimedCount":         1,
			"claimedByOthersCount":   0,
			"suggestedCommands": []map[string]any{
				{
					"intent":        "renew_owned_claim",
					"command":       "comments renew",
					"args":          []string{"comments", "renew", "comment-thread-1", "--actor", "codex:agent", "--client-event-id", "inbox:comment-thread-1:renew", "--json"},
					"clientEventId": "inbox:comment-thread-1:renew",
					"reason":        "Refresh the recovered live claim before continuing work after an adapter restart.",
				},
			},
		},
		"mine": map[string]any{
			"threads": []map[string]any{thread},
			"claims":  []map[string]any{claim},
			"count":   1,
			"items":   []map[string]any{{"thread": thread, "activities": []map[string]any{claim}}},
		},
		"unclaimed": map[string]any{
			"threads": []map[string]any{commentSchemaExampleThread("comment-thread-2", "README.md", "open")},
			"count":   1,
		},
		"claimedByOthers": map[string]any{
			"threads": []map[string]any{},
			"claims":  []map[string]any{},
			"count":   0,
		},
		"sourceUnavailable": map[string]any{
			"threads": []map[string]any{},
			"claims":  []map[string]any{},
			"count":   0,
		},
	}
}

func commentClaimOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	claim := commentSchemaExampleClaim("claim-1", "codex:agent")
	return map[string]any{
		"thread":    thread,
		"claim":     claim,
		"cursor":    "open:...",
		"count":     1,
		"remaining": 0,
		"summary": map[string]any{
			"kinds":                []string{"claimed_work", "human_comment", "own_claim"},
			"attentionReasons":     []string{"claimed_open_thread", "human_comment"},
			"requiresAttention":    true,
			"recommendedAction":    "start_work",
			"humanCommentCount":    1,
			"claimCount":           1,
			"ownActivityCount":     1,
			"ownClaimCount":        1,
			"externalCommentCount": 1,
			"suggestedCommands": []map[string]any{
				{
					"intent":             "acknowledge_initial_feedback",
					"command":            "comments triage",
					"args":               []string{"comments", "triage", "comment-thread-1", "--actor", "codex:agent", "--triage-file", "-", "--require-claim", "--client-event-id", "activity:comment-thread-1:triage:claim-1", "--json"},
					"clientEventId":      "activity:comment-thread-1:triage:claim-1",
					"stdinRequired":      true,
					"stdinSchema":        "commentTriageFileInput",
					"stdinSchemaCommand": []string{"comments", "schema", "commentTriageFileInput", "--json"},
					"stdinExample": map[string]any{
						"decision": "fixing",
						"summary":  "I have claimed this feedback and am starting the fix.",
					},
					"reason": "Post a structured acknowledgement that the agent has started the claimed work.",
				},
			},
		},
		"activities": []map[string]any{claim},
	}
}

func commentMineOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	claim := commentSchemaExampleClaim("claim-1", "codex:agent")
	return map[string]any{
		"actor":  map[string]any{"id": "codex:agent", "kind": "codex"},
		"cursor": "open:...",
		"count":  1,
		"summary": map[string]any{
			"requiresAttention":      true,
			"attentionReasons":       []string{"owned_live_claims"},
			"recommendedAction":      "resume_owned_work",
			"totalOpenThreadCount":   1,
			"openThreadCount":        1,
			"sourceUnavailableCount": 0,
			"mineCount":              1,
			"unclaimedCount":         0,
			"claimedByOthersCount":   0,
			"suggestedCommands": []map[string]any{
				{
					"intent":        "renew_owned_claim",
					"command":       "comments renew",
					"args":          []string{"comments", "renew", "comment-thread-1", "--actor", "codex:agent", "--client-event-id", "mine:comment-thread-1:renew", "--json"},
					"clientEventId": "mine:comment-thread-1:renew",
					"reason":        "Refresh the recovered live claim before continuing work after an adapter restart.",
				},
			},
		},
		"threads": []map[string]any{thread},
		"claims":  []map[string]any{claim},
		"items":   []map[string]any{{"thread": thread, "activities": []map[string]any{claim}}},
	}
}

func commentBatchOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	claim := commentSchemaExampleClaim("claim-1", "codex:agent")
	return map[string]any{
		"reviewBatchId": "review-batch-1",
		"actor":         map[string]any{"id": "codex:agent", "kind": "codex"},
		"cursor":        "batch:...",
		"count":         2,
		"summary": map[string]any{
			"total":    2,
			"open":     1,
			"resolved": 1,
			"archived": 0,
			"complete": false,
		},
		"threads": []map[string]any{
			thread,
			commentSchemaExampleThread("comment-thread-2", "README.md", "resolved"),
		},
		"open": map[string]any{
			"count": 1,
			"summary": map[string]any{
				"requiresAttention":      true,
				"attentionReasons":       []string{"owned_live_claims"},
				"recommendedAction":      "resume_owned_work",
				"totalOpenThreadCount":   1,
				"openThreadCount":        1,
				"sourceUnavailableCount": 0,
				"mineCount":              1,
				"unclaimedCount":         0,
				"claimedByOthersCount":   0,
				"suggestedCommands": []map[string]any{
					{
						"intent":        "renew_owned_claim",
						"command":       "comments renew",
						"args":          []string{"comments", "renew", "comment-thread-1", "--actor", "codex:agent", "--client-event-id", "batch:comment-thread-1:renew", "--json"},
						"clientEventId": "batch:comment-thread-1:renew",
						"reason":        "Refresh the recovered live claim before continuing work after an adapter restart.",
					},
				},
			},
			"mine": map[string]any{
				"threads": []map[string]any{thread},
				"claims":  []map[string]any{claim},
				"count":   1,
				"items":   []map[string]any{{"thread": thread, "activities": []map[string]any{claim}}},
			},
			"unclaimed": map[string]any{
				"threads": []map[string]any{},
				"count":   0,
			},
			"claimedByOthers": map[string]any{
				"threads": []map[string]any{},
				"claims":  []map[string]any{},
				"count":   0,
			},
			"sourceUnavailable": map[string]any{
				"threads": []map[string]any{},
				"claims":  []map[string]any{},
				"count":   0,
			},
		},
		"items": []map[string]any{{"thread": thread, "activities": []map[string]any{claim}}},
	}
}

func commentCheckOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	claim := commentSchemaExampleClaim("claim-1", "codex:agent")
	return map[string]any{
		"thread":    thread,
		"liveClaim": claim,
		"write": map[string]any{
			"actor":             map[string]any{"id": "codex:agent", "kind": "codex"},
			"canWrite":          true,
			"reason":            "owned_live_claim",
			"recommendedAction": "write_guarded_reply",
			"leaseExpiresAt":    "2026-01-01T00:10:00Z",
			"suggestedCommands": []map[string]any{
				{
					"intent":             "acknowledge_or_request_clarification",
					"command":            "comments triage",
					"args":               []string{"comments", "triage", "comment-thread-1", "--actor", "codex:agent", "--triage-file", "-", "--require-claim", "--client-event-id", "check:comment-thread-1:triage:claim-1", "--json"},
					"clientEventId":      "check:comment-thread-1:triage:claim-1",
					"stdinRequired":      true,
					"stdinSchema":        "commentTriageFileInput",
					"stdinSchemaCommand": []string{"comments", "schema", "commentTriageFileInput", "--json"},
					"stdinExample": map[string]any{
						"decision": "accepted",
						"summary":  "I understand the requested change and am working on it.",
					},
					"reason": "Post a structured acknowledgement, clarification request, or blocked status while keeping the thread open.",
				},
			},
		},
		"activities": []map[string]any{claim},
	}
}

func commentTriageOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	triage := map[string]any{
		"decision":   "fixing",
		"summary":    "I have claimed this feedback and am starting the fix.",
		"nextAction": "Patch the affected file and run task check.",
		"details":    "- Source anchor confirmed\n- No clarification needed",
		"body":       "Triage: fixing\n\nSummary: I have claimed this feedback and am starting the fix.\n\nNext action: Patch the affected file and run task check.\n\nDetails:\n- Source anchor confirmed\n- No clarification needed",
	}
	comment := map[string]any{
		"id":         "comment-2",
		"threadId":   "comment-thread-1",
		"path":       "README.md",
		"viewerKind": "markdown",
		"body":       triage["body"],
		"status":     "open",
		"createdAt":  "2026-01-01T00:01:00Z",
		"updatedAt":  "2026-01-01T00:01:00Z",
		"createdBy":  map[string]any{"id": "codex:agent", "kind": "codex"},
	}
	receipt := commentWriteReceiptOutputSchema().Example
	receipt["command"] = "comments triage"
	receipt["threadId"] = "comment-thread-1"
	receipt["commentId"] = "comment-2"
	return map[string]any{
		"triage":  triage,
		"comment": comment,
		"thread":  thread,
		"receipt": receipt,
	}
}

func commentReleaseOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "open")
	triage := map[string]any{
		"decision":   "needs-info",
		"summary":    "I need the expected behavior before editing.",
		"nextAction": "Ask the human which output should be considered correct.",
		"details":    "- Source anchor is clear\n- Expected result is missing",
		"body":       "Triage: needs-info\n\nSummary: I need the expected behavior before editing.\n\nNext action: Ask the human which output should be considered correct.\n\nDetails:\n- Source anchor is clear\n- Expected result is missing",
	}
	comment := map[string]any{
		"id":         "comment-2",
		"threadId":   "comment-thread-1",
		"path":       "README.md",
		"viewerKind": "markdown",
		"body":       triage["body"],
		"status":     "open",
		"createdAt":  "2026-01-01T00:02:00Z",
		"updatedAt":  "2026-01-01T00:02:00Z",
		"createdBy":  map[string]any{"id": "codex:agent", "kind": "codex"},
	}
	release := map[string]any{
		"id":            "activity-3",
		"type":          "thread_claim_released",
		"threadId":      "comment-thread-1",
		"actor":         map[string]any{"id": "codex:agent", "kind": "codex"},
		"clientEventId": "activity:comment-thread-1:release:activity-1",
		"createdAt":     "2026-01-01T00:02:00Z",
	}
	receipt := commentWriteReceiptOutputSchema().Example
	receipt["command"] = "comments release"
	receipt["threadId"] = "comment-thread-1"
	receipt["commentId"] = "comment-2"
	receipt["status"] = ""
	return map[string]any{
		"triage":  triage,
		"comment": comment,
		"thread":  thread,
		"release": release,
		"receipt": receipt,
	}
}

func commentResultOutputExample() map[string]any {
	thread := commentSchemaExampleThread("comment-thread-1", "README.md", "resolved")
	thread["resolvedAt"] = "2026-01-01T00:02:00Z"
	result := map[string]any{
		"outcome":      "resolved",
		"summary":      "Implemented the requested behavior.",
		"verification": []string{"go test ./cli passed", "task check passed"},
		"details":      "- Completion reply is retry-safe",
		"body":         "Result: resolved\n\nSummary: Implemented the requested behavior.\n\nVerification:\n- go test ./cli passed\n- task check passed\n\nDetails:\n- Completion reply is retry-safe",
	}
	comment := map[string]any{
		"id":         "comment-2",
		"threadId":   "comment-thread-1",
		"path":       "README.md",
		"viewerKind": "markdown",
		"body":       result["body"],
		"status":     "resolved",
		"createdAt":  "2026-01-01T00:02:00Z",
		"updatedAt":  "2026-01-01T00:02:00Z",
		"createdBy":  map[string]any{"id": "codex:agent", "kind": "codex"},
	}
	receipt := commentWriteReceiptOutputSchema().Example
	receipt["command"] = "comments done"
	receipt["threadId"] = "comment-thread-1"
	receipt["commentId"] = "comment-2"
	receipt["status"] = "resolved"
	return map[string]any{
		"result":  result,
		"comment": comment,
		"thread":  thread,
		"receipt": receipt,
	}
}

func commentSchemaExampleThread(id string, path string, status string) map[string]any {
	return map[string]any{
		"id":        id,
		"path":      path,
		"status":    status,
		"createdAt": "2026-01-01T00:00:00Z",
		"comments": []map[string]any{
			{
				"id":         id + "-comment-1",
				"threadId":   id,
				"path":       path,
				"viewerKind": "markdown",
				"body":       "Human feedback from the GUI.",
				"status":     status,
				"createdAt":  "2026-01-01T00:00:00Z",
				"updatedAt":  "2026-01-01T00:00:00Z",
				"createdBy":  map[string]any{"id": "human:reviewer", "kind": "human"},
			},
		},
	}
}

func commentSchemaExampleClaim(id string, actorID string) map[string]any {
	return map[string]any{
		"id":             id,
		"type":           "thread_claimed",
		"threadId":       "comment-thread-1",
		"actor":          map[string]any{"id": actorID, "kind": "codex"},
		"clientEventId":  "claim-1",
		"leaseExpiresAt": "2026-01-01T00:10:00Z",
		"createdAt":      "2026-01-01T00:00:00Z",
	}
}

func commentActorSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"id", "kind"},
		"properties": map[string]any{
			"id":          map[string]any{"type": "string"},
			"kind":        map[string]any{"type": "string"},
			"displayName": map[string]any{"type": "string"},
		},
	}
}

func commentTriageFileSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentTriageFileInput",
		Description: "Structured stdin/file payload accepted by comments triage --triage-file.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentTriageFileInput",
			"title":                "commentTriageFileInput",
			"type":                 "object",
			"additionalProperties": false,
			"required":             []string{"decision"},
			"anyOf": []map[string]any{
				{"required": []string{"summary"}},
				{"required": []string{"details"}},
			},
			"properties": map[string]any{
				"decision": map[string]any{
					"type":        "string",
					"enum":        []string{"accepted", "fixing", "needs-info", "blocked", "not-applicable"},
					"description": "Triage decision. Use fixing when the agent is actively addressing the feedback.",
				},
				"summary": map[string]any{
					"type":        "string",
					"description": "Short human-readable acknowledgement of what the agent understood.",
				},
				"nextAction": map[string]any{
					"type":        "string",
					"description": "Concrete next agent action or clarification request.",
				},
				"details": map[string]any{
					"type":        "string",
					"description": "Optional Markdown details rendered under Details.",
				},
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{
				Command:      "comments triage",
				Flag:         "--triage-file <path|->",
				StdinCommand: []string{"comments", "triage", "<thread-id>", "--actor", "<actor-id>", "--triage-file", "-", "--require-claim", "--json"},
			},
			{
				Command:      "comments release",
				Flag:         "--triage-file <path|->",
				StdinCommand: []string{"comments", "release", "<thread-id>", "--actor", "<actor-id>", "--triage-file", "-", "--require-claim", "--json"},
			},
		},
		Example: map[string]any{
			"decision":   "fixing",
			"summary":    "The feedback is actionable and reproducible.",
			"nextAction": "Patch the file and run task check.",
			"details":    "- Source anchor confirmed\n- No clarification needed",
		},
	}
}

func commentResultFileSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentResultFileInput",
		Description: "Structured stdin/file payload accepted by comments done/dismiss --result-file.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentResultFileInput",
			"title":                "commentResultFileInput",
			"type":                 "object",
			"additionalProperties": false,
			"anyOf": []map[string]any{
				{"required": []string{"summary"}},
				{"required": []string{"verification"}},
				{"required": []string{"details"}},
			},
			"properties": map[string]any{
				"summary": map[string]any{
					"type":        "string",
					"description": "Short human-readable completion or dismissal summary.",
				},
				"verification": map[string]any{
					"type":        "array",
					"description": "Verification commands or checks the agent performed.",
					"items": map[string]any{
						"type": "string",
					},
				},
				"details": map[string]any{
					"type":        "string",
					"description": "Optional Markdown details rendered under Details.",
				},
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{
				Command:      "comments done",
				Flag:         "--result-file <path|->",
				StdinCommand: []string{"comments", "done", "<thread-id>", "--actor", "<actor-id>", "--result-file", "-", "--require-claim", "--json"},
			},
			{
				Command:      "comments dismiss",
				Flag:         "--result-file <path|->",
				StdinCommand: []string{"comments", "dismiss", "<thread-id>", "--actor", "<actor-id>", "--result-file", "-", "--require-claim", "--json"},
			},
		},
		Example: map[string]any{
			"summary":      "Implemented the requested behavior.",
			"verification": []string{"go test ./cli passed", "task check passed"},
			"details":      "- Completion reply is retry-safe",
		},
	}
}

func commentActivityBatchEventSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentActivityBatchEvent",
		Description: "NDJSON event emitted by comments follow and comments work when thread activity changes.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentActivityBatchEvent",
			"title":                "commentActivityBatchEvent",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"type", "schemaVersion", "eventSchema", "eventSchemaCommand", "sessionId", "sequence", "reason", "threadId", "cursor", "emittedAt", "count", "summary", "activities"},
			"properties": map[string]any{
				"type":               map[string]any{"const": "comment_thread_activity_batch"},
				"schemaVersion":      map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"eventSchema":        map[string]any{"type": "string", "const": "commentActivityBatchEvent"},
				"eventSchemaCommand": arraySchema(map[string]any{"type": "string"}),
				"sessionId":          map[string]any{"type": "string"},
				"sequence":           map[string]any{"type": "integer", "minimum": 1},
				"reason":             map[string]any{"type": "string", "enum": []string{"initial", "resumed", "activity_changed"}},
				"threadId":           map[string]any{"type": "string"},
				"cursor":             map[string]any{"type": "string"},
				"emittedAt":          map[string]any{"type": "string", "format": "date-time"},
				"count":              map[string]any{"type": "integer", "minimum": 0},
				"summary":            commentActivityBatchSummarySchema(),
				"activities":         arraySchema(commentActivitySchema()),
				"comments":           arraySchema(commentSchema()),
				"file":               map[string]any{"type": "object"},
				"source":             sourceContextSchema(),
				"diff":               textDiffSchema(),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments follow <thread-id> --json"},
			{Command: "comments work --json"},
		},
		Example: map[string]any{
			"type":               "comment_thread_activity_batch",
			"schemaVersion":      commentsStreamSchemaVersion,
			"eventSchema":        "commentActivityBatchEvent",
			"eventSchemaCommand": commentSchemaCommandArgs("commentActivityBatchEvent"),
			"sessionId":          "comments-work-...",
			"sequence":           2,
			"reason":             "activity_changed",
			"threadId":           "comment-thread-...",
			"cursor":             "activity-...",
			"emittedAt":          "2026-01-01T00:00:00Z",
			"count":              1,
			"summary": map[string]any{
				"kinds":                 []string{"human_comment"},
				"requiresAttention":     true,
				"attentionReasons":      []string{"external_human_comment"},
				"recommendedAction":     "reconsider_work",
				"ownActivityCount":      0,
				"externalActivityCount": 1,
				"humanCommentCount":     1,
				"agentCommentCount":     0,
				"triageCommentCount":    0,
			},
			"activities": []map[string]any{
				{
					"id":        "activity-...",
					"threadId":  "comment-thread-...",
					"type":      "comment_added",
					"actor":     map[string]any{"id": "human:tasuku", "kind": "human"},
					"commentId": "comment-...",
					"createdAt": "2026-01-01T00:00:00Z",
				},
			},
		},
	}
}

func commentWorkClaimedEventSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentWorkClaimedEvent",
		Description: "NDJSON event emitted by comments work after it claims a thread for the agent.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentWorkClaimedEvent",
			"title":                "commentWorkClaimedEvent",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"type", "schemaVersion", "eventSchema", "eventSchemaCommand", "sessionId", "sequence", "emittedAt", "thread", "claim", "cursor", "count", "remaining", "summary"},
			"properties": map[string]any{
				"type":               map[string]any{"const": "comment_work_claimed"},
				"schemaVersion":      map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"eventSchema":        map[string]any{"type": "string", "const": "commentWorkClaimedEvent"},
				"eventSchemaCommand": arraySchema(map[string]any{"type": "string"}),
				"sessionId":          map[string]any{"type": "string"},
				"sequence":           map[string]any{"type": "integer", "minimum": 1},
				"emittedAt":          map[string]any{"type": "string", "format": "date-time"},
				"thread":             commentThreadSchema(),
				"claim":              commentActivitySchema(),
				"cursor":             map[string]any{"type": "string"},
				"count":              map[string]any{"type": "integer", "minimum": 0},
				"remaining":          map[string]any{"type": "integer", "minimum": 0},
				"summary":            commentActivityBatchSummarySchema(),
				"file":               map[string]any{"type": "object"},
				"source":             sourceContextSchema(),
				"diff":               textDiffSchema(),
				"activities":         arraySchema(commentActivitySchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments work --json"},
		},
		Example: map[string]any{
			"type":               "comment_work_claimed",
			"schemaVersion":      commentsStreamSchemaVersion,
			"eventSchema":        "commentWorkClaimedEvent",
			"eventSchemaCommand": commentSchemaCommandArgs("commentWorkClaimedEvent"),
			"sessionId":          "comments-work-...",
			"sequence":           1,
			"emittedAt":          "2026-01-01T00:00:00Z",
			"thread": map[string]any{
				"id":        "comment-thread-...",
				"path":      "README.md",
				"status":    "open",
				"createdAt": "2026-01-01T00:00:00Z",
				"comments":  []map[string]any{},
			},
			"claim": map[string]any{
				"id":             "activity-...",
				"threadId":       "comment-thread-...",
				"type":           "thread_claimed",
				"actor":          map[string]any{"id": "codex:agent", "kind": "codex"},
				"leaseExpiresAt": "2026-01-01T00:10:00Z",
				"createdAt":      "2026-01-01T00:00:00Z",
			},
			"cursor":    "comment-thread-cursor-...",
			"count":     1,
			"remaining": 0,
			"summary": map[string]any{
				"kinds":                 []string{"claimed_work", "human_comment", "own_claim"},
				"requiresAttention":     true,
				"attentionReasons":      []string{"claimed_open_thread"},
				"recommendedAction":     "start_work",
				"ownActivityCount":      1,
				"externalActivityCount": 0,
				"humanCommentCount":     1,
				"claimCount":            1,
				"ownClaimCount":         1,
				"suggestedCommands": []map[string]any{
					{
						"intent":      "acknowledge_initial_feedback",
						"command":     "comments triage",
						"args":        []string{"comments", "triage", "comment-thread-...", "--actor", "codex:agent", "--triage-file", "-", "--require-claim", "--json"},
						"stdinSchema": "commentTriageFileInput",
						"reason":      "Post a structured acknowledgement that the agent has started the claimed work.",
					},
					{
						"intent":      "complete_after_verification",
						"command":     "comments done",
						"args":        []string{"comments", "done", "comment-thread-...", "--actor", "codex:agent", "--result-file", "-", "--require-claim", "--json"},
						"stdinSchema": "commentResultFileInput",
						"reason":      "Resolve the thread with structured verification after the fix is complete.",
					},
					{
						"intent":      "archive_after_decision",
						"command":     "comments dismiss",
						"args":        []string{"comments", "dismiss", "comment-thread-...", "--actor", "codex:agent", "--result-file", "-", "--require-claim", "--json"},
						"stdinSchema": "commentResultFileInput",
						"reason":      "Archive the thread with a structured explanation when the feedback is intentionally not fixed.",
					},
				},
			},
		},
	}
}

func commentWorkIdleEventSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentWorkIdleEvent",
		Description: "NDJSON event emitted by comments work when no claimable thread is available.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentWorkIdleEvent",
			"title":                "commentWorkIdleEvent",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"type", "schemaVersion", "eventSchema", "eventSchemaCommand", "sessionId", "sequence", "reason", "emittedAt", "thread", "claim", "cursor", "count", "remaining", "summary"},
			"properties": map[string]any{
				"type":               map[string]any{"const": "comment_work_idle"},
				"schemaVersion":      map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"eventSchema":        map[string]any{"type": "string", "const": "commentWorkIdleEvent"},
				"eventSchemaCommand": arraySchema(map[string]any{"type": "string"}),
				"sessionId":          map[string]any{"type": "string"},
				"sequence":           map[string]any{"type": "integer", "minimum": 1},
				"reason":             map[string]any{"type": "string", "const": "no_claimable_work"},
				"emittedAt":          map[string]any{"type": "string", "format": "date-time"},
				"thread":             map[string]any{"type": []string{"object", "null"}},
				"claim":              map[string]any{"type": []string{"object", "null"}},
				"cursor":             map[string]any{"type": "string"},
				"count":              map[string]any{"type": "integer", "minimum": 0},
				"remaining":          map[string]any{"type": "integer", "minimum": 0},
				"summary":            commentOpenWorklistSummarySchema(),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments work --json"},
			{Command: "comments work --wait --idle-events --json"},
		},
		Example: map[string]any{
			"type":               "comment_work_idle",
			"schemaVersion":      commentsStreamSchemaVersion,
			"eventSchema":        "commentWorkIdleEvent",
			"eventSchemaCommand": commentSchemaCommandArgs("commentWorkIdleEvent"),
			"sessionId":          "comments-work-...",
			"sequence":           1,
			"reason":             "no_claimable_work",
			"emittedAt":          "2026-01-01T00:00:00Z",
			"thread":             nil,
			"claim":              nil,
			"cursor":             "open:...",
			"count":              0,
			"remaining":          0,
			"summary": commentOpenWorklistSummary{
				RequiresAttention: false,
				AttentionReasons:  []string{},
				RecommendedAction: "wait_for_gui_feedback",
				OpenThreadCount:   0,
			},
		},
	}
}

func commentOpenWorklistEventSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentOpenWorklistEvent",
		Description: "NDJSON event emitted by comments watch when the open comments worklist changes.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentOpenWorklistEvent",
			"title":                "commentOpenWorklistEvent",
			"type":                 "object",
			"additionalProperties": true,
			"required":             []string{"type", "schemaVersion", "eventSchema", "eventSchemaCommand", "sessionId", "sequence", "reason", "changes", "cursor", "emittedAt", "count", "summary", "threads"},
			"properties": map[string]any{
				"type":               map[string]any{"const": "comments_open_worklist"},
				"schemaVersion":      map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
				"eventSchema":        map[string]any{"type": "string", "const": "commentOpenWorklistEvent"},
				"eventSchemaCommand": arraySchema(map[string]any{"type": "string"}),
				"sessionId":          map[string]any{"type": "string"},
				"sequence":           map[string]any{"type": "integer", "minimum": 1},
				"reason":             map[string]any{"type": "string", "enum": []string{"initial", "resumed", "open_worklist_changed"}},
				"changes":            arraySchema(map[string]any{"type": "string"}),
				"cursor":             map[string]any{"type": "string"},
				"emittedAt":          map[string]any{"type": "string", "format": "date-time"},
				"count":              map[string]any{"type": "integer", "minimum": 0},
				"summary":            commentOpenWorklistSummarySchema(),
				"threads":            arraySchema(commentThreadSchema()),
				"items":              arraySchema(commentWorkItemSchema()),
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "comments watch --json"},
		},
		Example: map[string]any{
			"type":               "comments_open_worklist",
			"schemaVersion":      commentsStreamSchemaVersion,
			"eventSchema":        "commentOpenWorklistEvent",
			"eventSchemaCommand": commentSchemaCommandArgs("commentOpenWorklistEvent"),
			"sessionId":          "comments-watch-...",
			"sequence":           1,
			"reason":             "initial",
			"changes":            []string{"open_thread_added"},
			"cursor":             "open:...",
			"emittedAt":          "2026-01-01T00:00:00Z",
			"count":              1,
			"summary": map[string]any{
				"requiresAttention": true,
				"attentionReasons":  []string{"open_threads_available"},
				"recommendedAction": "claim_open_work",
				"openThreadCount":   1,
				"suggestedCommands": []map[string]any{
					{
						"intent":        "claim_next_open_thread",
						"command":       "comments work",
						"args":          []string{"comments", "work", "--actor", "codex:agent", "--client-event-id", "watch:open:...:claim", "--full", "--json"},
						"clientEventId": "watch:open:...:claim",
						"reason":        "Claim the next open thread and receive a self-describing work event.",
					},
				},
			},
			"threads": []map[string]any{
				{
					"id":        "comment-thread-...",
					"path":      "README.md",
					"status":    "open",
					"createdAt": "2026-01-01T00:00:00Z",
					"comments":  []map[string]any{},
				},
			},
		},
	}
}

func commentErrorEventSchema() commentSchemaOutput {
	return commentSchemaOutput{
		Name:        "commentErrorEvent",
		Description: "JSON error envelope emitted by vivi comments ... --json on non-zero CLI exits.",
		Schema: map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"$id":                  "vivi://comments/schemas/commentErrorEvent",
			"title":                "commentErrorEvent",
			"type":                 "object",
			"additionalProperties": false,
			"required":             []string{"error"},
			"properties": map[string]any{
				"error": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"required":             []string{"schemaVersion", "code", "message", "command", "recoverable"},
					"properties": map[string]any{
						"schemaVersion": map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
						"code": map[string]any{
							"type": "string",
							"enum": []string{"server_unreachable", "invalid_arguments", "no_live_claim", "claimed_by_other_actor", "not_found", "upstream_graphql_error", "comments_command_failed"},
						},
						"message":           map[string]any{"type": "string"},
						"command":           map[string]any{"type": "string"},
						"args":              arraySchema(map[string]any{"type": "string"}),
						"recoverable":       map[string]any{"type": "boolean"},
						"suggestedCommands": arraySchema(commentSuggestedCommandSchema()),
						"schemaCommand":     arraySchema(map[string]any{"type": "string"}),
					},
				},
			},
		},
		AcceptedBy: []commentSchemaCommand{
			{Command: "vivi comments <command> --json"},
		},
		Example: map[string]any{
			"error": map[string]any{
				"schemaVersion": commentsStreamSchemaVersion,
				"code":          "no_live_claim",
				"message":       "comment thread \"comment-thread-...\" has no live claim for actor \"codex\"; renew or claim it before writing",
				"command":       "comments done",
				"args":          []string{"comments", "done", "comment-thread-...", "--actor", "codex", "--require-claim", "--url", "<server-url>", "--json"},
				"recoverable":   true,
				"suggestedCommands": []map[string]any{
					{
						"intent":        "claim_thread_before_retrying",
						"command":       "comments claim",
						"args":          []string{"comments", "claim", "comment-thread-...", "--actor", "codex", "--full", "--client-event-id", "error:comment-thread-...:claim", "--url", "<server-url>", "--json"},
						"clientEventId": "error:comment-thread-...:claim",
						"reason":        "Claim this thread before retrying the failed guarded write.",
					},
					{
						"intent":  "check_thread_before_retrying",
						"command": "comments check",
						"args":    []string{"comments", "check", "comment-thread-...", "--actor", "codex", "--full", "--url", "<server-url>", "--json"},
						"reason":  "Inspect live claim ownership and use write.suggestedCommands for the next safe write.",
					},
				},
				"schemaCommand": commentSchemaCommandArgs("commentErrorEvent"),
			},
		},
	}
}

func commentActivityBatchSummarySchema() map[string]any {
	integerCount := map[string]any{"type": "integer", "minimum": 0}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"kinds", "requiresAttention", "attentionReasons", "recommendedAction", "ownActivityCount", "externalActivityCount"},
		"properties": map[string]any{
			"kinds":                      arraySchema(map[string]any{"type": "string"}),
			"requiresAttention":          map[string]any{"type": "boolean"},
			"attentionReasons":           arraySchema(map[string]any{"type": "string"}),
			"recommendedAction":          map[string]any{"type": "string", "enum": []string{"start_work", "reconsider_work", "inspect_external_activity", "ignore_own_heartbeat", "ignore_own_activity", "finish_current_work", "observe"}},
			"suggestedCommands":          arraySchema(commentSuggestedCommandSchema()),
			"ownActivityCount":           integerCount,
			"externalActivityCount":      integerCount,
			"humanCommentCount":          integerCount,
			"agentCommentCount":          integerCount,
			"triageCommentCount":         integerCount,
			"ownCommentCount":            integerCount,
			"externalCommentCount":       integerCount,
			"externalAgentCommentCount":  integerCount,
			"ownTriageCommentCount":      integerCount,
			"externalTriageCommentCount": integerCount,
			"commentUpdateCount":         integerCount,
			"claimCount":                 integerCount,
			"ownClaimCount":              integerCount,
			"externalClaimCount":         integerCount,
			"releaseCount":               integerCount,
			"ownReleaseCount":            integerCount,
			"externalReleaseCount":       integerCount,
			"statusChangeCount":          integerCount,
			"ownStatusChangeCount":       integerCount,
			"externalStatusChangeCount":  integerCount,
			"readCount":                  integerCount,
			"threadCreatedCount":         integerCount,
			"terminalStatus":             map[string]any{"type": "string", "enum": []string{"resolved", "archived"}},
		},
	}
}

func commentOpenWorklistSummarySchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"requiresAttention", "attentionReasons", "recommendedAction", "openThreadCount"},
		"properties": map[string]any{
			"requiresAttention": map[string]any{"type": "boolean"},
			"attentionReasons":  arraySchema(map[string]any{"type": "string"}),
			"recommendedAction": map[string]any{"type": "string", "enum": []string{"claim_open_work", "wait_for_open_work"}},
			"openThreadCount":   map[string]any{"type": "integer", "minimum": 0},
			"suggestedCommands": arraySchema(commentSuggestedCommandSchema()),
		},
	}
}

func commentRoutingSummarySchema() map[string]any {
	integerCount := map[string]any{"type": "integer", "minimum": 0}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"requiresAttention", "attentionReasons", "recommendedAction", "totalOpenThreadCount", "openThreadCount", "sourceUnavailableCount", "mineCount", "unclaimedCount", "claimedByOthersCount"},
		"properties": map[string]any{
			"requiresAttention":      map[string]any{"type": "boolean"},
			"attentionReasons":       arraySchema(map[string]any{"type": "string"}),
			"recommendedAction":      map[string]any{"type": "string", "enum": []string{"resume_owned_work", "claim_open_work", "wait_for_claim_release", "wait_for_gui_feedback"}},
			"totalOpenThreadCount":   integerCount,
			"openThreadCount":        integerCount,
			"sourceUnavailableCount": integerCount,
			"mineCount":              integerCount,
			"unclaimedCount":         integerCount,
			"claimedByOthersCount":   integerCount,
			"suggestedCommands":      arraySchema(commentSuggestedCommandSchema()),
		},
	}
}

func commentClaimSummarySchema() map[string]any {
	integerCount := map[string]any{"type": "integer", "minimum": 0}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"requiresAttention", "attentionReasons", "recommendedAction"},
		"properties": map[string]any{
			"kinds":                      arraySchema(map[string]any{"type": "string"}),
			"requiresAttention":          map[string]any{"type": "boolean"},
			"attentionReasons":           arraySchema(map[string]any{"type": "string"}),
			"recommendedAction":          map[string]any{"type": "string", "enum": []string{"start_work", "reconsider_work", "inspect_external_activity", "ignore_own_heartbeat", "ignore_own_activity", "finish_current_work", "observe", "resume_owned_work", "claim_open_work", "wait_for_claim_release", "wait_for_gui_feedback"}},
			"suggestedCommands":          arraySchema(commentSuggestedCommandSchema()),
			"ownActivityCount":           integerCount,
			"externalActivityCount":      integerCount,
			"humanCommentCount":          integerCount,
			"agentCommentCount":          integerCount,
			"triageCommentCount":         integerCount,
			"ownCommentCount":            integerCount,
			"externalCommentCount":       integerCount,
			"externalAgentCommentCount":  integerCount,
			"ownTriageCommentCount":      integerCount,
			"externalTriageCommentCount": integerCount,
			"commentUpdateCount":         integerCount,
			"claimCount":                 integerCount,
			"ownClaimCount":              integerCount,
			"releaseCount":               integerCount,
			"doneCount":                  integerCount,
			"dismissCount":               integerCount,
			"openThreadCount":            integerCount,
			"mineCount":                  integerCount,
			"unclaimedCount":             integerCount,
			"claimedByOthersCount":       integerCount,
		},
	}
}

func commentInboxGroupSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"threads", "count"},
		"properties": map[string]any{
			"threads": arraySchema(commentThreadSchema()),
			"claims":  arraySchema(commentActivitySchema()),
			"count":   map[string]any{"type": "integer", "minimum": 0},
			"items":   arraySchema(commentWorkItemSchema()),
		},
	}
}

func commentBatchProgressSummarySchema() map[string]any {
	integerCount := map[string]any{"type": "integer", "minimum": 0}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"total", "open", "resolved", "archived", "complete"},
		"properties": map[string]any{
			"total":    integerCount,
			"open":     integerCount,
			"resolved": integerCount,
			"archived": integerCount,
			"complete": map[string]any{"type": "boolean"},
		},
	}
}

func commentSuggestedCommandSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"intent", "command", "args", "reason"},
		"properties": map[string]any{
			"intent":             map[string]any{"type": "string"},
			"command":            map[string]any{"type": "string"},
			"args":               arraySchema(map[string]any{"type": "string"}),
			"clientEventId":      map[string]any{"type": "string"},
			"stdinRequired":      map[string]any{"type": "boolean"},
			"stdinSchema":        map[string]any{"type": "string"},
			"stdinSchemaCommand": arraySchema(map[string]any{"type": "string"}),
			"stdinExample":       map[string]any{"type": "object"},
			"reason":             map[string]any{"type": "string"},
		},
	}
}

func commentWritePreflightSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"actor", "canWrite", "reason", "recommendedAction", "suggestedCommands"},
		"properties": map[string]any{
			"actor":             commentActorSchema(),
			"canWrite":          map[string]any{"type": "boolean"},
			"reason":            map[string]any{"type": "string", "enum": []string{"owned_live_claim", "no_live_claim", "claimed_by_other_actor", "thread_not_open"}},
			"recommendedAction": map[string]any{"type": "string", "enum": []string{"write_guarded_reply", "claim_before_writing", "inspect_or_wait", "reopen_before_writing", "inspect_thread"}},
			"status":            map[string]any{"type": "string"},
			"claimedBy":         commentActorSchema(),
			"leaseExpiresAt":    map[string]any{"type": "string", "format": "date-time"},
			"suggestedCommands": arraySchema(commentSuggestedCommandSchema()),
		},
	}
}

func commentTriagePayloadSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"decision", "body"},
		"properties": map[string]any{
			"decision":   map[string]any{"type": "string", "enum": []string{"accepted", "fixing", "needs-info", "blocked", "not-applicable"}},
			"summary":    map[string]any{"type": "string"},
			"nextAction": map[string]any{"type": "string"},
			"details":    map[string]any{"type": "string"},
			"body":       map[string]any{"type": "string"},
		},
	}
}

func commentResultPayloadSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"outcome", "body"},
		"properties": map[string]any{
			"outcome":      map[string]any{"type": "string", "enum": []string{"resolved", "archived"}},
			"summary":      map[string]any{"type": "string"},
			"verification": arraySchema(map[string]any{"type": "string"}),
			"details":      map[string]any{"type": "string"},
			"body":         map[string]any{"type": "string"},
		},
	}
}

func commentWriteReceiptSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"schemaVersion", "receiptSchema", "receiptSchemaCommand", "verificationCommand", "verificationSchema", "verificationSchemaCommand", "command", "threadId", "effects"},
		"properties": map[string]any{
			"schemaVersion":             map[string]any{"type": "integer", "const": commentsStreamSchemaVersion},
			"receiptSchema":             map[string]any{"type": "string", "const": "commentWriteReceipt"},
			"receiptSchemaCommand":      arraySchema(map[string]any{"type": "string"}),
			"verificationCommand":       arraySchema(map[string]any{"type": "string"}),
			"verificationSchema":        map[string]any{"type": "string", "const": "commentWriteReceiptVerification"},
			"verificationSchemaCommand": arraySchema(map[string]any{"type": "string"}),
			"command":                   map[string]any{"type": "string"},
			"threadId":                  map[string]any{"type": "string"},
			"actorId":                   map[string]any{"type": "string"},
			"clientEventId":             map[string]any{"type": "string"},
			"commentId":                 map[string]any{"type": "string"},
			"status":                    map[string]any{"type": "string"},
			"effects":                   arraySchema(commentWriteReceiptEffectSchema()),
		},
	}
}

func commentWriteReceiptEffectSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"id", "type", "createdAt"},
		"properties": map[string]any{
			"id":             map[string]any{"type": "string"},
			"type":           map[string]any{"type": "string"},
			"commentId":      map[string]any{"type": "string"},
			"previousStatus": map[string]any{"type": "string"},
			"status":         map[string]any{"type": "string"},
			"clientEventId":  map[string]any{"type": "string"},
			"createdAt":      map[string]any{"type": "string", "format": "date-time"},
		},
	}
}

func commentThreadSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"id", "path", "status", "createdAt", "comments"},
		"properties": map[string]any{
			"id":            map[string]any{"type": "string"},
			"path":          map[string]any{"type": "string"},
			"status":        map[string]any{"type": "string", "enum": []string{"open", "resolved", "archived"}},
			"reviewBatchId": map[string]any{"type": "string"},
			"anchor":        map[string]any{"type": "object"},
			"createdAt":     map[string]any{"type": "string", "format": "date-time"},
			"updatedAt":     map[string]any{"type": "string", "format": "date-time"},
			"resolvedAt":    map[string]any{"type": "string", "format": "date-time"},
			"archivedAt":    map[string]any{"type": "string", "format": "date-time"},
			"comments":      arraySchema(commentSchema()),
		},
	}
}

func commentWorkItemSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"thread"},
		"properties": map[string]any{
			"thread":     commentThreadSchema(),
			"file":       map[string]any{"type": "object"},
			"source":     sourceContextSchema(),
			"diff":       textDiffSchema(),
			"activities": arraySchema(commentActivitySchema()),
		},
	}
}

func commentSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"id", "path", "viewerKind", "body", "status", "createdAt", "updatedAt", "createdBy"},
		"properties": map[string]any{
			"id":            map[string]any{"type": "string"},
			"threadId":      map[string]any{"type": "string"},
			"path":          map[string]any{"type": "string"},
			"viewerKind":    map[string]any{"type": "string"},
			"reviewBatchId": map[string]any{"type": "string"},
			"anchor":        map[string]any{"type": "object"},
			"body":          map[string]any{"type": "string"},
			"status":        map[string]any{"type": "string"},
			"createdAt":     map[string]any{"type": "string", "format": "date-time"},
			"updatedAt":     map[string]any{"type": "string", "format": "date-time"},
			"resolvedAt":    map[string]any{"type": "string", "format": "date-time"},
			"archivedAt":    map[string]any{"type": "string", "format": "date-time"},
			"createdBy":     actorSchema(),
		},
	}
}

func commentActivitySchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"id", "threadId", "type", "actor", "createdAt"},
		"properties": map[string]any{
			"id":             map[string]any{"type": "string"},
			"threadId":       map[string]any{"type": "string"},
			"type":           map[string]any{"type": "string"},
			"actor":          actorSchema(),
			"commentId":      map[string]any{"type": "string"},
			"previousStatus": map[string]any{"type": "string"},
			"status":         map[string]any{"type": "string"},
			"clientEventId":  map[string]any{"type": "string"},
			"leaseExpiresAt": map[string]any{"type": "string", "format": "date-time"},
			"createdAt":      map[string]any{"type": "string", "format": "date-time"},
		},
	}
}

func actorSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"id", "kind"},
		"properties": map[string]any{
			"id":          map[string]any{"type": "string"},
			"kind":        map[string]any{"type": "string"},
			"displayName": map[string]any{"type": "string"},
		},
	}
}

func sourceContextSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"path", "viewerKind", "encoding", "available"},
		"properties": map[string]any{
			"path":            map[string]any{"type": "string"},
			"viewerKind":      map[string]any{"type": "string"},
			"encoding":        map[string]any{"type": "string"},
			"available":       map[string]any{"type": "boolean"},
			"reason":          map[string]any{"type": "string"},
			"startLine":       map[string]any{"type": "integer"},
			"endLine":         map[string]any{"type": "integer"},
			"anchorStartLine": map[string]any{"type": "integer"},
			"anchorEndLine":   map[string]any{"type": "integer"},
			"truncated":       map[string]any{"type": "boolean"},
			"lines":           arraySchema(map[string]any{"type": "object"}),
		},
	}
}

func textDiffSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"required":             []string{"path", "status", "baseLabel", "baseRef", "compareLabel", "content"},
		"properties": map[string]any{
			"path":         map[string]any{"type": "string"},
			"status":       map[string]any{"type": "string"},
			"kind":         map[string]any{"type": "string"},
			"baseLabel":    map[string]any{"type": "string"},
			"baseRef":      map[string]any{"type": "string"},
			"compareLabel": map[string]any{"type": "string"},
			"diffHash":     map[string]any{"type": "string"},
			"content":      map[string]any{"type": "string"},
			"reason":       map[string]any{"type": "string"},
		},
	}
}

func arraySchema(items map[string]any) map[string]any {
	return map[string]any{
		"type":  "array",
		"items": items,
	}
}

func nullableSchema(schema map[string]any) map[string]any {
	return map[string]any{
		"anyOf": []map[string]any{
			schema,
			{"type": "null"},
		},
	}
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
			value := args[i]
			if strings.HasPrefix(value, "-") && value != "-" {
				flagArgs[len(flagArgs)-1] = arg + "=" + value
			} else {
				flagArgs = append(flagArgs, value)
			}
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
	case "url", "path", "status", "review-batch", "actor", "actor-kind", "actor-name", "client-event-id", "body", "body-file", "triage-file", "result-file", "receipt-file", "receipt-log", "decision", "summary", "next-action", "diff-base", "context-lines", "interval", "cursor", "max-events", "activity-limit", "comment-limit", "lease", "renew-interval":
		return true
	default:
		return false
	}
}

func commentsCommandWritesReceipt(command string) bool {
	switch command {
	case "reply", "triage", "release", "done", "dismiss":
		return true
	default:
		return false
	}
}

func commentsCommandVerifiesReceiptLog(command string) bool {
	switch command {
	case "verify-receipts", "receipts":
		return true
	default:
		return false
	}
}

func commentsCommandPropagatesReceiptLog(command string) bool {
	switch command {
	case "claim", "work", "watch", "follow", "check", "inbox", "batch":
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
	outputThreads := limitCommentThreadsHistory(threads, options.CommentLimit)
	payload := map[string]any{"threads": outputThreads, "count": len(threads)}
	if commentsNeedsWorkItem(options) {
		items, err := commentWorkItemsForThreads(ctx, withoutReadHeaders(options), threads)
		if err != nil {
			return err
		}
		payload["items"] = items
	}
	return writeJSON(stdout, payload)
}

func commentsNext(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	threads, cursor, err := fetchCommentThreads(ctx, options, "open")
	if err != nil {
		return err
	}
	ordered := orderCommentThreadsForAgent(threads)
	var thread *commentThreadOutput
	var item *commentWorkItemOutput
	selectedIndex := -1
	for index, candidate := range ordered {
		if commentsNeedsWorkItem(options) {
			candidateItem, err := commentWorkItemForThread(ctx, withoutReadHeaders(options), candidate)
			if err != nil {
				return err
			}
			if sourceContextUnavailable(candidateItem) && index < len(ordered)-1 {
				continue
			}
			item = &candidateItem
		}
		thread = &ordered[index]
		selectedIndex = index
		break
	}
	remaining := 0
	if selectedIndex >= 0 {
		remaining = len(ordered) - selectedIndex - 1
	}
	var outputThread *commentThreadOutput
	if thread != nil {
		limited := limitCommentThreadHistory(*thread, options.CommentLimit)
		outputThread = &limited
	}
	payload := map[string]any{
		"thread":    outputThread,
		"cursor":    cursor,
		"count":     len(ordered),
		"remaining": remaining,
	}
	if thread == nil {
		routing, err := commentOpenRouting(ctx, withoutReadHeaders(options), ordered, options.ActorID)
		if err != nil {
			return err
		}
		payload["summary"] = summarizeOpenRouting(routing, options.ActorID, cursor, "next", options.URL, options.ReceiptLog)
	}
	if options.WithContext {
		payload["file"] = nil
		payload["source"] = nil
	}
	if options.WithDiff {
		payload["diff"] = nil
	}
	if options.WithActivities {
		payload["activities"] = nil
	}
	if item != nil {
		if options.WithContext {
			payload["file"] = item.File
			payload["source"] = item.Source
		}
		if options.WithDiff {
			payload["diff"] = item.Diff
		}
		if options.WithActivities {
			payload["activities"] = item.Activities
		}
	}
	return writeJSON(stdout, payload)
}

func commentsClaim(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	payload, _, err := commentClaimPayload(ctx, options, threadID)
	if err != nil {
		return err
	}
	return writeJSON(stdout, payload)
}

func commentsClaimWait(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	for {
		payload, claimed, err := commentClaimPayload(ctx, options, "")
		if err == nil && claimed {
			return writeJSON(stdout, payload)
		}
		if err != nil && options.WatchOnce {
			return err
		}
		if options.WatchOnce {
			return writeJSON(stdout, payload)
		}
		if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
			return err
		}
	}
}

func commentsWork(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	sessionID := newCommentsStreamSessionID(options, "work")
	emitted := 0
	for {
		payload, claimed, err := commentClaimPayload(ctx, options, threadID)
		if err != nil {
			if !options.WaitForWork && !options.WorkLoop {
				return err
			}
			if options.WatchOnce {
				return err
			}
			if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
				return err
			}
			continue
		}
		if !claimed {
			if (options.WaitForWork || options.WorkLoop) && !options.WatchOnce {
				if options.WorkIdleEvents {
					if err := emitCommentsWorkIdleEvent(encoder, payload, sessionID, emitted+1, options.ActorID, options.URL, options.ReceiptLog); err != nil {
						return err
					}
					emitted++
					if reachedWatchMaxEvents(options, emitted) {
						return nil
					}
				}
				if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
					return err
				}
				continue
			}
			return emitCommentsWorkIdleEvent(encoder, payload, sessionID, emitted+1, options.ActorID, options.URL, options.ReceiptLog)
		}
		payload["type"] = "comment_work_claimed"
		payload["schemaVersion"] = commentsStreamSchemaVersion
		addCommentEventSchemaMetadata(payload, "commentWorkClaimedEvent")
		payload["sessionId"] = sessionID
		payload["sequence"] = emitted + 1
		payload["emittedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		if err := encoder.Encode(payload); err != nil {
			return err
		}
		emitted++
		if options.WatchOnce || reachedWatchMaxEvents(options, emitted) {
			return nil
		}
		claim, ok := payload["claim"].(*commentActivityOutput)
		if !ok || claim == nil || strings.TrimSpace(claim.ID) == "" {
			return errors.New("work claim did not include an activity cursor")
		}
		thread, ok := payload["thread"].(*commentThreadOutput)
		if !ok || thread == nil || strings.TrimSpace(thread.ID) == "" {
			return errors.New("work claim did not include a thread")
		}
		nextEmitted, terminal, err := commentsWorkFollow(ctx, encoder, options, thread.ID, claim.ID, sessionID, emitted)
		emitted = nextEmitted
		if err != nil {
			return err
		}
		if reachedWatchMaxEvents(options, emitted) {
			return nil
		}
		if !options.WorkLoop || !terminal {
			return nil
		}
		threadID = ""
	}
}

func emitCommentsWorkIdleEvent(encoder *json.Encoder, payload map[string]any, sessionID string, sequence int, actorID string, serverURL string, receiptLog string) error {
	payload["type"] = "comment_work_idle"
	payload["reason"] = "no_claimable_work"
	payload["schemaVersion"] = commentsStreamSchemaVersion
	addCommentEventSchemaMetadata(payload, "commentWorkIdleEvent")
	payload["sessionId"] = sessionID
	payload["sequence"] = sequence
	payload["emittedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	payload["summary"] = commentWorkIdleSummary(payload, actorID, serverURL, receiptLog)
	return encoder.Encode(payload)
}

func commentWorkIdleSummary(payload map[string]any, actorID string, serverURL string, receiptLog string) commentOpenWorklistSummary {
	count, _ := payload["count"].(int)
	cursor, _ := payload["cursor"].(string)
	if count <= 0 {
		return commentOpenWorklistSummary{
			RequiresAttention: false,
			AttentionReasons:  []string{},
			RecommendedAction: "wait_for_gui_feedback",
			OpenThreadCount:   0,
		}
	}
	actorID = strings.TrimSpace(actorID)
	return commentOpenWorklistSummary{
		RequiresAttention: true,
		AttentionReasons:  []string{"open_threads_claimed_by_others"},
		RecommendedAction: "wait_for_claim_release",
		OpenThreadCount:   count,
		SuggestedCommands: []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_agent_inbox", "comments inbox", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "inbox", "--actor", actorID, "--full", "--json"}), serverURL, receiptLog), "", "Inspect open threads currently routed to this actor, unclaimed work, and live claims held by others."),
			suggestedCommentsCommand("watch_open_worklist", "comments watch", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "watch", "--actor", actorID, "--full", "--cursor", cursor, "--json"}), serverURL, receiptLog), "", "Watch for a new unclaimed thread or a claim release before trying to claim again."),
		},
	}
}

func commentsWorkFollow(ctx context.Context, encoder *json.Encoder, options commentsCommandOptions, threadID, cursor, sessionID string, emitted int) (int, bool, error) {
	lastCursor := strings.TrimSpace(cursor)
	renewInterval := workRenewInterval(options)
	nextRenew := time.Now().UTC().Add(renewInterval)
	renewSequence := 0
	for {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), threadID)
		if err != nil {
			return emitted, false, err
		}
		deliver := activitiesAfterCursor(activities, lastCursor)
		if len(deliver) > 0 {
			cursor := deliver[len(deliver)-1].ID
			snapshots, err := commentSnapshotsForActivities(ctx, options, threadID, deliver)
			if err != nil {
				return emitted, false, err
			}
			context, err := commentBatchContext(ctx, options, threadID, snapshots.Thread)
			if err != nil {
				return emitted, false, err
			}
			event := commentFollowEvent{
				Type:               "comment_thread_activity_batch",
				SchemaVersion:      commentsStreamSchemaVersion,
				EventSchema:        "commentActivityBatchEvent",
				EventSchemaCommand: commentSchemaCommandArgs("commentActivityBatchEvent"),
				SessionID:          sessionID,
				Sequence:           emitted + 1,
				Reason:             "activity_changed",
				ThreadID:           threadID,
				Cursor:             cursor,
				EmittedAt:          time.Now().UTC().Format(time.RFC3339Nano),
				Count:              len(deliver),
				Summary:            summarizeActivityBatch(deliver, options.ActorID, threadID, commentBodiesByID(snapshots.Comments), options.URL, options.ReceiptLog),
				Activities:         deliver,
				Comments:           snapshots.Comments,
				File:               context.File,
				Source:             context.Source,
				Diff:               context.Diff,
			}
			if err := encoder.Encode(event); err != nil {
				return emitted, false, err
			}
			lastCursor = cursor
			emitted++
			terminal := hasTerminalThreadStatus(deliver)
			if reachedWatchMaxEvents(options, emitted) {
				return emitted, terminal, nil
			}
			if terminal {
				return emitted, true, nil
			}
		}
		if renewInterval > 0 && !time.Now().UTC().Before(nextRenew) {
			renewSequence++
			renewOptions := options
			renewOptions.ClientEventID = workRenewClientEventID(options, threadID, renewSequence)
			if _, _, err := claimCommentThread(ctx, renewOptions, threadID); err != nil {
				return emitted, false, err
			}
			nextRenew = time.Now().UTC().Add(renewInterval)
			continue
		}
		if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
			return emitted, false, err
		}
	}
}

func reachedWatchMaxEvents(options commentsCommandOptions, emitted int) bool {
	return options.WatchMaxEvents > 0 && emitted >= options.WatchMaxEvents
}

func commentSnapshotsForActivities(ctx context.Context, options commentsCommandOptions, threadID string, activities []commentActivityOutput) (commentActivitySnapshots, error) {
	needsComments := false
	wanted := map[string]bool{}
	order := []string{}
	for _, activity := range activities {
		if (activity.Type == "comment_added" || activity.Type == "comment_updated") && strings.TrimSpace(activity.CommentID) != "" {
			needsComments = true
			if !wanted[activity.CommentID] {
				wanted[activity.CommentID] = true
				order = append(order, activity.CommentID)
			}
		}
	}
	if !needsComments {
		return commentActivitySnapshots{}, nil
	}
	thread, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return commentActivitySnapshots{}, err
	}
	byID := map[string]commentOutput{}
	for _, comment := range thread.Comments {
		if wanted[comment.ID] {
			byID[comment.ID] = comment
		}
	}
	comments := []commentOutput{}
	for _, id := range order {
		if comment, ok := byID[id]; ok {
			comments = append(comments, comment)
		}
	}
	return commentActivitySnapshots{Thread: &thread, Comments: comments}, nil
}

func commentBodiesByID(comments []commentOutput) map[string]string {
	if len(comments) == 0 {
		return nil
	}
	bodies := map[string]string{}
	for _, comment := range comments {
		bodies[comment.ID] = comment.Body
	}
	return bodies
}

func commentBatchContext(ctx context.Context, options commentsCommandOptions, threadID string, thread *commentThreadOutput) (commentBatchContextOutput, error) {
	context := commentBatchContextOutput{}
	if !options.WithContext && !options.WithDiff {
		return context, nil
	}
	if thread == nil {
		fetched, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
		if err != nil {
			return commentBatchContextOutput{}, err
		}
		thread = &fetched
	}
	if options.WithContext {
		payload, err := contextPayloadForThread(ctx, options, *thread)
		if err != nil {
			return commentBatchContextOutput{}, err
		}
		context.File = payload.File
		context.Source = &payload.Source
		context.Diff = payload.Diff
	}
	if options.WithDiff && context.Diff == nil {
		diff, err := fetchTextDiff(ctx, withoutReadHeaders(options), thread.Path)
		if err != nil {
			return commentBatchContextOutput{}, err
		}
		context.Diff = &diff
	}
	return context, nil
}

func summarizeActivityBatch(activities []commentActivityOutput, actorID string, threadID string, commentBodies map[string]string, serverURL string, receiptLog string) commentActivityBatchSummary {
	summary := commentActivityBatchSummary{}
	kinds := map[string]bool{}
	attentionReasons := map[string]bool{}
	ownActorID := strings.TrimSpace(actorID)
	for _, activity := range activities {
		isOwn := ownActorID != "" && activity.Actor.ID == ownActorID
		if isOwn {
			summary.OwnActivityCount++
		} else {
			summary.ExternalActivityCount++
		}
		switch activity.Type {
		case "comment_added":
			isTriage := isTriageCommentBody(commentBodies[activity.CommentID])
			if isTriage {
				summary.TriageCommentCount++
				kinds["triage_comment"] = true
				if isOwn {
					summary.OwnTriageCommentCount++
					kinds["own_triage_comment"] = true
				} else {
					summary.ExternalTriageCommentCount++
					attentionReasons["external_triage_comment"] = true
				}
			}
			if isOwn {
				summary.OwnCommentCount++
				kinds["own_comment"] = true
				if activity.Actor.Kind == "human" {
					summary.HumanCommentCount++
					kinds["human_comment"] = true
				} else {
					summary.AgentCommentCount++
					kinds["agent_comment"] = true
				}
			} else if activity.Actor.Kind == "human" {
				summary.HumanCommentCount++
				summary.ExternalCommentCount++
				kinds["human_comment"] = true
				attentionReasons["external_human_comment"] = true
			} else {
				summary.ExternalAgentCommentCount++
				summary.ExternalCommentCount++
				summary.AgentCommentCount++
				kinds["agent_comment"] = true
				attentionReasons["external_agent_comment"] = true
			}
		case "comment_updated":
			summary.CommentUpdateCount++
			kinds["comment_update"] = true
			if !isOwn {
				attentionReasons["external_comment_update"] = true
			}
		case "thread_claimed":
			summary.ClaimCount++
			if isOwn {
				summary.OwnClaimCount++
				kinds["own_claim"] = true
			} else {
				summary.ExternalClaimCount++
				attentionReasons["external_claim"] = true
			}
			kinds["claim"] = true
		case "thread_claim_released":
			summary.ReleaseCount++
			if isOwn {
				summary.OwnReleaseCount++
				kinds["own_claim_release"] = true
			} else {
				summary.ExternalReleaseCount++
				attentionReasons["external_claim_release"] = true
			}
			kinds["claim_release"] = true
		case "thread_status_changed":
			summary.StatusChangeCount++
			if isOwn {
				summary.OwnStatusChangeCount++
			} else {
				summary.ExternalStatusChangeCount++
				attentionReasons["external_status_change"] = true
			}
			kinds["status_change"] = true
			switch activity.Status {
			case "resolved", "archived":
				summary.TerminalStatus = activity.Status
				kinds["terminal_status"] = true
				attentionReasons["terminal_status"] = true
			}
		case "thread_read":
			summary.ReadCount++
			kinds["read"] = true
		case "thread_created":
			summary.ThreadCreatedCount++
			kinds["thread_created"] = true
		default:
			kinds["other"] = true
		}
	}
	for kind := range kinds {
		summary.Kinds = append(summary.Kinds, kind)
	}
	for reason := range attentionReasons {
		summary.AttentionReasons = append(summary.AttentionReasons, reason)
	}
	sort.Strings(summary.Kinds)
	sort.Strings(summary.AttentionReasons)
	summary.RequiresAttention = hasNonTerminalAttentionReason(summary.AttentionReasons)
	summary.RecommendedAction = recommendedActivityBatchAction(summary)
	summary.SuggestedCommands = suggestedCommandsForActivityBatch(summary, strings.TrimSpace(actorID), strings.TrimSpace(threadID), latestActivityID(activities), serverURL, receiptLog)
	return summary
}

func summarizeClaimedWork(thread commentThreadOutput, claim commentActivityOutput, actorID string, serverURL string, receiptLog string, sourceUnavailable bool) commentActivityBatchSummary {
	summary := commentActivityBatchSummary{
		Kinds:             []string{"claimed_work"},
		AttentionReasons:  []string{"claimed_open_thread"},
		RequiresAttention: true,
		RecommendedAction: "start_work",
		ClaimCount:        1,
	}
	if strings.TrimSpace(actorID) != "" && claim.Actor.ID == strings.TrimSpace(actorID) {
		summary.OwnActivityCount = 1
		summary.OwnClaimCount = 1
		summary.Kinds = append(summary.Kinds, "own_claim")
	} else {
		summary.ExternalActivityCount = 1
		summary.ExternalClaimCount = 1
		summary.Kinds = append(summary.Kinds, "claim")
	}
	for _, comment := range thread.Comments {
		if comment.CreatedBy.Kind == "human" {
			summary.HumanCommentCount++
			summary.ExternalCommentCount++
			continue
		}
		summary.AgentCommentCount++
		summary.ExternalAgentCommentCount++
		summary.ExternalCommentCount++
		if isTriageCommentBody(comment.Body) {
			summary.TriageCommentCount++
			summary.ExternalTriageCommentCount++
		}
	}
	if summary.HumanCommentCount > 0 {
		summary.Kinds = append(summary.Kinds, "human_comment")
	}
	if summary.AgentCommentCount > 0 {
		summary.Kinds = append(summary.Kinds, "agent_comment")
	}
	if summary.TriageCommentCount > 0 {
		summary.Kinds = append(summary.Kinds, "triage_comment")
	}
	if sourceUnavailable {
		summary.AttentionReasons = append(summary.AttentionReasons, "source_unavailable")
		summary.RecommendedAction = "handle_source_unavailable"
	}
	sort.Strings(summary.Kinds)
	sort.Strings(summary.AttentionReasons)
	summary.SuggestedCommands = suggestedCommandsForActivityBatch(summary, strings.TrimSpace(actorID), thread.ID, claim.ID, serverURL, receiptLog)
	return summary
}

func latestActivityID(activities []commentActivityOutput) string {
	for index := len(activities) - 1; index >= 0; index-- {
		if strings.TrimSpace(activities[index].ID) != "" {
			return activities[index].ID
		}
	}
	return ""
}

func summarizeOpenWorklist(threads []commentThreadOutput, actorID string, cursor string, serverURL string, receiptLog string) commentOpenWorklistSummary {
	summary := commentOpenWorklistSummary{
		AttentionReasons:  []string{},
		OpenThreadCount:   len(threads),
		RecommendedAction: "wait_for_open_work",
	}
	if len(threads) == 0 {
		return summary
	}
	summary.RequiresAttention = true
	summary.AttentionReasons = []string{"open_threads_available"}
	summary.RecommendedAction = "claim_open_work"
	summary.SuggestedCommands = suggestedCommandsForOpenWorklist(strings.TrimSpace(actorID), cursor, serverURL, receiptLog)
	return summary
}

func suggestedCommandsForOpenWorklist(actorID string, cursor string, serverURL string, receiptLog string) []commentSuggestedCommand {
	if actorID == "" {
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_open_worklist", "comments list", withURLArg([]string{"comments", "list", "--status", "open", "--full", "--json"}, serverURL), "", "Inspect open threads before choosing an actor-specific claim command."),
		}
	}
	clientEventID := commentSuggestedClientEventID("watch", cursor, "claim")
	return []commentSuggestedCommand{
		suggestedCommentsCommandWithClientEventID("claim_next_open_thread", "comments work", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "work", "--actor", actorID, "--full", "--json"}), serverURL, receiptLog), "", "Claim the next open thread and receive a self-describing work event.", clientEventID),
	}
}

func isTriageCommentBody(body string) bool {
	return strings.HasPrefix(strings.TrimSpace(body), "Triage:")
}

func hasNonTerminalAttentionReason(reasons []string) bool {
	for _, reason := range reasons {
		if reason != "terminal_status" {
			return true
		}
	}
	return false
}

func recommendedActivityBatchAction(summary commentActivityBatchSummary) string {
	if summary.TerminalStatus != "" {
		return "finish_current_work"
	}
	if summary.ExternalTriageCommentCount > 0 {
		return "inspect_external_activity"
	}
	if summary.ExternalCommentCount > 0 || hasAttentionReason(summary, "external_comment_update") {
		return "reconsider_work"
	}
	if summary.ExternalClaimCount > 0 || summary.ExternalReleaseCount > 0 || summary.ExternalStatusChangeCount > 0 {
		return "inspect_external_activity"
	}
	if summary.OwnClaimCount > 0 && summary.ExternalActivityCount == 0 && summary.OwnActivityCount == summary.OwnClaimCount {
		return "ignore_own_heartbeat"
	}
	if summary.OwnActivityCount > 0 && summary.ExternalActivityCount == 0 {
		return "ignore_own_activity"
	}
	return "observe"
}

func suggestedCommandsForActivityBatch(summary commentActivityBatchSummary, actorID string, threadID string, activitySeed string, serverURL string, receiptLog string) []commentSuggestedCommand {
	if threadID == "" {
		return nil
	}
	switch summary.RecommendedAction {
	case "handle_source_unavailable":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_source_unavailable_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the thread conversation because the referenced source path is unavailable in this workspace."),
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("handoff_after_source_unavailable", "comments release", withRuntimeArgs([]string{"comments", "release", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Report that the referenced source path is unavailable, then release the live claim for a better anchor or workspace.", suggestedWriteClientEventID("activity", threadID, "release-source-unavailable", activitySeed)),
			suggestedCommentsCommandWithClientEventID("archive_after_source_unavailable_decision", "comments dismiss", withRuntimeArgs([]string{"comments", "dismiss", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Archive the thread only after confirming the missing source means the feedback no longer applies.", suggestedWriteClientEventID("activity", threadID, "dismiss-source-unavailable", activitySeed)),
			suggestedCommentsCommand("inspect_source_unavailable_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--actor", actorID, "--json"}, serverURL), "", "Inspect the thread conversation without assuming the missing source file can be opened."),
		}
	case "start_work":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the claimed thread before replying."),
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("acknowledge_initial_feedback", "comments triage", withRuntimeArgs([]string{"comments", "triage", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured acknowledgement that the agent has started the claimed work.", suggestedWriteClientEventID("activity", threadID, "triage", activitySeed)),
			suggestedCommentsCommandWithClientEventID("handoff_after_blocked_or_needs_info", "comments release", withRuntimeArgs([]string{"comments", "release", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured blocked or needs-info handoff comment, then release the live claim for another attempt.", suggestedWriteClientEventID("activity", threadID, "release", activitySeed)),
			suggestedCommentsCommandWithClientEventID("complete_after_verification", "comments done", withRuntimeArgs([]string{"comments", "done", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Resolve the thread with structured verification after the fix is complete.", suggestedWriteClientEventID("activity", threadID, "done", activitySeed)),
			suggestedCommentsCommandWithClientEventID("archive_after_decision", "comments dismiss", withRuntimeArgs([]string{"comments", "dismiss", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Archive the thread with a structured explanation when the feedback is intentionally not fixed.", suggestedWriteClientEventID("activity", threadID, "dismiss", activitySeed)),
		}
	case "reconsider_work":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the latest thread before replying."),
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("acknowledge_follow_up", "comments triage", withRuntimeArgs([]string{"comments", "triage", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured non-terminal acknowledgement before continuing work.", suggestedWriteClientEventID("activity", threadID, "triage", activitySeed)),
			suggestedCommentsCommandWithClientEventID("handoff_after_blocked_or_needs_info", "comments release", withRuntimeArgs([]string{"comments", "release", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured blocked or needs-info handoff comment, then release the live claim for another attempt.", suggestedWriteClientEventID("activity", threadID, "release", activitySeed)),
			suggestedCommentsCommandWithClientEventID("complete_after_verification", "comments done", withRuntimeArgs([]string{"comments", "done", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Resolve the thread with structured verification after the fix is complete.", suggestedWriteClientEventID("activity", threadID, "done", activitySeed)),
			suggestedCommentsCommandWithClientEventID("archive_after_decision", "comments dismiss", withRuntimeArgs([]string{"comments", "dismiss", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Archive the thread with a structured explanation when the feedback is intentionally not fixed.", suggestedWriteClientEventID("activity", threadID, "dismiss", activitySeed)),
		}
	case "inspect_external_activity":
		args := []string{"comments", "show", threadID, "--json"}
		if actorID != "" {
			args = []string{"comments", "show", threadID, "--actor", actorID, "--json"}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_thread", "comments show", withURLArg(args, serverURL), "", "Inspect the latest thread state before deciding whether to continue, release, or stop."),
		}
	default:
		return nil
	}
}

func suggestedCommentsCommand(intent string, command string, args []string, stdinSchema string, reason string) commentSuggestedCommand {
	suggestion := commentSuggestedCommand{
		Intent:      intent,
		Command:     command,
		Args:        args,
		StdinSchema: stdinSchema,
		Reason:      reason,
	}
	if stdinSchema != "" {
		suggestion.StdinRequired = true
		suggestion.StdinSchemaCommand = []string{"comments", "schema", stdinSchema, "--json"}
		suggestion.StdinExample = suggestedCommandStdinExample(intent, command, stdinSchema)
	}
	return suggestion
}

func suggestedCommandStdinExample(intent string, command string, stdinSchema string) map[string]any {
	switch stdinSchema {
	case "commentTriageFileInput":
		if example := suggestedTriageStdinExample(intent, command); example != nil {
			return example
		}
	case "commentResultFileInput":
		if example := suggestedResultStdinExample(intent, command); example != nil {
			return example
		}
	}
	if schema, ok := commentSchemaByName(stdinSchema); ok && schema.Example != nil {
		return schema.Example
	}
	return nil
}

func suggestedTriageStdinExample(intent string, command string) map[string]any {
	switch {
	case strings.Contains(intent, "source_unavailable"):
		return map[string]any{
			"decision":   "blocked",
			"summary":    "The referenced source path is unavailable in this workspace.",
			"nextAction": "Ask for an updated anchor or dismiss the stale thread after confirming it no longer applies.",
			"details":    "- Source context is unavailable\n- No file change was made",
		}
	case command == "comments release" || strings.Contains(intent, "handoff"):
		return map[string]any{
			"decision":   "blocked",
			"summary":    "The agent cannot complete this feedback in the current run.",
			"nextAction": "Release the claim with this explanation so another attempt or human clarification can continue.",
			"details":    "- Current claim will be released\n- No terminal status change was made",
		}
	case strings.Contains(intent, "initial"):
		return map[string]any{
			"decision":   "fixing",
			"summary":    "I have claimed this feedback and am starting the fix.",
			"nextAction": "Inspect the referenced file, make the smallest safe change, and run the requested checks.",
			"details":    "- Claim is active\n- I will report verification with a structured result",
		}
	case strings.Contains(intent, "follow_up"):
		return map[string]any{
			"decision":   "fixing",
			"summary":    "I saw the new human follow-up and am incorporating it before finishing.",
			"nextAction": "Reconcile the follow-up with the current change, then rerun verification.",
			"details":    "- Follow-up feedback acknowledged\n- Existing claim remains active",
		}
	case intent == "acknowledge_feedback" || strings.Contains(intent, "acknowledge_or_request"):
		return map[string]any{
			"decision":   "accepted",
			"summary":    "I understand the feedback and will continue with this thread.",
			"nextAction": "Use the current claim context to decide whether to patch, ask a focused question, or hand off.",
			"details":    "- Feedback acknowledged\n- No terminal status change was made",
		}
	case strings.Contains(intent, "clarification"):
		return map[string]any{
			"decision":   "needs-info",
			"summary":    "I need one clarification before making a safe change.",
			"nextAction": "Ask the human for the missing target behavior or expected output.",
			"details":    "- Claim remains active until the question is answered or released",
		}
	default:
		return nil
	}
}

func suggestedResultStdinExample(intent string, command string) map[string]any {
	switch {
	case strings.Contains(intent, "source_unavailable"):
		return map[string]any{
			"summary":      "The feedback references source that is unavailable in this workspace, so it was archived as stale after review.",
			"verification": []string{"Confirmed the referenced source context is unavailable"},
			"details":      "- No code change was made\n- Archived with an explicit missing-source explanation",
		}
	case command == "comments dismiss" || strings.Contains(intent, "archive"):
		return map[string]any{
			"summary":      "The feedback was reviewed and intentionally archived without a code change.",
			"verification": []string{"Confirmed the requested change is not applicable in this workspace state"},
			"details":      "- Archived with an explicit agent explanation",
		}
	case command == "comments done" || strings.Contains(intent, "complete"):
		return map[string]any{
			"summary":      "Implemented the requested change and verified the result.",
			"verification": []string{"Ran the focused test for the changed behavior", "Ran task check"},
			"details":      "- Resolved with a structured verification summary",
		}
	default:
		return nil
	}
}

func suggestedCommentsCommandWithClientEventID(intent string, command string, args []string, stdinSchema string, reason string, clientEventID string) commentSuggestedCommand {
	suggestion := suggestedCommentsCommand(intent, command, withClientEventIDArg(args, clientEventID), stdinSchema, reason)
	suggestion.ClientEventID = clientEventID
	return suggestion
}

func withClientEventIDArg(args []string, clientEventID string) []string {
	clientEventID = strings.TrimSpace(clientEventID)
	if clientEventID == "" {
		return args
	}
	next := make([]string, 0, len(args)+2)
	inserted := false
	for _, arg := range args {
		if !inserted && arg == "--json" {
			next = append(next, "--client-event-id", clientEventID)
			inserted = true
		}
		next = append(next, arg)
	}
	if !inserted {
		next = append(next, "--client-event-id", clientEventID)
	}
	return next
}

func withReceiptLogArg(args []string, receiptLog string) []string {
	receiptLog = strings.TrimSpace(receiptLog)
	if receiptLog == "" {
		return args
	}
	for _, arg := range args {
		if arg == "--receipt-log" {
			return args
		}
	}
	next := make([]string, 0, len(args)+2)
	inserted := false
	for _, arg := range args {
		if !inserted && arg == "--json" {
			next = append(next, "--receipt-log", receiptLog)
			inserted = true
		}
		next = append(next, arg)
	}
	if !inserted {
		next = append(next, "--receipt-log", receiptLog)
	}
	return next
}

func withRuntimeArgs(args []string, serverURL string, receiptLog string) []string {
	return withURLArg(withReceiptLogArg(args, receiptLog), serverURL)
}

func withURLArg(args []string, serverURL string) []string {
	serverURL = strings.TrimSpace(serverURL)
	if serverURL == "" {
		return args
	}
	for _, arg := range args {
		if arg == "--url" {
			return args
		}
	}
	next := make([]string, 0, len(args)+2)
	inserted := false
	for _, arg := range args {
		if !inserted && arg == "--json" {
			next = append(next, "--url", serverURL)
			inserted = true
		}
		next = append(next, arg)
	}
	if !inserted {
		next = append(next, "--url", serverURL)
	}
	return next
}

func commentSuggestedClientEventID(parts ...string) string {
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		part = strings.NewReplacer(" ", "-", "\t", "-", "\n", "-", "\r", "-").Replace(part)
		clean = append(clean, part)
	}
	if len(clean) == 0 {
		return ""
	}
	return strings.Join(clean, ":")
}

func suggestedWriteClientEventID(source string, threadID string, intent string, seed string) string {
	return commentSuggestedClientEventID(source, threadID, intent, seed)
}

func hasAttentionReason(summary commentActivityBatchSummary, reason string) bool {
	for _, candidate := range summary.AttentionReasons {
		if candidate == reason {
			return true
		}
	}
	return false
}

func hasTerminalThreadStatus(activities []commentActivityOutput) bool {
	for _, activity := range activities {
		if activity.Type != "thread_status_changed" {
			continue
		}
		switch activity.Status {
		case "resolved", "archived":
			return true
		}
	}
	return false
}

func newCommentsStreamSessionID(options commentsCommandOptions, command string) string {
	seed := fmt.Sprintf("%s|%s|%s|%d", strings.TrimSpace(command), strings.TrimSpace(options.ActorID), strings.TrimSpace(options.ClientEventID), time.Now().UTC().UnixNano())
	sum := sha256.Sum256([]byte(seed))
	return fmt.Sprintf("comments-%s-%s", command, hex.EncodeToString(sum[:])[:12])
}

func workRenewInterval(options commentsCommandOptions) time.Duration {
	if options.RenewInterval > 0 {
		return options.RenewInterval
	}
	if options.LeaseDuration <= 0 {
		return 0
	}
	interval := options.LeaseDuration / 2
	if interval > 2*time.Minute {
		return 2 * time.Minute
	}
	return interval
}

func workRenewClientEventID(options commentsCommandOptions, threadID string, sequence int) string {
	base := strings.TrimSpace(options.ClientEventID)
	if base == "" {
		base = "comments-work:" + strings.TrimSpace(threadID)
	}
	return fmt.Sprintf("%s:renew:%d", base, sequence)
}

func commentClaimPayload(ctx context.Context, options commentsCommandOptions, threadID string) (map[string]any, bool, error) {
	probeOptions := withoutReadHeaders(options)
	var ordered []commentThreadOutput
	var cursor string
	if strings.TrimSpace(threadID) != "" {
		thread, err := fetchCommentThreadByID(ctx, probeOptions, threadID)
		if err != nil {
			return nil, false, err
		}
		ordered = []commentThreadOutput{thread}
		cursor = commentThreadsCursor(ordered)
	} else {
		threads, fetchedCursor, err := fetchCommentThreads(ctx, probeOptions, "open")
		if err != nil {
			return nil, false, err
		}
		ordered = orderCommentThreadsForAgent(threads)
		cursor = fetchedCursor
	}
	payload := map[string]any{
		"thread":    nil,
		"claim":     nil,
		"cursor":    cursor,
		"count":     len(ordered),
		"remaining": 0,
	}
	var selected *commentThreadOutput
	var claim *commentActivityOutput
	var selectedItem *commentWorkItemOutput
	var lastClaimErr error
	for index, candidate := range ordered {
		if strings.TrimSpace(threadID) == "" && options.WithContext && index < len(ordered)-1 {
			item, err := commentWorkItemForThread(ctx, withoutReadHeaders(options), candidate)
			if err != nil {
				return nil, false, err
			}
			if sourceContextUnavailable(item) {
				continue
			}
		}
		claimedThread, activity, err := claimCommentThread(ctx, options, candidate.ID)
		if err != nil {
			lastClaimErr = err
			if strings.TrimSpace(threadID) == "" && strings.Contains(err.Error(), "already claimed") {
				continue
			}
			return nil, false, err
		}
		selected = &claimedThread
		claim = &activity
		payload["thread"] = selected
		payload["claim"] = claim
		payload["remaining"] = len(ordered) - index - 1
		break
	}
	if selected == nil && strings.TrimSpace(threadID) != "" && lastClaimErr != nil {
		return nil, false, lastClaimErr
	}
	if options.WithContext {
		payload["file"] = nil
		payload["source"] = nil
	}
	if options.WithDiff {
		payload["diff"] = nil
	}
	if options.WithActivities {
		payload["activities"] = nil
	}
	if commentsNeedsWorkItem(options) && selected != nil {
		item, err := commentWorkItemForThread(ctx, withoutReadHeaders(options), *selected)
		if err != nil {
			return nil, false, err
		}
		selectedItem = &item
		if options.WithContext {
			payload["file"] = item.File
			payload["source"] = item.Source
		}
		if options.WithDiff {
			payload["diff"] = item.Diff
		}
		if options.WithActivities {
			payload["activities"] = item.Activities
		}
	}
	if selected != nil && claim != nil {
		payload["summary"] = summarizeClaimedWork(*selected, *claim, options.ActorID, options.URL, options.ReceiptLog, selectedItem != nil && sourceContextUnavailable(*selectedItem))
		outputThread := limitCommentThreadHistory(*selected, options.CommentLimit)
		payload["thread"] = &outputThread
	}
	if selected == nil {
		routing, err := commentOpenRouting(ctx, withoutReadHeaders(options), ordered, options.ActorID)
		if err != nil {
			return nil, false, err
		}
		payload["summary"] = summarizeOpenRouting(routing, options.ActorID, cursor, "claim", options.URL, options.ReceiptLog)
	}
	return payload, selected != nil, nil
}

func commentsMine(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	threads, cursor, err := fetchCommentThreads(ctx, withoutReadHeaders(options), "open")
	if err != nil {
		return err
	}
	ordered := orderCommentThreadsForAgent(threads)
	mine := []commentThreadOutput{}
	claims := []commentActivityOutput{}
	for _, thread := range ordered {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), thread.ID)
		if err != nil {
			return err
		}
		claim := activeClaimForActor(activities, options.ActorID, time.Now().UTC())
		if claim == nil {
			continue
		}
		mine = append(mine, thread)
		claims = append(claims, *claim)
	}
	outputMine := limitCommentThreadsHistory(mine, options.CommentLimit)
	group := commentInboxGroupOutput{Threads: outputMine, Claims: claims, Count: len(mine)}
	payload := map[string]any{
		"actor":   actorInput(options),
		"threads": outputMine,
		"claims":  claims,
		"count":   len(mine),
		"cursor":  cursor,
		"summary": summarizeOwnedRoutingRecovery(group, options.ActorID, "mine", options.URL, options.ReceiptLog),
	}
	if commentsNeedsWorkItem(options) {
		items, err := commentWorkItemsForThreads(ctx, withoutReadHeaders(options), mine)
		if err != nil {
			return err
		}
		group.Items = items
		payload["items"] = items
	}
	return writeJSON(stdout, payload)
}

func commentsInbox(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	threads, cursor, err := fetchCommentThreads(ctx, withoutReadHeaders(options), "open")
	if err != nil {
		return err
	}
	ordered := orderCommentThreadsForAgent(threads)
	routing, err := commentOpenRouting(ctx, withoutReadHeaders(options), ordered, options.ActorID)
	if err != nil {
		return err
	}
	if commentsNeedsWorkItem(options) {
		if routing.Mine.Items, err = commentWorkItemsForThreads(ctx, withoutReadHeaders(options), routing.Mine.Threads); err != nil {
			return err
		}
		if routing.Unclaimed.Items, err = commentWorkItemsForThreads(ctx, withoutReadHeaders(options), routing.Unclaimed.Threads); err != nil {
			return err
		}
		if routing.ClaimedByOthers.Items, err = commentWorkItemsForThreads(ctx, withoutReadHeaders(options), routing.ClaimedByOthers.Threads); err != nil {
			return err
		}
	}
	outputRouting := limitCommentOpenRoutingHistory(routing, options.CommentLimit)
	payload := map[string]any{
		"schemaVersion":     commentsStreamSchemaVersion,
		"schemaCommand":     commentSchemaCommandArgs("commentInboxOutput"),
		"actor":             actorInput(options),
		"cursor":            cursor,
		"count":             len(ordered),
		"summary":           summarizeOpenRouting(routing, options.ActorID, cursor, "inbox", options.URL, options.ReceiptLog),
		"mine":              outputRouting.Mine,
		"unclaimed":         outputRouting.Unclaimed,
		"claimedByOthers":   outputRouting.ClaimedByOthers,
		"sourceUnavailable": outputRouting.SourceUnavailable,
	}
	return writeJSON(stdout, payload)
}

func summarizeOpenRouting(routing commentOpenRoutingOutput, actorID string, cursor string, clientEventScope string, serverURL string, receiptLog string) commentRoutingSummary {
	actionableOpenThreadCount := routing.Mine.Count + routing.Unclaimed.Count + routing.ClaimedByOthers.Count
	summary := commentRoutingSummary{
		RequiresAttention:      false,
		AttentionReasons:       []string{},
		RecommendedAction:      "wait_for_gui_feedback",
		TotalOpenThreadCount:   actionableOpenThreadCount + routing.SourceUnavailable.Count,
		OpenThreadCount:        actionableOpenThreadCount,
		SourceUnavailableCount: routing.SourceUnavailable.Count,
		MineCount:              routing.Mine.Count,
		UnclaimedCount:         routing.Unclaimed.Count,
		ClaimedByOthersCount:   routing.ClaimedByOthers.Count,
	}
	actorID = strings.TrimSpace(actorID)
	if routing.Mine.Count > 0 {
		summary.RequiresAttention = true
		summary.AttentionReasons = []string{"owned_live_claims"}
		summary.RecommendedAction = "resume_owned_work"
		summary.SuggestedCommands = suggestedCommandsForOwnedRoutingWork(routing.Mine, actorID, clientEventScope, serverURL, receiptLog)
		return summary
	}
	if routing.Unclaimed.Count > 0 {
		summary.RequiresAttention = true
		summary.AttentionReasons = []string{"unclaimed_open_threads"}
		summary.RecommendedAction = "claim_open_work"
		summary.SuggestedCommands = suggestedCommandsForOpenWorklist(actorID, cursor, serverURL, receiptLog)
		return summary
	}
	if routing.ClaimedByOthers.Count > 0 {
		summary.RequiresAttention = true
		summary.AttentionReasons = []string{"open_threads_claimed_by_others"}
		summary.RecommendedAction = "wait_for_claim_release"
		summary.SuggestedCommands = []commentSuggestedCommand{
			suggestedCommentsCommand("watch_open_worklist", "comments watch", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "watch", "--actor", actorID, "--full", "--cursor", cursor, "--json"}), serverURL, receiptLog), "", "Watch for a new unclaimed thread or a claim release before trying to claim again."),
		}
		return summary
	}
	summary.SuggestedCommands = []commentSuggestedCommand{
		suggestedCommentsCommand("start_resident_work_loop", "comments work", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "work", "--actor", actorID, "--wait", "--loop", "--idle-events", "--full", "--json"}), serverURL, receiptLog), "", "Wait for the next GUI feedback item and claim it as owned work."),
	}
	return summary
}

func summarizeOwnedRoutingRecovery(group commentInboxGroupOutput, actorID string, clientEventScope string, serverURL string, receiptLog string) commentRoutingSummary {
	summary := commentRoutingSummary{
		RequiresAttention:      false,
		AttentionReasons:       []string{},
		RecommendedAction:      "wait_for_gui_feedback",
		TotalOpenThreadCount:   group.Count,
		OpenThreadCount:        group.Count,
		SourceUnavailableCount: 0,
		MineCount:              group.Count,
		UnclaimedCount:         0,
		ClaimedByOthersCount:   0,
	}
	actorID = strings.TrimSpace(actorID)
	if group.Count > 0 {
		summary.RequiresAttention = true
		summary.AttentionReasons = []string{"owned_live_claims"}
		summary.RecommendedAction = "resume_owned_work"
		summary.SuggestedCommands = suggestedCommandsForOwnedRoutingWork(group, actorID, clientEventScope, serverURL, receiptLog)
	}
	return summary
}

func suggestedCommandsForOwnedRoutingWork(group commentInboxGroupOutput, actorID string, clientEventScope string, serverURL string, receiptLog string) []commentSuggestedCommand {
	if len(group.Threads) == 0 {
		return nil
	}
	threadID := strings.TrimSpace(group.Threads[0].ID)
	if threadID == "" {
		return nil
	}
	return []commentSuggestedCommand{
		suggestedCommentsCommandWithClientEventID("renew_owned_claim", "comments renew", withURLArg([]string{"comments", "renew", threadID, "--actor", actorID, "--json"}, serverURL), "", "Refresh the recovered live claim before continuing work after an adapter restart.", commentSuggestedClientEventID(clientEventScope, threadID, "renew")),
		suggestedCommentsCommand("follow_owned_thread", "comments follow", withRuntimeArgs([]string{"comments", "follow", threadID, "--actor", actorID, "--full", "--json"}, serverURL, receiptLog), "", "Resume watching human follow-up and lifecycle activity for the recovered owned thread."),
		suggestedCommentsCommand("check_owned_thread", "comments check", withRuntimeArgs([]string{"comments", "check", threadID, "--actor", actorID, "--full", "--json"}, serverURL, receiptLog), "", "Inspect live ownership and guarded-write suggestions before replying or closing the recovered thread."),
	}
}

func commentsBatch(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	threads, _, err := fetchCommentThreads(ctx, withoutReadHeaders(options), "")
	if err != nil {
		return err
	}
	ordered := orderCommentThreadsForAgent(threads)
	cursor := scopedCommentThreadsCursor("batch", ordered)
	statusCounts := commentStatusCounts(ordered)
	openThreads := make([]commentThreadOutput, 0, len(ordered))
	for _, thread := range ordered {
		if thread.Status == "open" {
			openThreads = append(openThreads, thread)
		}
	}
	routing, err := commentOpenRouting(ctx, withoutReadHeaders(options), openThreads, options.ActorID)
	if err != nil {
		return err
	}
	if commentsNeedsWorkItem(options) {
		if routing.Mine.Items, err = commentWorkItemsForThreads(ctx, withoutReadHeaders(options), routing.Mine.Threads); err != nil {
			return err
		}
		if routing.Unclaimed.Items, err = commentWorkItemsForThreads(ctx, withoutReadHeaders(options), routing.Unclaimed.Threads); err != nil {
			return err
		}
		if routing.ClaimedByOthers.Items, err = commentWorkItemsForThreads(ctx, withoutReadHeaders(options), routing.ClaimedByOthers.Threads); err != nil {
			return err
		}
	}
	outputThreads := limitCommentThreadsHistory(ordered, options.CommentLimit)
	outputRouting := limitCommentOpenRoutingHistory(routing, options.CommentLimit)
	payload := map[string]any{
		"reviewBatchId": strings.TrimSpace(options.ReviewBatchID),
		"actor":         actorInput(options),
		"cursor":        cursor,
		"count":         len(ordered),
		"summary": map[string]any{
			"total":    len(ordered),
			"open":     statusCounts["open"],
			"resolved": statusCounts["resolved"],
			"archived": statusCounts["archived"],
			"complete": statusCounts["open"] == 0,
		},
		"threads": outputThreads,
		"open": map[string]any{
			"count":             len(openThreads),
			"summary":           summarizeOpenRouting(routing, options.ActorID, cursor, "batch", options.URL, options.ReceiptLog),
			"mine":              outputRouting.Mine,
			"unclaimed":         outputRouting.Unclaimed,
			"claimedByOthers":   outputRouting.ClaimedByOthers,
			"sourceUnavailable": outputRouting.SourceUnavailable,
		},
	}
	if commentsNeedsWorkItem(options) {
		items, err := commentWorkItemsForThreads(ctx, withoutReadHeaders(options), ordered)
		if err != nil {
			return err
		}
		payload["items"] = items
	}
	return writeJSON(stdout, payload)
}

func commentOpenRouting(ctx context.Context, options commentsCommandOptions, ordered []commentThreadOutput, actorID string) (commentOpenRoutingOutput, error) {
	now := time.Now().UTC()
	routing := commentOpenRoutingOutput{
		Mine:              commentInboxGroupOutput{Threads: []commentThreadOutput{}, Claims: []commentActivityOutput{}},
		Unclaimed:         commentInboxGroupOutput{Threads: []commentThreadOutput{}},
		ClaimedByOthers:   commentInboxGroupOutput{Threads: []commentThreadOutput{}, Claims: []commentActivityOutput{}},
		SourceUnavailable: commentInboxGroupOutput{Threads: []commentThreadOutput{}, Claims: []commentActivityOutput{}},
	}
	for _, thread := range ordered {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), thread.ID)
		if err != nil {
			return commentOpenRoutingOutput{}, err
		}
		claim := activeClaim(activities, now)
		if claim == nil {
			available, err := commentThreadSourceAvailable(ctx, options, thread)
			if err != nil {
				return commentOpenRoutingOutput{}, err
			}
			if !available {
				routing.SourceUnavailable.Threads = append(routing.SourceUnavailable.Threads, thread)
				continue
			}
			routing.Unclaimed.Threads = append(routing.Unclaimed.Threads, thread)
			continue
		}
		if claim.Actor.ID == strings.TrimSpace(actorID) {
			routing.Mine.Threads = append(routing.Mine.Threads, thread)
			routing.Mine.Claims = append(routing.Mine.Claims, *claim)
			continue
		}
		available, err := commentThreadSourceAvailable(ctx, options, thread)
		if err != nil {
			return commentOpenRoutingOutput{}, err
		}
		if !available {
			routing.SourceUnavailable.Threads = append(routing.SourceUnavailable.Threads, thread)
			routing.SourceUnavailable.Claims = append(routing.SourceUnavailable.Claims, *claim)
			continue
		}
		routing.ClaimedByOthers.Threads = append(routing.ClaimedByOthers.Threads, thread)
		routing.ClaimedByOthers.Claims = append(routing.ClaimedByOthers.Claims, *claim)
	}
	routing.Mine.Count = len(routing.Mine.Threads)
	routing.Unclaimed.Count = len(routing.Unclaimed.Threads)
	routing.ClaimedByOthers.Count = len(routing.ClaimedByOthers.Threads)
	routing.SourceUnavailable.Count = len(routing.SourceUnavailable.Threads)
	return routing, nil
}

func commentThreadSourceAvailable(ctx context.Context, options commentsCommandOptions, thread commentThreadOutput) (bool, error) {
	probeOptions := withoutReadHeaders(options)
	probeOptions.WithContext = true
	probeOptions.WithDiff = false
	probeOptions.WithActivities = false
	item, err := commentWorkItemForThread(ctx, probeOptions, thread)
	if err != nil {
		return false, err
	}
	return !sourceContextUnavailable(item), nil
}

func commentStatusCounts(threads []commentThreadOutput) map[string]int {
	counts := map[string]int{"open": 0, "resolved": 0, "archived": 0}
	for _, thread := range threads {
		counts[thread.Status]++
	}
	return counts
}

func commentsRelease(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	var comment *commentOutput
	var triage *commentTriageOutput
	if strings.TrimSpace(options.TriageDecision) != "" {
		triagePayload, err := commentTriagePayload(options)
		if err != nil {
			return err
		}
		if err := requireActorLiveClaim(ctx, options, threadID); err != nil {
			return err
		}
		added, err := addCommentToThread(ctx, options, threadID, triagePayload.Body)
		if err != nil {
			return err
		}
		comment = &added
		triage = &triagePayload
	} else if strings.TrimSpace(options.Body) != "" {
		if err := requireActorLiveClaim(ctx, options, threadID); err != nil {
			return err
		}
		added, err := addCommentToThread(ctx, options, threadID, options.Body)
		if err != nil {
			return err
		}
		comment = &added
	} else if err := ensureActorHasLiveClaim(ctx, options, threadID); err != nil {
		return err
	}
	thread, activity, err := releaseCommentThreadClaim(ctx, options, threadID)
	if err != nil {
		return err
	}
	outputThread := limitCommentThreadHistory(thread, options.CommentLimit)
	payload := map[string]any{"thread": outputThread, "release": activity}
	if triage != nil {
		payload["triage"] = triage
	}
	if comment != nil {
		payload["comment"] = comment
	}
	receipt, err := commentWriteReceiptFor(ctx, options, "comments release", threadID, comment, "")
	if err != nil {
		return err
	}
	receipt.Effects = appendReceiptEffect(receipt.Effects, activity)
	if err := appendCommentWriteReceiptLog(options.ReceiptLog, receipt); err != nil {
		return fmt.Errorf("append --receipt-log: %w", err)
	}
	payload["receipt"] = receipt
	if options.WithActivities {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), thread.ID)
		if err != nil {
			return err
		}
		payload["activities"] = limitCommentActivities(activities, options.ActivityLimit)
	}
	return writeJSON(stdout, payload)
}

func commentsRenew(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	thread, activity, err := claimCommentThread(ctx, options, threadID)
	if err != nil {
		return err
	}
	outputThread := limitCommentThreadHistory(thread, options.CommentLimit)
	payload := map[string]any{"thread": outputThread, "renewal": activity}
	if options.WithContext {
		payload["file"] = nil
		payload["source"] = nil
	}
	if options.WithDiff {
		payload["diff"] = nil
	}
	if options.WithActivities {
		payload["activities"] = nil
	}
	if commentsNeedsWorkItem(options) {
		item, err := commentWorkItemForThread(ctx, withoutReadHeaders(options), thread)
		if err != nil {
			return err
		}
		if options.WithContext {
			payload["file"] = item.File
			payload["source"] = item.Source
		}
		if options.WithDiff {
			payload["diff"] = item.Diff
		}
		if options.WithActivities {
			payload["activities"] = item.Activities
		}
	}
	return writeJSON(stdout, payload)
}

func commentsHold(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	emitted := 0
	for {
		sequence := emitted + 1
		renewOptions := options
		renewOptions.ClientEventID = holdClientEventID(options, threadID, sequence)
		thread, activity, err := claimCommentThread(ctx, renewOptions, threadID)
		if err != nil {
			return err
		}
		event := commentHoldEvent{
			Type:      "comment_claim_renewed",
			Sequence:  sequence,
			EmittedAt: time.Now().UTC().Format(time.RFC3339Nano),
			Thread:    thread,
			Renewal:   activity,
		}
		if err := encoder.Encode(event); err != nil {
			return err
		}
		emitted++
		if options.WatchOnce || (options.WatchMaxEvents > 0 && emitted >= options.WatchMaxEvents) {
			return nil
		}
		if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
			return err
		}
	}
}

func holdClientEventID(options commentsCommandOptions, threadID string, sequence int) string {
	base := strings.TrimSpace(options.ClientEventID)
	if base == "" {
		base = "comments-hold:" + strings.TrimSpace(threadID)
	}
	return fmt.Sprintf("%s:%d", base, sequence)
}

func activeClaimForActor(activities []commentActivityOutput, actorID string, now time.Time) *commentActivityOutput {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil
	}
	claim := activeClaim(activities, now)
	if claim == nil || claim.Actor.ID != actorID {
		return nil
	}
	return claim
}

func activeClaim(activities []commentActivityOutput, now time.Time) *commentActivityOutput {
	for index := len(activities) - 1; index >= 0; index-- {
		activity := activities[index]
		if activity.Type == "thread_claim_released" {
			return nil
		}
		if activity.Type != "thread_claimed" {
			continue
		}
		expiresAt, err := time.Parse(time.RFC3339Nano, activity.LeaseExpiresAt)
		if err != nil || !expiresAt.After(now) {
			return nil
		}
		return &activities[index]
	}
	return nil
}

func commentsNeedsWorkItem(options commentsCommandOptions) bool {
	return options.WithContext || options.WithDiff || options.WithActivities
}

func commentWorkItemsForThreads(ctx context.Context, options commentsCommandOptions, threads []commentThreadOutput) ([]commentWorkItemOutput, error) {
	items := make([]commentWorkItemOutput, 0, len(threads))
	for _, thread := range threads {
		item, err := commentWorkItemForThread(ctx, options, thread)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func commentWorkItemForThread(ctx context.Context, options commentsCommandOptions, thread commentThreadOutput) (commentWorkItemOutput, error) {
	item := commentWorkItemOutput{Thread: limitCommentThreadHistory(thread, options.CommentLimit)}
	if options.WithContext {
		contextPayload, err := contextPayloadForThread(ctx, options, thread)
		if err != nil {
			return commentWorkItemOutput{}, err
		}
		item.File = contextPayload.File
		item.Source = &contextPayload.Source
		item.Diff = contextPayload.Diff
	}
	if options.WithDiff && sourceContextUnavailable(item) {
		diff := unavailableTextDiffForThread(thread, item.Source.Reason)
		item.Diff = &diff
	}
	if options.WithDiff && item.Diff == nil {
		diff, err := fetchTextDiff(ctx, withoutReadHeaders(options), thread.Path)
		if err != nil {
			return commentWorkItemOutput{}, err
		}
		item.Diff = &diff
	}
	if options.WithActivities {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), thread.ID)
		if err != nil {
			return commentWorkItemOutput{}, err
		}
		item.Activities = limitCommentActivities(activities, options.ActivityLimit)
	}
	return item, nil
}

func limitCommentThreadHistory(thread commentThreadOutput, limit int) commentThreadOutput {
	if limit <= 0 || len(thread.Comments) <= limit {
		return thread
	}
	thread.Comments = append([]commentOutput(nil), thread.Comments[len(thread.Comments)-limit:]...)
	return thread
}

func limitCommentThreadsHistory(threads []commentThreadOutput, limit int) []commentThreadOutput {
	if limit <= 0 {
		return threads
	}
	limited := make([]commentThreadOutput, 0, len(threads))
	for _, thread := range threads {
		limited = append(limited, limitCommentThreadHistory(thread, limit))
	}
	return limited
}

func limitCommentInboxGroupHistory(group commentInboxGroupOutput, limit int) commentInboxGroupOutput {
	group.Threads = limitCommentThreadsHistory(group.Threads, limit)
	return group
}

func limitCommentOpenRoutingHistory(routing commentOpenRoutingOutput, limit int) commentOpenRoutingOutput {
	routing.Mine = limitCommentInboxGroupHistory(routing.Mine, limit)
	routing.Unclaimed = limitCommentInboxGroupHistory(routing.Unclaimed, limit)
	routing.ClaimedByOthers = limitCommentInboxGroupHistory(routing.ClaimedByOthers, limit)
	routing.SourceUnavailable = limitCommentInboxGroupHistory(routing.SourceUnavailable, limit)
	return routing
}

func limitCommentActivities(activities []commentActivityOutput, limit int) []commentActivityOutput {
	if limit <= 0 || len(activities) <= limit {
		return activities
	}
	return append([]commentActivityOutput(nil), activities[len(activities)-limit:]...)
}

func sourceContextUnavailable(item commentWorkItemOutput) bool {
	return item.Source != nil && !item.Source.Available && item.Source.Reason == "source_unavailable"
}

func unavailableTextDiffForThread(thread commentThreadOutput, reason string) textDiffOutput {
	return textDiffOutput{
		Path:         thread.Path,
		Status:       "unavailable",
		BaseLabel:    "HEAD",
		CompareLabel: "working tree",
		Reason:       reason,
	}
}

func commentsDoctor(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	threads, cursor, err := fetchCommentThreads(ctx, withoutReadHeaders(options), "open")
	if err != nil {
		return err
	}
	payload := commentsDoctorPayload(options, len(threads), cursor)
	if strings.TrimSpace(options.ReceiptLog) != "" {
		ledger, err := verifyCommentWriteReceiptLog(ctx, options, true)
		if err != nil {
			return err
		}
		payload["receiptLedger"] = ledger
		if !ledger.OK {
			payload["recommendedAction"] = "reconcile_receipt_ledger"
			suggestions, _ := payload["suggestedCommands"].([]commentSuggestedCommand)
			payload["suggestedCommands"] = append([]commentSuggestedCommand{commentReceiptLedgerSuggestedCommand(options.ReceiptLog, options.URL)}, suggestions...)
		}
	}
	return writeJSON(stdout, payload)
}

func commentsDoctorPayload(options commentsCommandOptions, openThreadCount int, cursor string) map[string]any {
	protocol := commentsProtocolPayload(commentsCommandOptions{})
	payload := map[string]any{
		"ok":            true,
		"url":           options.URL,
		"schemaVersion": commentsStreamSchemaVersion,
		"protocol": map[string]any{
			"name":                  protocol["name"],
			"version":               protocol["version"],
			"manifestSchema":        protocol["manifestSchema"],
			"manifestSchemaCommand": protocol["manifestSchemaCommand"],
			"schemaCommand":         protocol["schemaCommand"],
		},
		"server": map[string]any{
			"reachable":       true,
			"openThreadCount": openThreadCount,
			"cursor":          cursor,
		},
		"recommendedAction": commentsDoctorRecommendedAction(openThreadCount, options.ActorID),
		"suggestedCommands": commentsDoctorSuggestedCommands(options, openThreadCount),
	}
	if actor := actorInput(options); actor != nil {
		payload["actor"] = actor
	}
	return payload
}

func commentsDoctorRecommendedAction(openThreadCount int, actorID string) string {
	if strings.TrimSpace(actorID) == "" {
		return "configure_actor"
	}
	if openThreadCount > 0 {
		return "enter_resident_work_loop"
	}
	return "wait_for_gui_feedback"
}

func commentsDoctorSuggestedCommands(options commentsCommandOptions, openThreadCount int) []commentSuggestedCommand {
	actorID := strings.TrimSpace(options.ActorID)
	if actorID == "" {
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_protocol", "comments protocol", []string{"comments", "protocol", "--json"}, "", "Load the agent protocol before choosing an actor id."),
		}
	}
	clientSeed := strings.TrimSpace(options.ClientEventID)
	if clientSeed == "" {
		clientSeed = commentSuggestedClientEventID("doctor", "startup", actorID)
	}
	suggestions := []commentSuggestedCommand{
		suggestedCommentsCommand("recover_owned_live_claims", "comments mine", withURLArg(withAgentHistoryLimitArgs([]string{"comments", "mine", "--actor", actorID, "--full", "--json"}), options.URL), "", "After an adapter restart, inspect live claims already owned by this actor before claiming new GUI feedback."),
		suggestedCommentsCommandWithClientEventID("start_resident_work_loop", "comments work", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "work", "--actor", actorID, "--wait", "--loop", "--idle-events", "--full", "--json"}), options.URL, options.ReceiptLog), "", "Enter the preferred resident agent loop for GUI feedback.", clientSeed+":work"),
		suggestedCommentsCommand("snapshot_agent_inbox", "comments inbox", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "inbox", "--actor", actorID, "--full", "--json"}), options.URL, options.ReceiptLog), "", "Read owned, unclaimed, and other-claimed feedback without creating read receipts."),
	}
	if openThreadCount == 0 {
		suggestions = append(suggestions, suggestedCommentsCommand("watch_open_worklist", "comments watch", withRuntimeArgs(withAgentHistoryLimitArgs([]string{"comments", "watch", "--actor", actorID, "--full", "--json"}), options.URL, options.ReceiptLog), "", "Wait for GUI feedback without claiming work immediately."))
	}
	return suggestions
}

func withAgentHistoryLimitArgs(args []string) []string {
	return append(args, "--activity-limit", defaultAgentActivityLimit, "--comment-limit", defaultAgentCommentLimit)
}

func fetchCommentThreads(ctx context.Context, options commentsCommandOptions, status string) ([]commentThreadOutput, string, error) {
	variables := map[string]any{}
	if options.Path != "" {
		variables["path"] = options.Path
	}
	if status != "" {
		variables["status"] = status
	}
	if strings.TrimSpace(options.ReviewBatchID) != "" {
		variables["reviewBatchId"] = strings.TrimSpace(options.ReviewBatchID)
	}
	var threads []commentThreadOutput
	if err := postGraphQL(ctx, options, graphqlRequest{
		OperationName: "AgentCommentThreads",
		Query: `query AgentCommentThreads($path: String, $status: CommentStatus, $reviewBatchId: ID) {
			commentThreads(path: $path, status: $status, reviewBatchId: $reviewBatchId) {
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

func orderCommentThreadsForAgent(threads []commentThreadOutput) []commentThreadOutput {
	ordered := append([]commentThreadOutput(nil), threads...)
	sort.SliceStable(ordered, func(i, j int) bool {
		left := ordered[i]
		right := ordered[j]
		if left.CreatedAt != right.CreatedAt {
			return left.CreatedAt < right.CreatedAt
		}
		if left.UpdatedAt != right.UpdatedAt {
			return left.UpdatedAt < right.UpdatedAt
		}
		if left.Path != right.Path {
			return left.Path < right.Path
		}
		return left.ID < right.ID
	})
	return ordered
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
	sessionID := newCommentsStreamSessionID(options, "watch")
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
					Type:               "comments_open_worklist",
					SchemaVersion:      commentsStreamSchemaVersion,
					EventSchema:        "commentOpenWorklistEvent",
					EventSchemaCommand: commentSchemaCommandArgs("commentOpenWorklistEvent"),
					SessionID:          sessionID,
					Sequence:           emitted + 1,
					Reason:             reason,
					Changes:            watchChanges(previous, threads),
					Cursor:             cursor,
					EmittedAt:          time.Now().UTC().Format(time.RFC3339Nano),
					Count:              len(threads),
					Summary:            summarizeOpenWorklist(threads, options.ActorID, cursor, options.URL, options.ReceiptLog),
					Threads:            limitCommentThreadsHistory(threads, options.CommentLimit),
				}
				if commentsNeedsWorkItem(options) {
					items, err := commentWorkItemsForThreads(ctx, withoutReadHeaders(options), threads)
					if err != nil {
						if options.WatchOnce {
							return err
						}
						if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
							return err
						}
						continue
					}
					event.Items = items
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

func commentsFollow(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	lastCursor := strings.TrimSpace(options.ResumeCursor)
	sessionID := newCommentsStreamSessionID(options, "follow")
	emitted := 0
	first := true
	for {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), threadID)
		if err != nil {
			if options.WatchOnce {
				return err
			}
			if err := waitForWatchInterval(ctx, options.WatchInterval); err != nil {
				return err
			}
			continue
		}
		deliver := activitiesAfterCursor(activities, lastCursor)
		shouldEmit := len(deliver) > 0
		reason := "activity_changed"
		if first {
			reason = "initial"
			if lastCursor == "" {
				shouldEmit = options.WatchInitial && len(deliver) > 0
			} else {
				reason = "resumed"
				shouldEmit = len(deliver) > 0
			}
		}
		if shouldEmit {
			cursor := deliver[len(deliver)-1].ID
			snapshots, err := commentSnapshotsForActivities(ctx, options, threadID, deliver)
			if err != nil {
				return err
			}
			context, err := commentBatchContext(ctx, options, threadID, snapshots.Thread)
			if err != nil {
				return err
			}
			event := commentFollowEvent{
				Type:               "comment_thread_activity_batch",
				SchemaVersion:      commentsStreamSchemaVersion,
				EventSchema:        "commentActivityBatchEvent",
				EventSchemaCommand: commentSchemaCommandArgs("commentActivityBatchEvent"),
				SessionID:          sessionID,
				Sequence:           emitted + 1,
				Reason:             reason,
				ThreadID:           threadID,
				Cursor:             cursor,
				EmittedAt:          time.Now().UTC().Format(time.RFC3339Nano),
				Count:              len(deliver),
				Summary:            summarizeActivityBatch(deliver, options.ActorID, threadID, commentBodiesByID(snapshots.Comments), options.URL, options.ReceiptLog),
				Activities:         deliver,
				Comments:           snapshots.Comments,
				File:               context.File,
				Source:             context.Source,
				Diff:               context.Diff,
			}
			if err := encoder.Encode(event); err != nil {
				return err
			}
			lastCursor = cursor
			emitted++
			if options.WatchMaxEvents > 0 && emitted >= options.WatchMaxEvents {
				return nil
			}
		} else if first && lastCursor == "" && !options.WatchInitial && len(activities) > 0 {
			lastCursor = activities[len(activities)-1].ID
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

func activitiesAfterCursor(activities []commentActivityOutput, cursor string) []commentActivityOutput {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return activities
	}
	for index, activity := range activities {
		if activity.ID == cursor {
			if index+1 >= len(activities) {
				return []commentActivityOutput{}
			}
			return activities[index+1:]
		}
	}
	return activities
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
	return scopedCommentThreadsCursor("open", threads)
}

func scopedCommentThreadsCursor(scope string, threads []commentThreadOutput) string {
	fingerprints := make([]string, 0, len(threads))
	for _, thread := range threads {
		fingerprints = append(fingerprints, commentThreadFingerprint(thread))
	}
	sort.Strings(fingerprints)
	bytes, _ := json.Marshal(fingerprints)
	sum := sha256.Sum256(bytes)
	return scope + ":" + hex.EncodeToString(sum[:])
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
	activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"thread": selected, "activities": activities})
}

func commentsCheck(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	thread, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	claim := activeClaim(activities, time.Now().UTC())
	write := commentWritePreflight(thread, claim, options)
	outputThread := limitCommentThreadHistory(thread, options.CommentLimit)
	payload := map[string]any{
		"thread":    outputThread,
		"liveClaim": claim,
		"write":     write,
	}
	if options.WithContext {
		payload["file"] = nil
		payload["source"] = nil
	}
	if options.WithDiff {
		payload["diff"] = nil
	}
	if options.WithActivities {
		payload["activities"] = activities
	}
	if commentsNeedsWorkItem(options) {
		item, err := commentWorkItemForThread(ctx, withoutReadHeaders(options), thread)
		if err != nil {
			return err
		}
		if options.WithContext {
			payload["file"] = item.File
			payload["source"] = item.Source
		}
		if options.WithDiff {
			payload["diff"] = item.Diff
		}
		if options.WithActivities {
			payload["activities"] = item.Activities
		}
	}
	return writeJSON(stdout, payload)
}

func commentsVerifyReceipt(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	receipt, err := readCommentWriteReceiptFile(options.ReceiptFile)
	if err != nil {
		return fmt.Errorf("read --receipt-file: %w", err)
	}
	verification, err := verifyCommentWriteReceipt(ctx, options, receipt)
	if err != nil {
		return err
	}
	return writeJSON(stdout, verification)
}

func commentsVerifyReceiptLog(ctx context.Context, stdout io.Writer, options commentsCommandOptions) error {
	ledger, err := verifyCommentWriteReceiptLog(ctx, options, false)
	if err != nil {
		return err
	}
	return writeJSON(stdout, ledger)
}

func verifyCommentWriteReceiptLog(ctx context.Context, options commentsCommandOptions, allowMissing bool) (commentWriteReceiptLedgerVerification, error) {
	receipts, err := readCommentWriteReceiptLog(options.ReceiptLog)
	if err != nil {
		if allowMissing && os.IsNotExist(err) {
			return commentWriteReceiptLedgerVerification{
				SchemaVersion: commentsStreamSchemaVersion,
				OK:            true,
				Count:         0,
				Verified:      0,
				Failed:        0,
				Verifications: []commentWriteReceiptVerification{},
			}, nil
		}
		return commentWriteReceiptLedgerVerification{}, fmt.Errorf("read --receipt-log: %w", err)
	}
	ledger := commentWriteReceiptLedgerVerification{
		SchemaVersion: commentsStreamSchemaVersion,
		OK:            true,
		Count:         len(receipts),
		Verifications: []commentWriteReceiptVerification{},
	}
	for _, receipt := range receipts {
		verification, err := verifyCommentWriteReceipt(ctx, options, receipt)
		if err != nil {
			return commentWriteReceiptLedgerVerification{}, err
		}
		ledger.Verifications = append(ledger.Verifications, verification)
		if verification.OK {
			ledger.Verified++
		} else {
			ledger.OK = false
			ledger.Failed++
		}
	}
	if ledger.Failed > 0 {
		ledger.SuggestedCommands = []commentSuggestedCommand{
			commentReceiptLedgerSuggestedCommand(options.ReceiptLog, options.URL),
		}
	}
	return ledger, nil
}

func commentReceiptLedgerSuggestedCommand(receiptLog string, serverURL string) commentSuggestedCommand {
	return suggestedCommentsCommand("inspect_receipt_log", "comments verify-receipts", withURLArg([]string{"comments", "verify-receipts", "--receipt-log", receiptLog, "--json"}, serverURL), "", "Re-run ledger verification against the same Vivi server after inspecting failed receipt entries.")
}

func verifyCommentWriteReceipt(ctx context.Context, options commentsCommandOptions, receipt commentWriteReceipt) (commentWriteReceiptVerification, error) {
	if strings.TrimSpace(receipt.ThreadID) == "" {
		return commentWriteReceiptVerification{}, errors.New("receipt requires threadId")
	}
	thread, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), receipt.ThreadID)
	if err != nil {
		return commentWriteReceiptVerification{}, err
	}
	activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), receipt.ThreadID)
	if err != nil {
		return commentWriteReceiptVerification{}, err
	}
	verification := commentWriteReceiptVerification{
		SchemaVersion:  commentsStreamSchemaVersion,
		OK:             true,
		Receipt:        receipt,
		Thread:         thread,
		Checks:         []commentReceiptCheck{},
		MatchedEffects: []commentWriteReceiptEffect{},
		MissingEffects: []commentWriteReceiptEffect{},
	}
	verification.addCheck("thread_exists", thread.ID == receipt.ThreadID, "Thread exists and matches receipt.threadId.")
	if strings.TrimSpace(receipt.CommentID) != "" {
		verification.addCheck("comment_exists", commentThreadHasComment(thread, receipt.CommentID), "Returned comment exists on the thread.")
	}
	if strings.TrimSpace(receipt.Status) != "" {
		verification.addCheck("status_matches", thread.Status == receipt.Status, "Thread status matches receipt.status.")
	}
	activityByID := map[string]commentActivityOutput{}
	for _, activity := range activities {
		activityByID[activity.ID] = activity
	}
	for _, expected := range receipt.Effects {
		actual, ok := activityByID[expected.ID]
		if !ok || !receiptEffectMatchesActivity(expected, actual) {
			verification.OK = false
			verification.MissingEffects = append(verification.MissingEffects, expected)
			continue
		}
		verification.MatchedEffects = append(verification.MatchedEffects, effectFromActivity(actual))
	}
	verification.addCheck("effects_match", len(verification.MissingEffects) == 0, "All receipt effects are present in thread activity history.")
	if !verification.OK {
		verification.SuggestedCommands = []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", receipt.ThreadID, "--json"}, options.URL), "", "Inspect the current thread, comments, and activities on the same Vivi server before trusting this receipt."),
			suggestedCommentsCommand("check_thread_before_retrying", "comments check", withURLArg([]string{"comments", "check", receipt.ThreadID, "--json"}, options.URL), "", "Recompute current write safety on the same Vivi server before retrying or reconciling the operation."),
		}
	}
	return verification, nil
}

func (verification *commentWriteReceiptVerification) addCheck(name string, ok bool, message string) {
	if !ok {
		verification.OK = false
	}
	verification.Checks = append(verification.Checks, commentReceiptCheck{Name: name, OK: ok, Message: message})
}

func commentThreadHasComment(thread commentThreadOutput, commentID string) bool {
	for _, comment := range thread.Comments {
		if comment.ID == commentID {
			return true
		}
	}
	return false
}

func receiptEffectMatchesActivity(expected commentWriteReceiptEffect, actual commentActivityOutput) bool {
	if expected.Type != "" && expected.Type != actual.Type {
		return false
	}
	if expected.CommentID != "" && expected.CommentID != actual.CommentID {
		return false
	}
	if expected.PreviousStatus != "" && expected.PreviousStatus != actual.PreviousStatus {
		return false
	}
	if expected.Status != "" && expected.Status != actual.Status {
		return false
	}
	if expected.ClientEventID != "" && expected.ClientEventID != actual.ClientEventID {
		return false
	}
	return true
}

func commentWritePreflight(thread commentThreadOutput, claim *commentActivityOutput, options commentsCommandOptions) map[string]any {
	actorID := strings.TrimSpace(options.ActorID)
	result := map[string]any{
		"actor":    actorInput(options),
		"canWrite": false,
		"reason":   "no_live_claim",
	}
	if thread.Status != "open" {
		result["reason"] = "thread_not_open"
		result["status"] = thread.Status
		addCommentWritePreflightGuidance(result, thread, claim, actorID, options.URL, options.ReceiptLog)
		return result
	}
	if claim == nil {
		addCommentWritePreflightGuidance(result, thread, claim, actorID, options.URL, options.ReceiptLog)
		return result
	}
	if claim.Actor.ID != actorID {
		result["reason"] = "claimed_by_other_actor"
		result["claimedBy"] = claim.Actor
		addCommentWritePreflightGuidance(result, thread, claim, actorID, options.URL, options.ReceiptLog)
		return result
	}
	result["canWrite"] = true
	result["reason"] = "owned_live_claim"
	result["leaseExpiresAt"] = claim.LeaseExpiresAt
	addCommentWritePreflightGuidance(result, thread, claim, actorID, options.URL, options.ReceiptLog)
	return result
}

func addCommentWritePreflightGuidance(result map[string]any, thread commentThreadOutput, claim *commentActivityOutput, actorID string, serverURL string, receiptLog string) {
	reason, _ := result["reason"].(string)
	result["recommendedAction"] = commentWritePreflightRecommendedAction(reason)
	result["suggestedCommands"] = suggestedCommandsForWritePreflight(reason, thread, claim, actorID, serverURL, receiptLog)
}

func commentWritePreflightRecommendedAction(reason string) string {
	switch reason {
	case "owned_live_claim":
		return "write_guarded_reply"
	case "no_live_claim":
		return "claim_before_writing"
	case "claimed_by_other_actor":
		return "inspect_or_wait"
	case "thread_not_open":
		return "reopen_before_writing"
	default:
		return "inspect_thread"
	}
}

func suggestedCommandsForWritePreflight(reason string, thread commentThreadOutput, claim *commentActivityOutput, actorID string, serverURL string, receiptLog string) []commentSuggestedCommand {
	threadID := strings.TrimSpace(thread.ID)
	if threadID == "" {
		return nil
	}
	switch reason {
	case "owned_live_claim":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the thread before choosing a guarded write."),
			}
		}
		renewClientEventID := ""
		claimSeed := ""
		if claim != nil {
			renewClientEventID = commentSuggestedClientEventID("check", threadID, "renew", claim.LeaseExpiresAt)
			claimSeed = claim.ID
			if claimSeed == "" {
				claimSeed = claim.LeaseExpiresAt
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("renew_current_claim", "comments renew", withURLArg([]string{"comments", "renew", threadID, "--actor", actorID, "--json"}, serverURL), "", "Extend the current claim before a longer edit or verification pass.", renewClientEventID),
			suggestedCommentsCommandWithClientEventID("reply_with_claim", "comments reply", withRuntimeArgs([]string{"comments", "reply", threadID, "--actor", actorID, "--body-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "", "Post a guarded non-terminal reply while this actor owns the live claim.", suggestedWriteClientEventID("check", threadID, "reply", claimSeed)),
			suggestedCommentsCommandWithClientEventID("acknowledge_or_request_clarification", "comments triage", withRuntimeArgs([]string{"comments", "triage", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured acknowledgement, clarification request, or blocked status while keeping the thread open.", suggestedWriteClientEventID("check", threadID, "triage", claimSeed)),
			suggestedCommentsCommandWithClientEventID("handoff_after_blocked_or_needs_info", "comments release", withRuntimeArgs([]string{"comments", "release", threadID, "--actor", actorID, "--triage-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentTriageFileInput", "Post a structured blocked or needs-info handoff comment, then release the live claim for another attempt.", suggestedWriteClientEventID("check", threadID, "release", claimSeed)),
			suggestedCommentsCommandWithClientEventID("complete_after_verification", "comments done", withRuntimeArgs([]string{"comments", "done", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Resolve the thread with structured verification after the fix is complete.", suggestedWriteClientEventID("check", threadID, "done", claimSeed)),
			suggestedCommentsCommandWithClientEventID("archive_after_decision", "comments dismiss", withRuntimeArgs([]string{"comments", "dismiss", threadID, "--actor", actorID, "--result-file", "-", "--require-claim", "--json"}, serverURL, receiptLog), "commentResultFileInput", "Archive the thread with a structured explanation when the feedback is intentionally not fixed.", suggestedWriteClientEventID("check", threadID, "dismiss", claimSeed)),
		}
	case "no_live_claim":
		if actorID == "" {
			return []commentSuggestedCommand{
				suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the thread before claiming work."),
			}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommandWithClientEventID("claim_thread_before_writing", "comments claim", withURLArg([]string{"comments", "claim", threadID, "--actor", actorID, "--full", "--json"}, serverURL), "", "Claim this open thread and receive source, diff, and activity context before writing.", commentSuggestedClientEventID("check", threadID, "claim")),
		}
	case "claimed_by_other_actor":
		args := []string{"comments", "show", threadID, "--json"}
		if actorID != "" {
			args = []string{"comments", "show", threadID, "--actor", actorID, "--json"}
		}
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_thread", "comments show", withURLArg(args, serverURL), "", "Inspect the current owner and thread state before deciding whether to wait or coordinate."),
			suggestedCommentsCommand("follow_until_released", "comments follow", withURLArg([]string{"comments", "follow", threadID, "--no-initial", "--json"}, serverURL), "", "Watch this thread for release, status, or human follow-up before retrying work."),
		}
	case "thread_not_open":
		args := []string{"comments", "show", threadID, "--json"}
		suggestions := []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_terminal_thread", "comments show", withURLArg(args, serverURL), "", "Inspect the terminal thread before reopening or leaving it closed."),
		}
		if actorID != "" {
			suggestions = append(suggestions, suggestedCommentsCommandWithClientEventID("reopen_before_writing", "comments reopen", withURLArg([]string{"comments", "reopen", threadID, "--actor", actorID, "--json"}, serverURL), "", "Reopen the thread before posting a new guarded reply or result.", commentSuggestedClientEventID("check", threadID, "reopen", thread.Status)))
		}
		return suggestions
	default:
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_thread", "comments show", withURLArg([]string{"comments", "show", threadID, "--json"}, serverURL), "", "Inspect the thread before deciding the next action."),
		}
	}
}

func commentsContext(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	thread, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	contextPayload, err := contextPayloadForThread(ctx, withoutReadHeaders(options), thread)
	if err != nil {
		return err
	}
	payload := map[string]any{
		"thread": limitCommentThreadHistory(thread, options.CommentLimit),
		"file":   contextPayload.File,
		"source": contextPayload.Source,
	}
	if options.WithDiff {
		payload["diff"] = contextPayload.Diff
	}
	if options.WithActivities {
		activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), thread.ID)
		if err != nil {
			return err
		}
		payload["activities"] = limitCommentActivities(activities, options.ActivityLimit)
	}
	return writeJSON(stdout, payload)
}

func fetchCommentThreadActivities(ctx context.Context, options commentsCommandOptions, threadID string) ([]commentActivityOutput, error) {
	var activities []commentActivityOutput
	if err := postGraphQL(ctx, options, graphqlRequest{
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
				leaseExpiresAt
				createdAt
			}
		}`,
		Variables: map[string]any{"threadId": threadID},
	}, "commentThreadActivities", &activities); err != nil {
		return nil, err
	}
	return activities, nil
}

func contextPayloadForThread(ctx context.Context, options commentsCommandOptions, thread commentThreadOutput) (commentContextPayload, error) {
	file, err := fetchFilePayload(ctx, withoutReadHeaders(options), thread.Path)
	if err != nil {
		return unavailableContextPayloadForThread(thread), nil
	}
	source := sourceContextForThread(file, thread, options.ContextLines)
	payload := commentContextPayload{
		File: map[string]any{
			"path":         file.Path,
			"viewerKind":   file.ViewerKind,
			"encoding":     file.Encoding,
			"etag":         file.Etag,
			"size":         file.Size,
			"mtimeMs":      file.MtimeMs,
			"truncated":    file.Truncated,
			"previewBytes": file.PreviewBytes,
		},
		Source: source,
	}
	if options.WithDiff {
		diff, err := fetchTextDiff(ctx, withoutReadHeaders(options), thread.Path)
		if err != nil {
			return commentContextPayload{}, err
		}
		payload.Diff = &diff
	}
	return payload, nil
}

func unavailableContextPayloadForThread(thread commentThreadOutput) commentContextPayload {
	source := sourceContextOutput{
		Path:      thread.Path,
		Available: false,
		Reason:    "source_unavailable",
	}
	if anchorStart, anchorEnd, ok := anchorLineRange(thread.Anchor); ok {
		source.AnchorStartLine = anchorStart
		source.AnchorEndLine = anchorEnd
	}
	return commentContextPayload{Source: source}
}

func fetchCommentThreadByID(ctx context.Context, options commentsCommandOptions, threadID string) (commentThreadOutput, error) {
	threads, _, err := fetchCommentThreads(ctx, options, "")
	if err != nil {
		return commentThreadOutput{}, err
	}
	for _, thread := range threads {
		if thread.ID == threadID {
			return thread, nil
		}
	}
	return commentThreadOutput{}, fmt.Errorf("comment thread %q not found", threadID)
}

func fetchFilePayload(ctx context.Context, options commentsCommandOptions, path string) (filePayloadOutput, error) {
	var file filePayloadOutput
	if err := postGraphQL(ctx, options, graphqlRequest{
		OperationName: "AgentFilePayload",
		Query: `query AgentFilePayload($path: String!) {
			file(path: $path) {
				path
				viewerKind
				encoding
				content
				etag
				size
				mtimeMs
				truncated
				previewBytes
			}
		}`,
		Variables: map[string]any{"path": path},
	}, "file", &file); err != nil {
		return filePayloadOutput{}, err
	}
	return file, nil
}

func fetchTextDiff(ctx context.Context, options commentsCommandOptions, path string) (textDiffOutput, error) {
	var diff textDiffOutput
	variables := map[string]any{"path": path}
	if strings.TrimSpace(options.DiffBase) != "" {
		variables["base"] = options.DiffBase
	}
	if err := postGraphQL(ctx, options, graphqlRequest{
		OperationName: "AgentTextDiff",
		Query: `query AgentTextDiff($path: String!, $base: String) {
			diff(path: $path, base: $base) {
				path
				status
				kind
				baseLabel
				baseRef
				compareLabel
				diffHash
				content
				reason
			}
		}`,
		Variables: variables,
	}, "diff", &diff); err != nil {
		return textDiffOutput{}, err
	}
	return diff, nil
}

func matchingCompletionComment(thread commentThreadOutput, body, actorID string) *commentOutput {
	body = strings.TrimSpace(body)
	actorID = strings.TrimSpace(actorID)
	for index := len(thread.Comments) - 1; index >= 0; index-- {
		comment := thread.Comments[index]
		if strings.TrimSpace(comment.Body) != body {
			continue
		}
		if actorID != "" && comment.CreatedBy.ID != actorID {
			continue
		}
		return &thread.Comments[index]
	}
	return nil
}

func sourceContextForThread(file filePayloadOutput, thread commentThreadOutput, contextLines int) sourceContextOutput {
	source := sourceContextOutput{
		Path:       file.Path,
		ViewerKind: file.ViewerKind,
		Encoding:   file.Encoding,
		Available:  false,
	}
	anchorStart, anchorEnd, ok := anchorLineRange(thread.Anchor)
	if ok {
		source.AnchorStartLine = anchorStart
		source.AnchorEndLine = anchorEnd
	}
	if file.Encoding != "utf8" {
		source.Reason = "unsupported_encoding"
		return source
	}
	lines := strings.Split(file.Content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" && strings.HasSuffix(file.Content, "\n") {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		source.Reason = "empty_file"
		return source
	}
	if !ok {
		source.Reason = "missing_line_anchor"
		anchorStart = 1
		anchorEnd = 1
	}
	if anchorStart < 1 {
		anchorStart = 1
	}
	if anchorEnd < anchorStart {
		anchorEnd = anchorStart
	}
	start := anchorStart - contextLines
	if start < 1 {
		start = 1
	}
	end := anchorEnd + contextLines
	if end > len(lines) {
		end = len(lines)
	}
	source.StartLine = start
	source.EndLine = end
	source.Available = true
	source.Truncated = file.Truncated
	for lineNumber := start; lineNumber <= end; lineNumber++ {
		source.Lines = append(source.Lines, sourceLineOutput{
			Number: lineNumber,
			Text:   lines[lineNumber-1],
			Anchor: ok && lineNumber >= anchorStart && lineNumber <= anchorEnd,
		})
	}
	return source
}

func anchorLineRange(raw json.RawMessage) (int, int, bool) {
	if len(raw) == 0 {
		return 0, 0, false
	}
	var anchor map[string]any
	if err := json.Unmarshal(raw, &anchor); err != nil {
		return 0, 0, false
	}
	canonical, _ := anchor["canonical"].(map[string]any)
	if canonical == nil {
		canonical = anchor
	}
	start, ok := jsonInt(canonical["lineStart"])
	if !ok {
		return 0, 0, false
	}
	end, ok := jsonInt(canonical["lineEnd"])
	if !ok {
		end = start
	}
	return start, end, true
}

func jsonInt(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	default:
		return 0, false
	}
}

func commentsReply(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	if err := ensureActorHasLiveClaim(ctx, options, threadID); err != nil {
		return err
	}
	reply, err := addCommentToThread(ctx, options, threadID, options.Body)
	if err != nil {
		return err
	}
	receipt, err := commentWriteReceiptFor(ctx, options, "comments reply", threadID, &reply, "")
	if err != nil {
		return err
	}
	if err := appendCommentWriteReceiptLog(options.ReceiptLog, receipt); err != nil {
		return fmt.Errorf("append --receipt-log: %w", err)
	}
	return writeJSON(stdout, map[string]any{"comment": reply, "receipt": receipt})
}

func commentsTriage(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	triage, err := commentTriagePayload(options)
	if err != nil {
		return err
	}
	if err := ensureActorHasLiveClaim(ctx, options, threadID); err != nil {
		return err
	}
	thread, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	comment := matchingCompletionComment(thread, triage.Body, options.ActorID)
	if comment == nil {
		added, err := addCommentToThread(ctx, options, threadID, triage.Body)
		if err != nil {
			return err
		}
		comment = &added
		thread, err = fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
		if err != nil {
			return err
		}
	}
	receipt, err := commentWriteReceiptFor(ctx, options, "comments triage", threadID, comment, "")
	if err != nil {
		return err
	}
	if err := appendCommentWriteReceiptLog(options.ReceiptLog, receipt); err != nil {
		return fmt.Errorf("append --receipt-log: %w", err)
	}
	return writeJSON(stdout, map[string]any{
		"triage":  triage,
		"comment": comment,
		"thread":  thread,
		"receipt": receipt,
	})
}

func commentTriagePayload(options commentsCommandOptions) (commentTriageOutput, error) {
	decision := normalizeTriageDecision(options.TriageDecision)
	if decision == "" {
		return commentTriageOutput{}, fmt.Errorf("unsupported triage --decision %q", options.TriageDecision)
	}
	summary := strings.TrimSpace(options.TriageSummary)
	nextAction := strings.TrimSpace(options.TriageNext)
	details := strings.TrimSpace(options.Body)
	body := buildTriageBody(decision, summary, nextAction, details)
	if strings.TrimSpace(body) == "" {
		return commentTriageOutput{}, errors.New("triage requires non-empty content")
	}
	return commentTriageOutput{
		Decision:   decision,
		Summary:    summary,
		NextAction: nextAction,
		Details:    details,
		Body:       body,
	}, nil
}

func normalizeTriageDecision(decision string) string {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case "accepted", "fixing", "needs-info", "blocked", "not-applicable":
		return strings.ToLower(strings.TrimSpace(decision))
	default:
		return ""
	}
}

func buildTriageBody(decision, summary, nextAction, details string) string {
	var builder strings.Builder
	builder.WriteString("Triage: ")
	builder.WriteString(decision)
	if strings.TrimSpace(summary) != "" {
		builder.WriteString("\n\nSummary: ")
		builder.WriteString(strings.TrimSpace(summary))
	}
	if strings.TrimSpace(nextAction) != "" {
		builder.WriteString("\n\nNext action: ")
		builder.WriteString(strings.TrimSpace(nextAction))
	}
	if strings.TrimSpace(details) != "" {
		builder.WriteString("\n\nDetails:\n")
		builder.WriteString(strings.TrimSpace(details))
	}
	return builder.String()
}

func commentResultPayload(command string, input commentResultFileInput) (commentResultOutput, error) {
	outcome := commentResultOutcome(command)
	if outcome == "" {
		return commentResultOutput{}, fmt.Errorf("unsupported result command %q", command)
	}
	summary := strings.TrimSpace(input.Summary)
	verification := trimmedNonEmptyStrings(input.Verification)
	details := strings.TrimSpace(input.Details)
	if summary == "" && len(verification) == 0 && details == "" {
		return commentResultOutput{}, errors.New("result requires summary, verification, or details")
	}
	body := buildResultBody(outcome, summary, verification, details)
	if strings.TrimSpace(body) == "" {
		return commentResultOutput{}, errors.New("result requires non-empty content")
	}
	return commentResultOutput{
		Outcome:      outcome,
		Summary:      summary,
		Verification: verification,
		Details:      details,
		Body:         body,
	}, nil
}

func commentResultOutcome(command string) string {
	switch command {
	case "done":
		return "resolved"
	case "dismiss":
		return "archived"
	default:
		return ""
	}
}

func buildResultBody(outcome, summary string, verification []string, details string) string {
	var builder strings.Builder
	builder.WriteString("Result: ")
	builder.WriteString(outcome)
	if strings.TrimSpace(summary) != "" {
		builder.WriteString("\n\nSummary: ")
		builder.WriteString(strings.TrimSpace(summary))
	}
	if len(verification) > 0 {
		builder.WriteString("\n\nVerification:")
		for _, item := range verification {
			builder.WriteString("\n- ")
			builder.WriteString(item)
		}
	}
	if strings.TrimSpace(details) != "" {
		builder.WriteString("\n\nDetails:\n")
		builder.WriteString(strings.TrimSpace(details))
	}
	return builder.String()
}

func trimmedNonEmptyStrings(values []string) []string {
	trimmed := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			trimmed = append(trimmed, value)
		}
	}
	return trimmed
}

func commentsDone(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	return commentsCompleteWithReply(ctx, stdout, options, threadID, "resolve", "resolved", "done")
}

func commentsDismiss(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID string) error {
	return commentsCompleteWithReply(ctx, stdout, options, threadID, "archive", "archived", "dismiss")
}

func commentsCompleteWithReply(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID, action, terminalStatus, commandName string) error {
	body := strings.TrimSpace(options.Body)
	thread, err := fetchCommentThreadByID(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	comment := matchingCompletionComment(thread, body, options.ActorID)
	switch thread.Status {
	case terminalStatus:
		if comment == nil {
			return fmt.Errorf("comment thread %q is already %s without this completion reply", threadID, terminalStatus)
		}
		receipt, err := commentWriteReceiptFor(ctx, options, "comments "+commandName, threadID, comment, terminalStatus)
		if err != nil {
			return err
		}
		payload := map[string]any{"comment": comment, "thread": thread, "receipt": receipt}
		if options.Result != nil {
			payload["result"] = options.Result
		}
		if err := appendCommentWriteReceiptLog(options.ReceiptLog, receipt); err != nil {
			return fmt.Errorf("append --receipt-log: %w", err)
		}
		return writeJSON(stdout, payload)
	case "open":
	default:
		return fmt.Errorf("comment thread %q must be open before %s can %s it", threadID, commandName, action)
	}
	if err := ensureActorHasLiveClaim(ctx, options, threadID); err != nil {
		return err
	}
	if comment == nil {
		added, err := addCommentToThread(ctx, options, threadID, body)
		if err != nil {
			return err
		}
		comment = &added
	}
	terminal, err := updateCommentThreadLifecycle(ctx, options, threadID, action)
	if err != nil {
		return err
	}
	payload := map[string]any{"comment": comment, "thread": terminal}
	receipt, err := commentWriteReceiptFor(ctx, options, "comments "+commandName, threadID, comment, terminalStatus)
	if err != nil {
		return err
	}
	payload["receipt"] = receipt
	if err := appendCommentWriteReceiptLog(options.ReceiptLog, receipt); err != nil {
		return fmt.Errorf("append --receipt-log: %w", err)
	}
	if options.Result != nil {
		payload["result"] = options.Result
	}
	return writeJSON(stdout, payload)
}

func commentWriteReceiptFor(ctx context.Context, options commentsCommandOptions, command string, threadID string, comment *commentOutput, status string) (commentWriteReceipt, error) {
	receipt := commentWriteReceipt{
		SchemaVersion:             commentsStreamSchemaVersion,
		ReceiptSchema:             "commentWriteReceipt",
		ReceiptSchemaCommand:      commentSchemaCommandArgs("commentWriteReceipt"),
		VerificationCommand:       withURLArg([]string{"comments", "verify-receipt", "--receipt-file", "-", "--json"}, options.URL),
		VerificationSchema:        "commentWriteReceiptVerification",
		VerificationSchemaCommand: commentSchemaCommandArgs("commentWriteReceiptVerification"),
		Command:                   command,
		ThreadID:                  threadID,
		ActorID:                   strings.TrimSpace(options.ActorID),
		ClientEventID:             strings.TrimSpace(options.ClientEventID),
		Status:                    strings.TrimSpace(status),
		Effects:                   []commentWriteReceiptEffect{},
	}
	commentID := ""
	if comment != nil {
		commentID = strings.TrimSpace(comment.ID)
		receipt.CommentID = commentID
	}
	activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return commentWriteReceipt{}, err
	}
	for _, activity := range activities {
		if !activityMatchesWriteReceipt(activity, receipt.ClientEventID, commentID, receipt.Status) {
			continue
		}
		receipt.Effects = appendReceiptEffect(receipt.Effects, activity)
	}
	return receipt, nil
}

func activityMatchesWriteReceipt(activity commentActivityOutput, clientEventID string, commentID string, status string) bool {
	if clientEventID != "" && activity.ClientEventID == clientEventID {
		return true
	}
	if commentID != "" && activity.CommentID == commentID {
		return true
	}
	if clientEventID == "" && status != "" && activity.Type == "thread_status_changed" && activity.Status == status {
		return true
	}
	return false
}

func appendReceiptEffect(effects []commentWriteReceiptEffect, activity commentActivityOutput) []commentWriteReceiptEffect {
	for _, existing := range effects {
		if existing.ID == activity.ID {
			return effects
		}
	}
	return append(effects, effectFromActivity(activity))
}

func effectFromActivity(activity commentActivityOutput) commentWriteReceiptEffect {
	return commentWriteReceiptEffect{
		ID:             activity.ID,
		Type:           activity.Type,
		CommentID:      activity.CommentID,
		PreviousStatus: activity.PreviousStatus,
		Status:         activity.Status,
		ClientEventID:  activity.ClientEventID,
		CreatedAt:      activity.CreatedAt,
	}
}

func addCommentToThread(ctx context.Context, options commentsCommandOptions, threadID, body string) (commentOutput, error) {
	var reply commentOutput
	input := map[string]any{"body": body}
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
		return commentOutput{}, err
	}
	return reply, nil
}

func commentsLifecycle(ctx context.Context, stdout io.Writer, options commentsCommandOptions, threadID, action string) error {
	if err := ensureActorHasLiveClaim(ctx, options, threadID); err != nil {
		return err
	}
	thread, err := updateCommentThreadLifecycle(ctx, options, threadID, action)
	if err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{"thread": thread})
}

func ensureActorHasLiveClaim(ctx context.Context, options commentsCommandOptions, threadID string) error {
	if !options.RequireClaim {
		return nil
	}
	return requireActorLiveClaim(ctx, options, threadID)
}

func requireActorLiveClaim(ctx context.Context, options commentsCommandOptions, threadID string) error {
	activities, err := fetchCommentThreadActivities(ctx, withoutReadHeaders(options), threadID)
	if err != nil {
		return err
	}
	claim := activeClaim(activities, time.Now().UTC())
	if claim == nil {
		return fmt.Errorf("comment thread %q has no live claim for actor %q; renew or claim it before writing", threadID, options.ActorID)
	}
	if claim.Actor.ID != strings.TrimSpace(options.ActorID) {
		return fmt.Errorf("comment thread %q is claimed by %q, not %q", threadID, claim.Actor.ID, options.ActorID)
	}
	return nil
}

func updateCommentThreadLifecycle(ctx context.Context, options commentsCommandOptions, threadID, action string) (commentThreadOutput, error) {
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
		return commentThreadOutput{}, err
	}
	return thread, nil
}

func claimCommentThread(ctx context.Context, options commentsCommandOptions, threadID string) (commentThreadOutput, commentActivityOutput, error) {
	leaseSeconds := int(options.LeaseDuration / time.Second)
	if leaseSeconds <= 0 {
		leaseSeconds = 1
	}
	input := map[string]any{
		"actor":        actorInput(options),
		"leaseSeconds": leaseSeconds,
	}
	if strings.TrimSpace(options.ClientEventID) != "" {
		input["clientEventId"] = strings.TrimSpace(options.ClientEventID)
	}
	var payload commentClaimOutput
	if err := postGraphQL(ctx, withoutReadHeaders(options), graphqlRequest{
		OperationName: "AgentClaimCommentThread",
		Query: `mutation AgentClaimCommentThread($id: ID!, $input: CommentThreadClaimInput!) {
			claimThread(id: $id, input: $input) {
				thread {
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
				activity {
					id
					threadId
					type
					actor { id kind displayName }
					clientEventId
					leaseExpiresAt
					createdAt
				}
			}
		}`,
		Variables: map[string]any{"id": threadID, "input": input},
	}, "claimThread", &payload); err != nil {
		return commentThreadOutput{}, commentActivityOutput{}, err
	}
	return payload.Thread, payload.Activity, nil
}

func releaseCommentThreadClaim(ctx context.Context, options commentsCommandOptions, threadID string) (commentThreadOutput, commentActivityOutput, error) {
	input := map[string]any{"actor": actorInput(options)}
	if strings.TrimSpace(options.ClientEventID) != "" {
		input["clientEventId"] = strings.TrimSpace(options.ClientEventID)
	}
	var payload commentClaimOutput
	if err := postGraphQL(ctx, withoutReadHeaders(options), graphqlRequest{
		OperationName: "AgentReleaseCommentThreadClaim",
		Query: `mutation AgentReleaseCommentThreadClaim($id: ID!, $input: CommentThreadClaimReleaseInput!) {
			releaseThreadClaim(id: $id, input: $input) {
				thread {
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
				activity {
					id
					threadId
					type
					actor { id kind displayName }
					clientEventId
					createdAt
				}
			}
		}`,
		Variables: map[string]any{"id": threadID, "input": input},
	}, "releaseThreadClaim", &payload); err != nil {
		return commentThreadOutput{}, commentActivityOutput{}, err
	}
	return payload.Thread, payload.Activity, nil
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
	}
	if options.ClientEventID != "" {
		req.Header.Set("X-Vivi-Client-Event-Id", options.ClientEventID)
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
	return options
}

func writeJSON(stdout io.Writer, value any) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
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
		"Agent quick path:",
		"  1. Discover the contract and receipt ledger: vivi comments protocol --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  2. Cache schemas offline: vivi comments schema all --json",
		"  3. Check startup state: vivi comments doctor --actor <actor> --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  4. Resume owned work first: vivi comments mine --actor <actor> --full --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  5. Run the resident loop: vivi comments work --actor <actor> --wait --loop --idle-events --full --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  6. Execute suggestedCommands from protocol, doctor, work, follow, check, and errors before inventing argv",
		"",
		"Agent write rules:",
		"  - Read stdinSchemaCommand before stdinRequired writes",
		"  - Keep --receipt-log on startup, resident loop, and suggested write commands for restart recovery",
		"  - Use --require-claim for triage, release, done, and dismiss in background loops",
		"  - Reuse a stable --client-event-id only for retries of the same logical write",
		"  - Run comments check <thread-id> --actor <actor> --full --json before writing when ownership may be stale",
		"  - Prefer done/dismiss --result-file - for terminal replies and release --triage-file - for blocked handoffs",
		"",
		"Usage:",
		"  vivi comments protocol --json",
		"  vivi comments protocol --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  vivi comments schema <protocol|doctor|triage|result|claim|inbox|mine|batch|check|commentTriageOutput|commentReleaseOutput|commentResultOutput|suggestedCommand|writeReceipt|receiptVerification|receiptLedgerVerification|activityBatch|workClaimed|workIdle|openWorklist|error|all> --json",
		"  vivi comments doctor --actor claude-code --json",
		"  vivi comments doctor --actor claude-code --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  vivi comments active --actor claude-code --json",
		"  vivi comments active --actor claude-code --full --json",
		"  vivi comments active --actor claude-code --review-batch review-batch-... --full --json",
		"  vivi comments next --actor claude-code --json",
		"  vivi comments next --actor claude-code --with-context --json",
		"  vivi comments next --actor claude-code --full --json",
		"  vivi comments claim --actor claude-code --review-batch review-batch-... --full --json",
		"  vivi comments claim <thread-id> --actor claude-code --lease 10m --json",
		"  vivi comments claim --wait --actor claude-code --full --json",
		"  vivi comments work --wait --actor claude-code --full --json",
		"  vivi comments work --loop --actor claude-code --idle-events --full --json",
		"  vivi comments work --loop --actor claude-code --idle-events --full --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  vivi comments renew <thread-id> --actor claude-code --lease 10m --json",
		"  vivi comments hold <thread-id> --actor claude-code --interval 2m --lease 10m --json",
		"  vivi comments inbox --actor claude-code --full --json",
		"  vivi comments batch review-batch-... --actor claude-code --full --json",
		"  vivi comments mine --actor claude-code --full --json",
		"  vivi comments release <thread-id> --actor claude-code --json",
		"  vivi comments release <thread-id> --body-file /tmp/vivi-handoff.md --actor claude-code --json",
		"  vivi comments release <thread-id> --triage-file - --actor claude-code --require-claim --json",
		"  vivi comments watch --actor claude-code --full --json",
		"  vivi comments watch --actor claude-code --json",
		"  vivi comments follow <thread-id> --no-initial --json",
		"  vivi comments list --status open --full --json",
		"  vivi comments show <thread-id> --json",
		"  vivi comments check <thread-id> --actor claude-code --json",
		"  vivi comments verify-receipt --receipt-file /tmp/vivi-receipt.json --json",
		"  vivi comments verify-receipts --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  vivi comments context <thread-id> --full --context-lines 6 --json",
		"  vivi comments reply <thread-id> --body \"Fixed\" --actor codex --json",
		"  vivi comments reply <thread-id> --body-file - --actor codex --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"  vivi comments reply <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json",
		"  vivi comments schema commentTriageFileInput --json",
		"  vivi comments schema commentResultFileInput --json",
		"  vivi comments schema commentProtocolManifest --json",
		"  vivi comments schema commentDoctorOutput --json",
		"  vivi comments schema commentClaimOutput --json",
		"  vivi comments schema commentInboxOutput --json",
		"  vivi comments schema commentMineOutput --json",
		"  vivi comments schema commentBatchOutput --json",
		"  vivi comments schema commentCheckOutput --json",
		"  vivi comments schema commentTriageOutput --json",
		"  vivi comments schema commentReleaseOutput --json",
		"  vivi comments schema commentResultOutput --json",
		"  vivi comments schema commentSuggestedCommand --json",
		"  vivi comments schema commentWriteReceipt --json",
		"  vivi comments schema commentWriteReceiptVerification --json",
		"  vivi comments schema commentWriteReceiptLedgerVerification --json",
		"  vivi comments schema commentActivityBatchEvent --json",
		"  vivi comments schema commentWorkClaimedEvent --json",
		"  vivi comments schema commentWorkIdleEvent --json",
		"  vivi comments schema commentOpenWorklistEvent --json",
		"  vivi comments protocol --json",
		"  vivi comments triage <thread-id> --actor codex --decision accepted --summary \"Investigating\" --json",
		"  vivi comments triage <thread-id> --actor codex --triage-file /tmp/vivi-triage.json --json",
		"  vivi comments done <thread-id> --body-file /tmp/vivi-reply.md --actor codex --require-claim --json",
		"  vivi comments done <thread-id> --result-file /tmp/vivi-result.json --actor codex --require-claim --json",
		"  vivi comments dismiss <thread-id> --body-file - --actor codex --json",
		"  vivi comments resolve <thread-id> --actor codex --json",
		"  vivi comments archive <thread-id> --actor codex --json",
		"  vivi comments reopen <thread-id> --actor codex --json",
		"",
		"Options:",
		"  --url <url>                Vivi server URL (default: VIVI_URL or http://127.0.0.1:4317)",
		"  --json                     Write stable JSON output (default)",
		"  --path <path>              Filter threads by path where supported",
		"  --status <status>          open, resolved, archived, or all",
		"  --review-batch <id>        Filter threads by review batch id",
		"  --actor <id>               Actor id for comments and read receipts",
		"  --actor-kind <kind>        human, claude_code, codex, or unknown",
		"  --actor-name <name>        Actor display name",
		"  --client-event-id <id>     Idempotency key for read receipts",
		"  --lease <duration>         Claim or renewal lease duration (default 10m)",
		"  --body <text>              Reply body",
		"  --body-file <path|->       Read reply body from a file or stdin",
		"  --triage-file <path|->     Read structured triage JSON from a file or stdin",
		"  --result-file <path|->     Read structured terminal result JSON from a file or stdin",
		"  --receipt-file <path|->    Read a write receipt JSON object or command payload",
		"  --decision <value>         Triage decision: accepted, fixing, needs-info, blocked, or not-applicable",
		"  --summary <text>           Human-readable triage summary",
		"  --next-action <text>       Next agent action for a triage reply",
		"  --full                     Include source context, current diff, and activity history",
		"  --with-context             Include source context with rich agent commands",
		"  --with-diff                Include current Git diff with rich agent commands",
		"  --with-activities          Include thread activity history with rich agent commands",
		"  --activity-limit <count>   Limit emitted activity history to the most recent count",
		"  --comment-limit <count>    Limit emitted thread comments to the most recent count",
		"  --require-claim            Require this actor to hold the live claim before writing",
		"  --wait                     Wait until claimable comment work is available",
		"  --diff-base <ref>          Diff base ref (default: HEAD)",
		"  --context-lines <count>    Source lines around a comment anchor (default 6)",
		"  --interval <duration>      Watch, follow, hold, or work polling interval (default 2s)",
		"  --renew-interval <dur>     Work lease renewal interval (default min(lease/2, 2m))",
		"  --idle-events              Emit comment_work_idle heartbeat events while comments work is waiting",
		"  --loop                     Keep comments work running and claim the next item after terminal status",
		"  --cursor <cursor>          Suppress an already delivered watch/follow snapshot",
		"  --no-initial               Wait for the next watch/follow change",
		"  --once                     Poll once and exit",
		"  --max-events <count>       Stop streaming commands after emitting count events",
	}, "\n")
}

type commentWatchEvent struct {
	Type               string                     `json:"type"`
	SchemaVersion      int                        `json:"schemaVersion"`
	EventSchema        string                     `json:"eventSchema"`
	EventSchemaCommand []string                   `json:"eventSchemaCommand"`
	SessionID          string                     `json:"sessionId"`
	Sequence           int                        `json:"sequence"`
	Reason             string                     `json:"reason"`
	Changes            []string                   `json:"changes"`
	Cursor             string                     `json:"cursor"`
	EmittedAt          string                     `json:"emittedAt"`
	Count              int                        `json:"count"`
	Summary            commentOpenWorklistSummary `json:"summary"`
	Threads            []commentThreadOutput      `json:"threads"`
	Items              []commentWorkItemOutput    `json:"items,omitempty"`
}

type commentFollowEvent struct {
	Type               string                      `json:"type"`
	SchemaVersion      int                         `json:"schemaVersion"`
	EventSchema        string                      `json:"eventSchema"`
	EventSchemaCommand []string                    `json:"eventSchemaCommand"`
	SessionID          string                      `json:"sessionId"`
	Sequence           int                         `json:"sequence"`
	Reason             string                      `json:"reason"`
	ThreadID           string                      `json:"threadId"`
	Cursor             string                      `json:"cursor"`
	EmittedAt          string                      `json:"emittedAt"`
	Count              int                         `json:"count"`
	Summary            commentActivityBatchSummary `json:"summary"`
	Activities         []commentActivityOutput     `json:"activities"`
	Comments           []commentOutput             `json:"comments,omitempty"`
	File               map[string]any              `json:"file,omitempty"`
	Source             *sourceContextOutput        `json:"source,omitempty"`
	Diff               *textDiffOutput             `json:"diff,omitempty"`
}

type commentActivitySnapshots struct {
	Thread   *commentThreadOutput
	Comments []commentOutput
}

type commentBatchContextOutput struct {
	File   map[string]any
	Source *sourceContextOutput
	Diff   *textDiffOutput
}

type commentActivityBatchSummary struct {
	Kinds                      []string                  `json:"kinds"`
	RequiresAttention          bool                      `json:"requiresAttention"`
	AttentionReasons           []string                  `json:"attentionReasons"`
	RecommendedAction          string                    `json:"recommendedAction"`
	SuggestedCommands          []commentSuggestedCommand `json:"suggestedCommands,omitempty"`
	OwnActivityCount           int                       `json:"ownActivityCount"`
	ExternalActivityCount      int                       `json:"externalActivityCount"`
	HumanCommentCount          int                       `json:"humanCommentCount"`
	AgentCommentCount          int                       `json:"agentCommentCount"`
	TriageCommentCount         int                       `json:"triageCommentCount"`
	OwnCommentCount            int                       `json:"ownCommentCount"`
	ExternalCommentCount       int                       `json:"externalCommentCount"`
	ExternalAgentCommentCount  int                       `json:"externalAgentCommentCount"`
	OwnTriageCommentCount      int                       `json:"ownTriageCommentCount"`
	ExternalTriageCommentCount int                       `json:"externalTriageCommentCount"`
	CommentUpdateCount         int                       `json:"commentUpdateCount"`
	ClaimCount                 int                       `json:"claimCount"`
	OwnClaimCount              int                       `json:"ownClaimCount"`
	ExternalClaimCount         int                       `json:"externalClaimCount"`
	ReleaseCount               int                       `json:"releaseCount"`
	OwnReleaseCount            int                       `json:"ownReleaseCount"`
	ExternalReleaseCount       int                       `json:"externalReleaseCount"`
	StatusChangeCount          int                       `json:"statusChangeCount"`
	OwnStatusChangeCount       int                       `json:"ownStatusChangeCount"`
	ExternalStatusChangeCount  int                       `json:"externalStatusChangeCount"`
	ReadCount                  int                       `json:"readCount"`
	ThreadCreatedCount         int                       `json:"threadCreatedCount"`
	TerminalStatus             string                    `json:"terminalStatus,omitempty"`
}

type commentOpenWorklistSummary struct {
	RequiresAttention bool                      `json:"requiresAttention"`
	AttentionReasons  []string                  `json:"attentionReasons"`
	RecommendedAction string                    `json:"recommendedAction"`
	OpenThreadCount   int                       `json:"openThreadCount"`
	SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands,omitempty"`
}

type commentSuggestedCommand struct {
	Intent             string         `json:"intent"`
	Command            string         `json:"command"`
	Args               []string       `json:"args"`
	ClientEventID      string         `json:"clientEventId,omitempty"`
	StdinRequired      bool           `json:"stdinRequired,omitempty"`
	StdinSchema        string         `json:"stdinSchema,omitempty"`
	StdinSchemaCommand []string       `json:"stdinSchemaCommand,omitempty"`
	StdinExample       map[string]any `json:"stdinExample,omitempty"`
	Reason             string         `json:"reason"`
}

type commentSchemaOutput struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Schema      map[string]any         `json:"schema"`
	AcceptedBy  []commentSchemaCommand `json:"acceptedBy,omitempty"`
	Example     map[string]any         `json:"example,omitempty"`
	Schemas     []commentSchemaOutput  `json:"schemas,omitempty"`
}

type commentSchemaCommand struct {
	Command      string   `json:"command"`
	Flag         string   `json:"flag,omitempty"`
	StdinCommand []string `json:"stdinCommand,omitempty"`
}

type commentTriageOutput struct {
	Decision   string `json:"decision"`
	Summary    string `json:"summary,omitempty"`
	NextAction string `json:"nextAction,omitempty"`
	Details    string `json:"details,omitempty"`
	Body       string `json:"body"`
}

type commentTriageFileInput struct {
	Decision   string `json:"decision"`
	Summary    string `json:"summary"`
	NextAction string `json:"nextAction"`
	Details    string `json:"details"`
}

type commentResultOutput struct {
	Outcome      string   `json:"outcome"`
	Summary      string   `json:"summary,omitempty"`
	Verification []string `json:"verification,omitempty"`
	Details      string   `json:"details,omitempty"`
	Body         string   `json:"body"`
}

type commentResultFileInput struct {
	Summary      string   `json:"summary"`
	Verification []string `json:"verification"`
	Details      string   `json:"details"`
}

type commentWriteReceipt struct {
	SchemaVersion             int                         `json:"schemaVersion"`
	ReceiptSchema             string                      `json:"receiptSchema"`
	ReceiptSchemaCommand      []string                    `json:"receiptSchemaCommand"`
	VerificationCommand       []string                    `json:"verificationCommand"`
	VerificationSchema        string                      `json:"verificationSchema"`
	VerificationSchemaCommand []string                    `json:"verificationSchemaCommand"`
	Command                   string                      `json:"command"`
	ThreadID                  string                      `json:"threadId"`
	ActorID                   string                      `json:"actorId,omitempty"`
	ClientEventID             string                      `json:"clientEventId,omitempty"`
	CommentID                 string                      `json:"commentId,omitempty"`
	Status                    string                      `json:"status,omitempty"`
	Effects                   []commentWriteReceiptEffect `json:"effects"`
}

type commentWriteReceiptEffect struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	CommentID      string `json:"commentId,omitempty"`
	PreviousStatus string `json:"previousStatus,omitempty"`
	Status         string `json:"status,omitempty"`
	ClientEventID  string `json:"clientEventId,omitempty"`
	CreatedAt      string `json:"createdAt"`
}

type commentWriteReceiptVerification struct {
	SchemaVersion     int                         `json:"schemaVersion"`
	OK                bool                        `json:"ok"`
	Receipt           commentWriteReceipt         `json:"receipt"`
	Thread            commentThreadOutput         `json:"thread"`
	Checks            []commentReceiptCheck       `json:"checks"`
	MatchedEffects    []commentWriteReceiptEffect `json:"matchedEffects"`
	MissingEffects    []commentWriteReceiptEffect `json:"missingEffects"`
	SuggestedCommands []commentSuggestedCommand   `json:"suggestedCommands,omitempty"`
}

type commentWriteReceiptLedgerVerification struct {
	SchemaVersion     int                               `json:"schemaVersion"`
	OK                bool                              `json:"ok"`
	Count             int                               `json:"count"`
	Verified          int                               `json:"verified"`
	Failed            int                               `json:"failed"`
	Verifications     []commentWriteReceiptVerification `json:"verifications"`
	SuggestedCommands []commentSuggestedCommand         `json:"suggestedCommands,omitempty"`
}

type commentReceiptCheck struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type commentHoldEvent struct {
	Type      string                `json:"type"`
	Sequence  int                   `json:"sequence"`
	EmittedAt string                `json:"emittedAt"`
	Thread    commentThreadOutput   `json:"thread"`
	Renewal   commentActivityOutput `json:"renewal"`
}

type commentWorkItemOutput struct {
	Thread     commentThreadOutput     `json:"thread"`
	File       map[string]any          `json:"file,omitempty"`
	Source     *sourceContextOutput    `json:"source,omitempty"`
	Diff       *textDiffOutput         `json:"diff,omitempty"`
	Activities []commentActivityOutput `json:"activities,omitempty"`
}

type commentInboxGroupOutput struct {
	Threads []commentThreadOutput   `json:"threads"`
	Claims  []commentActivityOutput `json:"claims,omitempty"`
	Count   int                     `json:"count"`
	Items   []commentWorkItemOutput `json:"items,omitempty"`
}

type commentRoutingSummary struct {
	RequiresAttention      bool                      `json:"requiresAttention"`
	AttentionReasons       []string                  `json:"attentionReasons"`
	RecommendedAction      string                    `json:"recommendedAction"`
	TotalOpenThreadCount   int                       `json:"totalOpenThreadCount"`
	OpenThreadCount        int                       `json:"openThreadCount"`
	SourceUnavailableCount int                       `json:"sourceUnavailableCount"`
	MineCount              int                       `json:"mineCount"`
	UnclaimedCount         int                       `json:"unclaimedCount"`
	ClaimedByOthersCount   int                       `json:"claimedByOthersCount"`
	SuggestedCommands      []commentSuggestedCommand `json:"suggestedCommands,omitempty"`
}

type commentOpenRoutingOutput struct {
	Mine              commentInboxGroupOutput
	Unclaimed         commentInboxGroupOutput
	ClaimedByOthers   commentInboxGroupOutput
	SourceUnavailable commentInboxGroupOutput
}

type commentClaimOutput struct {
	Thread   commentThreadOutput   `json:"thread"`
	Activity commentActivityOutput `json:"activity"`
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

type filePayloadOutput struct {
	Path         string  `json:"path"`
	ViewerKind   string  `json:"viewerKind"`
	Encoding     string  `json:"encoding"`
	Content      string  `json:"content"`
	Etag         string  `json:"etag"`
	Size         int     `json:"size"`
	MtimeMs      float64 `json:"mtimeMs"`
	Truncated    bool    `json:"truncated,omitempty"`
	PreviewBytes int     `json:"previewBytes,omitempty"`
}

type commentContextPayload struct {
	File   map[string]any      `json:"file"`
	Source sourceContextOutput `json:"source"`
	Diff   *textDiffOutput     `json:"diff,omitempty"`
}

type sourceContextOutput struct {
	Path            string             `json:"path"`
	ViewerKind      string             `json:"viewerKind"`
	Encoding        string             `json:"encoding"`
	Available       bool               `json:"available"`
	Reason          string             `json:"reason,omitempty"`
	StartLine       int                `json:"startLine,omitempty"`
	EndLine         int                `json:"endLine,omitempty"`
	AnchorStartLine int                `json:"anchorStartLine,omitempty"`
	AnchorEndLine   int                `json:"anchorEndLine,omitempty"`
	Truncated       bool               `json:"truncated,omitempty"`
	Lines           []sourceLineOutput `json:"lines,omitempty"`
}

type sourceLineOutput struct {
	Number int    `json:"number"`
	Text   string `json:"text"`
	Anchor bool   `json:"anchor"`
}

type textDiffOutput struct {
	Path         string `json:"path"`
	Status       string `json:"status"`
	Kind         string `json:"kind,omitempty"`
	BaseLabel    string `json:"baseLabel"`
	BaseRef      string `json:"baseRef"`
	CompareLabel string `json:"compareLabel"`
	DiffHash     string `json:"diffHash,omitempty"`
	Content      string `json:"content"`
	Reason       string `json:"reason,omitempty"`
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
	LeaseExpiresAt string      `json:"leaseExpiresAt,omitempty"`
	CreatedAt      string      `json:"createdAt"`
}

type actorOutput struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	DisplayName string `json:"displayName,omitempty"`
}
