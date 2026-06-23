package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
)

const reviewCLISchemaVersion = 1

type reviewCommandOptions struct {
	URL   string
	JSON  bool
	Base  string
	Actor string
}

type reviewQueueOutput struct {
	Available bool                 `json:"available"`
	Reason    string               `json:"reason,omitempty"`
	Changes   []reviewChangeOutput `json:"changes"`
}

type reviewChangeOutput struct {
	Path         string `json:"path"`
	Status       string `json:"status"`
	Kind         string `json:"kind,omitempty"`
	OriginalPath string `json:"originalPath,omitempty"`
}

type reviewDiffBaseSummaryOutput struct {
	Available bool                   `json:"available"`
	Reason    string                 `json:"reason,omitempty"`
	Options   []reviewDiffBaseOutput `json:"options"`
}

type reviewDiffBaseOutput struct {
	Ref     string `json:"ref"`
	Label   string `json:"label"`
	Subject string `json:"subject,omitempty"`
}

type reviewRoutingSummary struct {
	RequiresAttention bool                      `json:"requiresAttention"`
	AttentionReasons  []string                  `json:"attentionReasons"`
	RecommendedAction string                    `json:"recommendedAction"`
	ChangedFileCount  int                       `json:"changedFileCount"`
	SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands,omitempty"`
}

type reviewCommandError struct {
	cause   error
	payload reviewErrorEnvelope
}

type reviewErrorEnvelope struct {
	Error reviewErrorOutput `json:"error"`
}

type reviewErrorOutput struct {
	SchemaVersion     int                       `json:"schemaVersion"`
	Code              string                    `json:"code"`
	Message           string                    `json:"message"`
	Command           string                    `json:"command"`
	Args              []string                  `json:"args,omitempty"`
	Recoverable       bool                      `json:"recoverable"`
	SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands,omitempty"`
}

func (err *reviewCommandError) Error() string {
	return err.cause.Error()
}

func (err *reviewCommandError) Unwrap() error {
	return err.cause
}

func (err *reviewCommandError) CLIPayload() any {
	return err.payload
}

func newReviewCommandError(args []string, cause error) error {
	commandName := ""
	command := "review"
	if len(args) > 0 {
		commandName = args[0]
		command = "review " + commandName
	}
	code := reviewErrorCode(commandName, cause)
	return &reviewCommandError{
		cause: cause,
		payload: reviewErrorEnvelope{
			Error: reviewErrorOutput{
				SchemaVersion:     reviewCLISchemaVersion,
				Code:              code,
				Message:           cause.Error(),
				Command:           command,
				Args:              append([]string{"review"}, args...),
				Recoverable:       reviewErrorRecoverable(code),
				SuggestedCommands: suggestedCommandsForReviewError(args, code),
			},
		},
	}
}

func reviewWantsJSON(args []string) bool {
	return commentsWantsJSON(args)
}

func reviewErrorCode(command string, err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "connection refused") ||
		strings.Contains(message, "connect:") ||
		strings.Contains(message, "no such host") ||
		strings.Contains(message, "context deadline exceeded"):
		return "server_unreachable"
	case strings.Contains(message, "graphql error"):
		return "upstream_graphql_error"
	case strings.Contains(message, "requires") ||
		strings.Contains(message, "unexpected argument") ||
		strings.Contains(message, "unknown review command") ||
		strings.Contains(message, "invalid --url"):
		return "invalid_arguments"
	default:
		if command == "" {
			return "invalid_arguments"
		}
		return "review_command_failed"
	}
}

func reviewErrorRecoverable(code string) bool {
	switch code {
	case "server_unreachable", "upstream_graphql_error", "review_command_failed":
		return true
	default:
		return false
	}
}

func suggestedCommandsForReviewError(args []string, code string) []commentSuggestedCommand {
	serverURL := commentsSuggestedServerURL(args)
	switch code {
	case "server_unreachable", "upstream_graphql_error", "review_command_failed":
		return []commentSuggestedCommand{
			suggestedCommentsCommand("retry_review_queue", "review queue", withURLArg([]string{"review", "queue", "--json"}, serverURL), "", "After starting Vivi or correcting --url/VIVI_URL, retry the Git working-tree review queue."),
		}
	case "invalid_arguments":
		return []commentSuggestedCommand{
			suggestedCommentsCommand("inspect_review_help", "review --help", []string{"review", "--help"}, "", "Inspect the Git working-tree review CLI usage before retrying."),
		}
	default:
		return nil
	}
}

