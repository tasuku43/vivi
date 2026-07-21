package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"strings"
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
	case "claim", "release":
		return fmt.Errorf("error: vivi %s was removed with the resident inbox workflow; use one-shot inbox and reply", args[0])
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
	flagArgs, positional := splitTopLevelAgentFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return err
	}
	positional = append(positional, flags.Args()...)
	if len(positional) != 1 {
		return errors.New("error: inbox requires <url>")
	}
	options := topLevelAgentOptions{URL: strings.TrimRight(positional[0], "/")}
	if err := validateTopLevelURL(options.URL); err != nil {
		return err
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
	threads, _, err := fetchCommentThreads(ctx, topLevelInboxCommentsOptions(options, ""), "open")
	if err != nil {
		return err
	}
	return writeTopLevelInboxItems(stdout, options, orderCommentThreadsForAgent(threads))
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

func topLevelCommentsOptions(options topLevelAgentOptions, actor simpleAgentActor) commentsCommandOptions {
	return commentsCommandOptions{
		URL:       options.URL,
		JSON:      true,
		ActorID:   actor.ID,
		ActorKind: actor.Kind,
		ActorName: actor.Name,
		Body:      options.Body,
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
