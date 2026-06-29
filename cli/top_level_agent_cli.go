package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

const supportedSimpleActors = "codex, claude"

type simpleAgentActor struct {
	Name string
	ID   string
	Kind string
}

type topLevelAgentOptions struct {
	URL      string
	ThreadID string
	Actor    simpleAgentActor
	ReadAs   simpleAgentActor
	Body     string
	Watch    bool
	Interval time.Duration
	Resolve  bool
	Archive  bool
}

type topLevelInboxItem struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	File   string `json:"file"`
	Body   string `json:"body"`
	Action string `json:"action"`
	ReadBy string `json:"readBy,omitempty"`
}

type topLevelWriteOutput struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Actor  string `json:"actor"`
	Status string `json:"status"`
}

func isTopLevelAgentCommand(command string) bool {
	switch command {
	case "inbox", "claim", "release", "reply":
		return true
	default:
		return false
	}
}

func runTopLevelAgentCommand(ctx context.Context, args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("error: missing command")
	}
	switch args[0] {
	case "inbox":
		return runTopLevelInbox(ctx, args[1:], stdout)
	case "claim":
		return runTopLevelClaim(ctx, args[1:], stdout)
	case "release":
		return runTopLevelRelease(ctx, args[1:], stdout)
	case "reply":
		return runTopLevelReply(ctx, args[1:], stdout)
	default:
		return fmt.Errorf("error: unknown command %q", args[0])
	}
}

func runTopLevelInbox(ctx context.Context, args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("vivi inbox", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	readAs := flags.String("read-as", "", "mark returned threads as read by codex or claude")
	watch := flags.Bool("watch", false, "keep polling and emit only new comment diffs after the first snapshot")
	interval := flags.Duration("interval", 2*time.Second, "watch polling interval")
	flagArgs, positional := splitTopLevelAgentFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return err
	}
	positional = append(positional, flags.Args()...)
	if len(positional) != 1 {
		return errors.New("error: inbox requires <url>")
	}
	options := topLevelAgentOptions{URL: strings.TrimRight(positional[0], "/"), Watch: *watch, Interval: *interval}
	if err := validateTopLevelURL(options.URL); err != nil {
		return err
	}
	if options.Watch && options.Interval <= 0 {
		return errors.New("error: inbox --watch requires a positive --interval")
	}
	if strings.TrimSpace(*readAs) != "" {
		actor, err := parseSimpleAgentActor(*readAs)
		if err != nil {
			return err
		}
		options.ReadAs = actor
	}
	return topLevelInbox(ctx, stdout, options)
}

func runTopLevelClaim(ctx context.Context, args []string, stdout io.Writer) error {
	options, err := parseTopLevelThreadCommand("claim", args, false)
	if err != nil {
		return err
	}
	if options.Actor.Name == "" {
		return missingActorError()
	}
	commentsOptions := topLevelCommentsOptions(options, options.Actor)
	thread, _, err := claimCommentThread(ctx, commentsOptions, options.ThreadID)
	if err != nil {
		return err
	}
	return writeCompactJSON(stdout, topLevelWriteOutput{Type: "claim", ID: options.ThreadID, Actor: options.Actor.Name, Status: thread.Status})
}

func runTopLevelRelease(ctx context.Context, args []string, stdout io.Writer) error {
	options, err := parseTopLevelThreadCommand("release", args, true)
	if err != nil {
		return err
	}
	if options.Actor.Name == "" {
		return missingActorError()
	}
	commentsOptions := topLevelCommentsOptions(options, options.Actor)
	if strings.TrimSpace(options.Body) != "" {
		if _, err := addCommentToThread(ctx, commentsOptions, options.ThreadID, options.Body); err != nil {
			return err
		}
	}
	thread, _, err := releaseCommentThreadClaim(ctx, commentsOptions, options.ThreadID)
	if err != nil {
		return err
	}
	return writeCompactJSON(stdout, topLevelWriteOutput{Type: "release", ID: options.ThreadID, Actor: options.Actor.Name, Status: thread.Status})
}

func runTopLevelReply(ctx context.Context, args []string, stdout io.Writer) error {
	options, err := parseTopLevelThreadCommand("reply", args, true)
	if err != nil {
		return err
	}
	if options.Actor.Name == "" {
		return missingActorError()
	}
	if strings.TrimSpace(options.Body) == "" {
		return errors.New("error: missing reply body; pass --body <text> or --body-file <path|->")
	}
	if options.Resolve && options.Archive {
		return errors.New("error: pass only one of --resolve or --archive")
	}
	commentsOptions := topLevelCommentsOptions(options, options.Actor)
	if _, err := addCommentToThread(ctx, commentsOptions, options.ThreadID, options.Body); err != nil {
		return err
	}
	status := "open"
	if options.Resolve {
		thread, err := updateCommentThreadLifecycle(ctx, commentsOptions, options.ThreadID, "resolve")
		if err != nil {
			return err
		}
		status = thread.Status
	}
	if options.Archive {
		thread, err := updateCommentThreadLifecycle(ctx, commentsOptions, options.ThreadID, "archive")
		if err != nil {
			return err
		}
		status = thread.Status
	}
	return writeCompactJSON(stdout, topLevelWriteOutput{Type: "reply", ID: options.ThreadID, Actor: options.Actor.Name, Status: status})
}