func runReviewCommand(ctx context.Context, args []string, stdout io.Writer) error {
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		fmt.Fprintln(stdout, reviewHelpText())
		return nil
	}
	command := args[0]
	options, positional, err := parseReviewFlags(command, args[1:])
	if err != nil {
		return err
	}
	switch command {
	case "queue", "status":
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		return reviewQueue(ctx, stdout, options)
	case "bases":
		if len(positional) > 0 {
			return fmt.Errorf("unexpected argument %q", positional[0])
		}
		return reviewBases(ctx, stdout, options)
	case "diff":
		if len(positional) != 1 {
			return errors.New("review diff requires exactly one path")
		}
		return reviewDiff(ctx, stdout, options, positional[0])
	default:
		return fmt.Errorf("unknown review command %q", command)
	}
}

func parseReviewFlags(command string, args []string) (reviewCommandOptions, []string, error) {
	options := reviewCommandOptions{
		URL:  strings.TrimRight(os.Getenv("VIVI_URL"), "/"),
		JSON: true,
		Base: "HEAD",
	}
	if options.URL == "" {
		options.URL = defaultCommentsURL
	}
	flags := flag.NewFlagSet("vivi review "+command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.URL, "url", options.URL, "Vivi server URL")
	flags.BoolVar(&options.JSON, "json", true, "write JSON output")
	flags.StringVar(&options.Base, "base", options.Base, "Git diff base ref")
	flags.StringVar(&options.Actor, "actor", options.Actor, "Actor id for comments work suggestions")
	flagArgs, positional := splitReviewFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return options, nil, err
	}
	options.URL = strings.TrimRight(options.URL, "/")
	options.Actor = strings.TrimSpace(options.Actor)
	if options.URL == "" {
		options.URL = defaultCommentsURL
	}
	if _, err := url.ParseRequestURI(options.URL); err != nil {
		return options, nil, fmt.Errorf("invalid --url: %w", err)
	}
	return options, append(positional, flags.Args()...), nil
}

