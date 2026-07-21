package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/tasuku43/vivi/internal/telemetry"
	"github.com/tasuku43/vivi/server"
	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	"github.com/tasuku43/vivi/server/reviewledger"
	"github.com/tasuku43/vivi/server/workspace"
)

var version = "0.0.0"
var viviExecutable = "vivi"

func main() {
	viviExecutable = invokedViviExecutable(os.Args)
	if err := run(os.Args[1:]); err != nil {
		if payload, ok := cliErrorPayload(err); ok {
			_ = writeJSON(os.Stdout, payload)
		} else {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}

func invokedViviExecutable(args []string) string {
	if len(args) == 0 || strings.TrimSpace(args[0]) == "" {
		return "vivi"
	}
	return args[0]
}

func run(args []string) error {
	if len(args) > 0 && isTopLevelAgentCommand(args[0]) {
		return runTopLevelAgentCommand(context.Background(), args, os.Stdout)
	}
	if len(args) > 0 && args[0] == "comments" {
		err := runCommentsCommand(context.Background(), args[1:], os.Stdout)
		if err != nil && commentsWantsJSON(args[1:]) {
			return newCommentsCommandError(args[1:], err)
		}
		return err
	}
	if len(args) > 0 && args[0] == "review" {
		err := runReviewCommand(context.Background(), args[1:], os.Stdout)
		if err != nil && reviewWantsJSON(args[1:]) {
			return newReviewCommandError(args[1:], err)
		}
		return err
	}
	flags := flag.NewFlagSet("vivi", flag.ContinueOnError)
	flags.SetOutput(os.Stdout)
	host := flags.String("host", "127.0.0.1", "host to bind")
	port := flags.Int("port", 4317, "port to bind")
	portExplicit := hasFlagArg(args, "port")
	open := flags.Bool("open", false, "open browser after startup")
	include := flags.String("include", "", "comma-separated extension allow-list")
	maxFileSize := flags.Int64("max-file-size", 1024*1024, "rich preview byte limit")
	allowHTMLScripts := flags.Bool("allow-html-scripts", false, "allow scripts in HTML preview for trusted files")
	noHTMLScripts := flags.Bool("no-html-scripts", false, "keep HTML preview scripts disabled")
	gitTimeout := flags.Duration("git-review-timeout", 2*time.Second, "Git review timeout")
	logLevel := flags.String("log-level", "info", "log level")
	actor := flags.String("actor", "", "review actor id for browser comments")
	readyJSON := flags.Bool("ready-json", false, "print a JSON server-ready event after startup")
	showVersion := flags.Bool("version", false, "print version")
	flags.Usage = func() { fmt.Fprintln(flags.Output(), helpText()) }
	flagArgs, positional := splitFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		if err == flag.ErrHelp {
			return nil
		}
		return err
	}
	if *showVersion {
		fmt.Println(version)
		return nil
	}
	_ = logLevel
	if *noHTMLScripts {
		*allowHTMLScripts = false
	}
	telemetryShutdown, err := telemetry.Init(context.Background(), os.Stderr)
	if err != nil {
		return err
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = telemetryShutdown(shutdownCtx)
	}()
	root := "."
	if len(positional) > 0 {
		root = positional[0]
	}
	workspaceFS, err := workspace.New(workspace.Options{
		Root:             root,
		Include:          parseInclude(*include),
		MaxFileSizeBytes: *maxFileSize,
		AllowHTMLScripts: *allowHTMLScripts,
	})
	if err != nil {
		return err
	}
	reviewer, err := gitreview.New(workspaceFS.Config().Root, *gitTimeout)
	if err != nil {
		return err
	}
	workspaceDataDir := comments.WorkspaceDataDir(workspaceFS.Config().Root)
	commentStore, err := comments.NewStore(workspaceDataDir)
	if err != nil {
		return err
	}
	reviewLedger, err := reviewledger.NewStore(workspaceDataDir)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	httpServer, err := startViviServer(ctx, server.Options{
		Host:             *host,
		Port:             *port,
		Workspace:        workspaceFS,
		Git:              reviewer,
		Comments:         commentStore,
		ReviewLedger:     reviewLedger,
		AllowHTMLScripts: *allowHTMLScripts,
		ReviewActor:      reviewActorFromFlag(*actor),
	}, !portExplicit && *port == 4317)
	if err != nil {
		return err
	}
	if *readyJSON {
		if err := writeJSON(os.Stdout, newServerReadyPayload(workspaceFS.Config().Root, httpServer.URL())); err != nil {
			return err
		}
	} else {
		fmt.Printf("Vivi serving %s\n", workspaceFS.Config().Root)
		fmt.Printf("Browser: %s\n", httpServer.URL())
		fmt.Printf("Agent review: %s inbox %s\n", viviExecutable, httpServer.URL())
	}
	if *open {
		_ = openBrowser(httpServer.URL())
	}
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return httpServer.Close(shutdownCtx)
}

type cliErrorPayloadProvider interface {
	CLIPayload() any
}

func cliErrorPayload(err error) (any, bool) {
	var provider cliErrorPayloadProvider
	if errors.As(err, &provider) {
		return provider.CLIPayload(), true
	}
	return nil, false
}

func hasHelpFlag(args []string) bool {
	for _, arg := range args {
		if arg == "--" {
			return false
		}
		if arg == "--help" || arg == "-h" {
			return true
		}
	}
	return false
}

func looksLikeServerURL(arg string) bool {
	return strings.HasPrefix(arg, "http://") || strings.HasPrefix(arg, "https://")
}

func removeFirstArg(args []string, target string) []string {
	next := make([]string, 0, len(args))
	removed := false
	for _, arg := range args {
		if !removed && arg == target {
			removed = true
			continue
		}
		next = append(next, arg)
	}
	return next
}

func helpText() string {
	return strings.Join([]string{
		"vivi - local review adapter",
		"",
		"Usage:",
		"  vivi [root] [--host 127.0.0.1] [--port 4317] [--open] [--include md,html,ts] [--max-file-size 1048576] [--allow-html-scripts]",
		"  vivi inbox <url> [--read-as codex|claude]",
		"  vivi reply <url> <thread-id> --actor codex|claude (--body <text>|--body-file <path|->) [--resolve|--archive]",
		"  vivi review <queue|bases|diff> [options]",
		"  vivi comments <work|doctor|mine|check|triage|release|done|dismiss> [options]",
		"  vivi comments <protocol|schema|inbox|watch|follow|claim|renew|hold|active|next|list|show|context|reply|resolve|archive|reopen> [advanced]",
		"",
		"Human:",
		"  vivi [root] --open",
		"",
		"Agent:",
		"  vivi inbox <url>",
		"  vivi inbox <url> --read-as codex",
		"  vivi reply <url> <thread-id> --actor codex --body <text>",
		"  vivi reply <url> <thread-id> --actor codex --resolve --body-file <path|->",
		"  Fetch published review comments when asked; inbox exits after the current snapshot.",
		"",
		"Changed-file context:",
		"  vivi review queue --actor <actor> --json",
		"  vivi review diff <path> --base HEAD --json",
		"",
		"Debug/recovery:",
		"  vivi comments doctor|mine|check|protocol|schema|work|watch ...",
		"",
		"Deeper help:",
		"  vivi comments --help",
		"  vivi review --help",
		"",
		"Options:",
		"  --host <host>              Host to bind (default: 127.0.0.1)",
		"  --port <port>              Port to bind (default: 4317, auto-increments when unavailable; 0 for random)",
		"  --open                     Open the browser after startup",
		"  --include <extensions>     Comma-separated extension allow-list",
		"  --max-file-size <bytes>    Rich preview byte limit",
		"  --allow-html-scripts       Allow scripts in HTML preview for trusted files",
		"  --no-html-scripts          Keep HTML preview scripts disabled",
		"  --git-review-timeout <d>   Git review timeout such as 2s or 500ms",
		"  --log-level <level>        Log level (default: info)",
		"  --ready-json               Print a JSON server-ready event after startup",
		"  --version                  Print version",
		"  --help                     Show this help",
	}, "\n")
}

type serverReadyPayload struct {
	SchemaVersion     int                       `json:"schemaVersion"`
	Event             string                    `json:"event"`
	Root              string                    `json:"root"`
	URL               string                    `json:"url"`
	SuggestedCommands []commentSuggestedCommand `json:"suggestedCommands"`
}

func newServerReadyPayload(root string, serverURL string) serverReadyPayload {
	inboxArgs := []string{"inbox", serverURL}
	reviewArgs := []string{"review", "queue", "--url", serverURL}
	doctorArgs := []string{"comments", "doctor", "--url", serverURL}
	reviewArgs = append(reviewArgs, "--json")
	doctorArgs = append(doctorArgs, "--json")
	suggestions := []commentSuggestedCommand{
		suggestedCommentsCommand(
			"fetch_published_review",
			"inbox",
			inboxArgs,
			"",
			"Fetch the currently published open review comments once. Run it again when the human asks or when the agent chooses to refresh.",
		).withPrimary().withOutput("agent_safe", "current_snapshot"),
		suggestedCommentsCommand(
			"inspect_review_queue_context",
			"review queue",
			reviewArgs,
			"",
			"Optional changed-file context for an agent that needs to inspect the workspace delta.",
		),
		suggestedCommentsCommand(
			"check_comments_readiness",
			"comments doctor",
			doctorArgs,
			"",
			"Optional online readiness and recovery check for the comments protocol.",
		),
	}
	return serverReadyPayload{
		SchemaVersion:     1,
		Event:             "vivi_server_ready",
		Root:              root,
		URL:               serverURL,
		SuggestedCommands: suggestions,
	}
}

func reviewActorFromFlag(actor string) *workspace.Actor {
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return nil
	}
	return &workspace.Actor{
		ID:          actor,
		Kind:        "human",
		DisplayName: actor,
	}
}