func parseTopLevelThreadCommand(command string, args []string, allowBody bool) (topLevelAgentOptions, error) {
	flags := flag.NewFlagSet("vivi "+command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	actorValue := flags.String("actor", "", "reply actor: codex or claude")
	body := flags.String("body", "", "reply body")
	bodyFile := flags.String("body-file", "", "path to read reply body from")
	resolve := flags.Bool("resolve", false, "resolve after replying")
	archive := flags.Bool("archive", false, "archive after replying")
	flagArgs, positional := splitTopLevelAgentFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return topLevelAgentOptions{}, err
	}
	positional = append(positional, flags.Args()...)
	if len(positional) != 2 {
		return topLevelAgentOptions{}, fmt.Errorf("error: %s requires <url> <thread-id>", command)
	}
	options := topLevelAgentOptions{
		URL:      strings.TrimRight(positional[0], "/"),
		ThreadID: strings.TrimSpace(positional[1]),
		Resolve:  *resolve,
		Archive:  *archive,
	}
	if err := validateTopLevelURL(options.URL); err != nil {
		return topLevelAgentOptions{}, err
	}
	if options.ThreadID == "" {
		return topLevelAgentOptions{}, fmt.Errorf("error: %s requires <thread-id>", command)
	}
	if strings.TrimSpace(*actorValue) != "" {
		actor, err := parseSimpleAgentActor(*actorValue)
		if err != nil {
			return topLevelAgentOptions{}, err
		}
		options.Actor = actor
	}
	if !allowBody && (strings.TrimSpace(*body) != "" || strings.TrimSpace(*bodyFile) != "" || *resolve || *archive) {
		return topLevelAgentOptions{}, fmt.Errorf("error: %s does not accept reply body or lifecycle flags", command)
	}
	if strings.TrimSpace(*body) != "" && strings.TrimSpace(*bodyFile) != "" {
		return topLevelAgentOptions{}, errors.New("error: --body and --body-file are mutually exclusive")
	}
	if strings.TrimSpace(*bodyFile) != "" {
		bodyBytes, err := readCommentBodyFile(*bodyFile)
		if err != nil {
			return topLevelAgentOptions{}, fmt.Errorf("error: read --body-file: %w", err)
		}
		options.Body = string(bodyBytes)
	} else {
		options.Body = *body
	}
	return options, nil
}

func topLevelInbox(ctx context.Context, stdout io.Writer, options topLevelAgentOptions) error {
	if options.Watch {
		return topLevelInboxWatch(ctx, stdout, options)
	}
	threads, _, err := fetchCommentThreads(ctx, topLevelInboxCommentsOptions(options, ""), "open")
	if err != nil {
		return err
	}
	return writeTopLevelInboxItems(stdout, options, orderCommentThreadsForAgent(threads))
}

func topLevelInboxWatch(ctx context.Context, stdout io.Writer, options topLevelAgentOptions) error {
	seen := map[string]string{}
	first := true
	for {
		threads, _, err := fetchCommentThreads(ctx, topLevelInboxCommentsOptions(options, ""), "open")
		if err != nil {
			if waitErr := waitTopLevelInboxInterval(ctx, options.Interval); waitErr != nil {
				return nil
			}
			continue
		}
		ordered := orderCommentThreadsForAgent(threads)
		changed := topLevelInboxChangedThreads(ordered, seen, first)
		if len(changed) > 0 {
			if options.ReadAs.Name != "" {
				cursor := topLevelInboxCursor(changed)
				readThreads, _, err := fetchCommentThreads(ctx, topLevelInboxCommentsOptions(options, cursor), "open")
				if err != nil {
					if waitErr := waitTopLevelInboxInterval(ctx, options.Interval); waitErr != nil {
						return nil
					}
					continue
				}
				changed = topLevelInboxChangedThreads(orderCommentThreadsForAgent(readThreads), seen, first)
			}
			if err := writeTopLevelInboxItems(stdout, options, changed); err != nil {
				return err
			}
		}
		seen = topLevelInboxSnapshot(ordered)
		first = false
		if err := waitTopLevelInboxInterval(ctx, options.Interval); err != nil {
			return nil
		}
	}
}