func splitReviewFlagsAndPositionals(args []string) ([]string, []string) {
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
		if reviewFlagRequiresValue(arg) && !strings.Contains(arg, "=") && i+1 < len(args) {
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

func reviewFlagRequiresValue(arg string) bool {
	name := strings.TrimLeft(arg, "-")
	if before, _, ok := strings.Cut(name, "="); ok {
		name = before
	}
	switch name {
	case "url", "base", "actor":
		return true
	default:
		return false
	}
}

func reviewQueue(ctx context.Context, stdout io.Writer, options reviewCommandOptions) error {
	var queue reviewQueueOutput
	if err := postGraphQL(ctx, commentsCommandOptions{URL: options.URL}, graphqlRequest{
		OperationName: "ReviewQueueForCLI",
		Query: `query ReviewQueueForCLI {
			reviewQueue {
				available
				reason
				changes { path status kind originalPath }
			}
		}`,
	}, "reviewQueue", &queue); err != nil {
		return err
	}
	var bases reviewDiffBaseSummaryOutput
	if err := postGraphQL(ctx, commentsCommandOptions{URL: options.URL}, graphqlRequest{
		OperationName: "ReviewDiffBasesForCLI",
		Query: `query ReviewDiffBasesForCLI {
			diffBases {
				available
				reason
				options { ref label subject }
			}
		}`,
	}, "diffBases", &bases); err != nil {
		return err
	}
	output := map[string]any{
		"schemaVersion": reviewCLISchemaVersion,
		"available":     queue.Available,
		"reason":        queue.Reason,
		"count":         len(queue.Changes),
		"changes":       queue.Changes,
		"diffBases":     bases,
		"summary":       summarizeReviewQueue(queue, bases, options.URL, options.Actor),
	}
	return writeJSON(stdout, output)
}

func reviewBases(ctx context.Context, stdout io.Writer, options reviewCommandOptions) error {
	var bases reviewDiffBaseSummaryOutput
	if err := postGraphQL(ctx, commentsCommandOptions{URL: options.URL}, graphqlRequest{
		OperationName: "ReviewDiffBasesForCLI",
		Query: `query ReviewDiffBasesForCLI {
			diffBases {
				available
				reason
				options { ref label subject }
			}
		}`,
	}, "diffBases", &bases); err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{
		"schemaVersion": reviewCLISchemaVersion,
		"diffBases":     bases,
	})
}

func reviewDiff(ctx context.Context, stdout io.Writer, options reviewCommandOptions, path string) error {
	var diff textDiffOutput
	if err := postGraphQL(ctx, commentsCommandOptions{URL: options.URL}, graphqlRequest{
		OperationName: "ReviewDiffForCLI",
		Query: `query ReviewDiffForCLI($path: String!, $base: String) {
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
		Variables: map[string]any{"path": path, "base": strings.TrimSpace(options.Base)},
	}, "diff", &diff); err != nil {
		return err
	}
	return writeJSON(stdout, map[string]any{
		"schemaVersion": reviewCLISchemaVersion,
		"diff":          diff,
	})
}

func summarizeReviewQueue(queue reviewQueueOutput, bases reviewDiffBaseSummaryOutput, serverURL string, actorID string) reviewRoutingSummary {
	summary := reviewRoutingSummary{
		RequiresAttention: false,
		AttentionReasons:  []string{},
		RecommendedAction: "wait_for_changes",
		ChangedFileCount:  len(queue.Changes),
	}
	if !queue.Available {
		summary.RequiresAttention = true
		summary.AttentionReasons = []string{"git_review_unavailable"}
		summary.RecommendedAction = "inspect_git_availability"
		return summary
	}
	if len(queue.Changes) == 0 {
		summary.SuggestedCommands = []commentSuggestedCommand{
			reviewQueueCommentsWorkSuggestion(actorID, serverURL, "Wait for GUI review comments when there are no changed files to inspect."),
		}
		return summary
	}
	summary.RequiresAttention = true
	summary.AttentionReasons = []string{"changed_files_available"}
	summary.RecommendedAction = "review_changed_files"
	base := "HEAD"
	if len(bases.Options) > 0 && strings.TrimSpace(bases.Options[0].Ref) != "" {
		base = bases.Options[0].Ref
	}
	firstPath := queue.Changes[0].Path
	summary.SuggestedCommands = []commentSuggestedCommand{
		suggestedCommentsCommand("inspect_first_changed_file_diff", "review diff", withURLArg([]string{"review", "diff", firstPath, "--base", base, "--json"}, serverURL), "", "Inspect the first changed file diff before deciding whether to comment or continue."),
		reviewQueueCommentsWorkSuggestion(actorID, serverURL, "Keep a resident GUI feedback loop running while reviewing changed files."),
	}
	return summary
}

func reviewQueueCommentsWorkSuggestion(actorID string, serverURL string, description string) commentSuggestedCommand {
	if actorID == "" {
		return suggestedCommentsCommand("choose_agent_actor", "comments doctor", withURLArg([]string{"comments", "doctor", "--actor", "<actor-id>", "--json"}, serverURL), "", "Choose a stable actor id before starting a resident GUI feedback loop.")
	}
	return suggestedCommentsCommandWithClientEventID("wait_for_gui_feedback", "comments work", withURLArg([]string{"comments", "work", "--actor", actorID, "--wait", "--loop", "--idle-events", "--full", "--json"}, serverURL), "", description, "review-queue:"+actorID+":work")
}

func reviewHelpText() string {
	return strings.Join([]string{
		"vivi review - agent-oriented Git review CLI",
		"",
		"Agent quick path:",
		"  1. List the Git working-tree review queue: vivi review queue --actor <actor> --json",
		"  2. Inspect a changed file: vivi review diff <path> --base HEAD --json",
		"  3. Use vivi comments work --actor <actor> --wait --loop --idle-events --full --json for human GUI feedback",
		"",
		"Usage:",
		"  vivi review queue --actor codex --url http://127.0.0.1:4317 --json",
		"  vivi review bases --url http://127.0.0.1:4317 --json",
		"  vivi review diff <path> --base HEAD --url http://127.0.0.1:4317 --json",
		"",
		"Options:",
		"  --url <server>            Vivi server URL (default: VIVI_URL or http://127.0.0.1:4317)",
		"  --base <ref>              Git diff base for review diff (default: HEAD)",
		"  --actor <id>              Actor id used in comments work suggestions",
		"  --json                    Write JSON output",
	}, "\n")
}