func startViviServer(ctx context.Context, options server.Options, incrementDefaultPort bool) (*server.Server, error) {
	for {
		httpServer, err := server.Start(ctx, options)
		if err == nil {
			return httpServer, nil
		}
		if !incrementDefaultPort || !addressAlreadyInUse(err) || options.Port <= 0 || options.Port >= 65535 {
			return nil, err
		}
		options.Port++
	}
}

func addressAlreadyInUse(err error) bool {
	if errors.Is(err, syscall.EADDRINUSE) {
		return true
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return strings.Contains(strings.ToLower(opErr.Error()), "address already in use")
	}
	return strings.Contains(strings.ToLower(err.Error()), "address already in use")
}

func splitFlagsAndPositionals(args []string) ([]string, []string) {
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
		if flagRequiresValue(arg) && !strings.Contains(arg, "=") && i+1 < len(args) {
			i++
			flagArgs = append(flagArgs, args[i])
		}
	}
	return flagArgs, positionals
}

func hasFlagArg(args []string, name string) bool {
	long := "--" + name
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			return false
		}
		if arg == long || strings.HasPrefix(arg, long+"=") {
			return true
		}
	}
	return false
}

func flagRequiresValue(arg string) bool {
	name := strings.TrimLeft(arg, "-")
	if before, _, ok := strings.Cut(name, "="); ok {
		name = before
	}
	switch name {
	case "host", "port", "include", "max-file-size", "git-review-timeout", "log-level", "actor":
		return true
	default:
		return false
	}
}

func parseInclude(value string) []string {
	parts := []string{}
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimPrefix(strings.TrimSpace(item), ".")
		if item != "" {
			parts = append(parts, item)
		}
	}
	return parts
}

func openBrowser(rawURL string) error {
	if _, err := url.Parse(rawURL); err != nil {
		return err
	}
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
		args = []string{rawURL}
	case "windows":
		command = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", rawURL}
	default:
		command = "xdg-open"
		args = []string{rawURL}
	}
	cmd := exec.Command(command, args...)
	return cmd.Start()
}

func init() {
	flag.CommandLine.Usage = func() {
		fmt.Fprintln(os.Stdout, helpText())
	}
}