func topLevelInboxCommentsOptions(options topLevelAgentOptions, cursor string) commentsCommandOptions {
	commentsOptions := commentsCommandOptions{URL: options.URL, Status: "open", JSON: true}
	if options.ReadAs.Name != "" {
		commentsOptions.ActorID = options.ReadAs.ID
		commentsOptions.ActorKind = options.ReadAs.Kind
		commentsOptions.ActorName = options.ReadAs.Name
		commentsOptions.ClientEventID = "top-level-inbox:" + options.ReadAs.Name
		if cursor != "" {
			commentsOptions.ClientEventID += ":" + cursor
		}
	}
	return commentsOptions
}

func topLevelInboxChangedThreads(threads []commentThreadOutput, seen map[string]string, first bool) []commentThreadOutput {
	changed := []commentThreadOutput{}
	for _, thread := range threads {
		key := topLevelInboxThreadKey(thread)
		previous, ok := seen[thread.ID]
		if first || !ok || previous != key {
			changed = append(changed, thread)
		}
	}
	return changed
}

func topLevelInboxSnapshot(threads []commentThreadOutput) map[string]string {
	snapshot := map[string]string{}
	for _, thread := range threads {
		snapshot[thread.ID] = topLevelInboxThreadKey(thread)
	}
	return snapshot
}

func topLevelInboxThreadKey(thread commentThreadOutput) string {
	if human := latestHumanComment(thread); human != nil {
		return human.ID
	}
	if len(thread.Comments) == 0 {
		return ""
	}
	return thread.Comments[len(thread.Comments)-1].ID
}

func topLevelInboxCursor(threads []commentThreadOutput) string {
	hash := sha256.New()
	for _, thread := range threads {
		_, _ = io.WriteString(hash, thread.ID)
		_, _ = io.WriteString(hash, "\x00")
		_, _ = io.WriteString(hash, topLevelInboxThreadKey(thread))
		_, _ = io.WriteString(hash, "\x00")
	}
	return hex.EncodeToString(hash.Sum(nil))[:16]
}

func writeTopLevelInboxItems(stdout io.Writer, options topLevelAgentOptions, threads []commentThreadOutput) error {
	for _, thread := range threads {
		item := topLevelInboxItem{Type: "comment", ID: thread.ID, File: thread.Path, Body: latestThreadBody(thread), Action: "reply"}
		if options.ReadAs.Name != "" {
			item.ReadBy = options.ReadAs.Name
		}
		if err := writeCompactJSON(stdout, item); err != nil {
			return err
		}
	}
	return nil
}

func waitTopLevelInboxInterval(ctx context.Context, interval time.Duration) error {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func topLevelCommentsOptions(options topLevelAgentOptions, actor simpleAgentActor) commentsCommandOptions {
	return commentsCommandOptions{
		URL:           options.URL,
		JSON:          true,
		ActorID:       actor.ID,
		ActorKind:     actor.Kind,
		ActorName:     actor.Name,
		Body:          options.Body,
		LeaseDuration: 10 * time.Minute,
	}
}

func latestThreadBody(thread commentThreadOutput) string {
	if human := latestHumanComment(thread); human != nil {
		return human.Body
	}
	if len(thread.Comments) == 0 {
		return ""
	}
	return thread.Comments[len(thread.Comments)-1].Body
}

func parseSimpleAgentActor(value string) (simpleAgentActor, error) {
	switch strings.TrimSpace(value) {
	case "codex":
		return simpleAgentActor{Name: "codex", ID: "codex", Kind: "codex"}, nil
	case "claude":
		return simpleAgentActor{Name: "claude", ID: "claude", Kind: "claude_code"}, nil
	default:
		return simpleAgentActor{}, fmt.Errorf("error: unsupported actor %q; expected one of: %s", strings.TrimSpace(value), supportedSimpleActors)
	}
}

func missingActorError() error {
	return fmt.Errorf("error: missing required --actor; expected one of: %s", supportedSimpleActors)
}

func validateTopLevelURL(rawURL string) error {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("error: invalid url %q", rawURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("error: invalid url %q", rawURL)
	}
	return nil
}

func splitTopLevelAgentFlagsAndPositionals(args []string) ([]string, []string) {
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
		if topLevelAgentFlagRequiresValue(arg) && !strings.Contains(arg, "=") && i+1 < len(args) {
			i++
			flagArgs = append(flagArgs, args[i])
		}
	}
	return flagArgs, positionals
}

func topLevelAgentFlagRequiresValue(arg string) bool {
	name := strings.TrimLeft(arg, "-")
	if before, _, ok := strings.Cut(name, "="); ok {
		name = before
	}
	switch name {
	case "actor", "body", "body-file", "read-as", "interval":
		return true
	default:
		return false
	}
}

func writeCompactJSON(stdout io.Writer, value any) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}
