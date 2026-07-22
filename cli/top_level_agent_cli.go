package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
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
	JSON     bool
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
	case "servers", "inbox", "claim", "release", "reply":
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
	case "servers":
		return runTopLevelServers(ctx, args[1:], stdout)
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

func runTopLevelServers(ctx context.Context, args []string, stdout io.Writer) error {
	if hasHelpFlag(args) {
		_, err := fmt.Fprintln(stdout, topLevelServersHelpText())
		return err
	}
	if len(args) != 0 {
		return errors.New("error: servers accepts no arguments")
	}
	registry, err := defaultViviServerRegistry()
	if err != nil {
		return fmt.Errorf("error: locate Vivi server registry: %w", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("error: get current directory: %w", err)
	}
	servers, err := registry.List(ctx, cwd)
	if err != nil {
		return fmt.Errorf("error: list Vivi servers: %w", err)
	}
	return writeViviServersProjection(stdout, servers)
}

func runTopLevelInbox(ctx context.Context, args []string, stdout io.Writer) error {
	if hasHelpFlag(args) {
		_, err := fmt.Fprintln(stdout, topLevelInboxHelpText())
		return err
	}
	flags := flag.NewFlagSet("vivi inbox", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	readAs := flags.String("read-as", "", "mark returned threads as read by codex or claude")
	jsonOutput := flags.Bool("json", false, "emit legacy JSON Lines")
	flagArgs, positional := splitTopLevelAgentFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return err
	}
	positional = append(positional, flags.Args()...)
	if len(positional) != 1 {
		return errors.New("error: inbox requires <url>")
	}
	options := topLevelAgentOptions{URL: strings.TrimRight(positional[0], "/"), JSON: *jsonOutput}
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
	if hasHelpFlag(args) {
		_, err := fmt.Fprintln(stdout, topLevelReplyHelpText())
		return err
	}
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
	} else if actorValue := strings.TrimSpace(os.Getenv("VIVI_ACTOR")); actorValue != "" {
		actor, err := parseSimpleAgentActor(actorValue)
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
	if options.JSON {
		return writeTopLevelInboxJSONItems(stdout, options, threads)
	}
	return writeTopLevelInboxProjection(stdout, options, threads)
}

func writeTopLevelInboxJSONItems(stdout io.Writer, options topLevelAgentOptions, threads []commentThreadOutput) error {
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

func writeTopLevelInboxProjection(stdout io.Writer, options topLevelAgentOptions, threads []commentThreadOutput) error {
	if err := validateTopLevelInboxProjection(threads); err != nil {
		return err
	}
	var output strings.Builder
	fmt.Fprintf(&output, "inbox count=%d", len(threads))
	if options.ReadAs.Name != "" {
		fmt.Fprintf(&output, " read-as=%s", options.ReadAs.Name)
	}
	if len(threads) == 0 {
		output.WriteByte('\n')
		_, err := io.WriteString(stdout, output.String())
		return err
	}
	output.WriteString(" complete=true external-text=untrusted escaped\n")
	for _, thread := range threads {
		anchor := topLevelProjectedAnchorFor(thread.Anchor)
		fmt.Fprintf(&output, "%s %s %s", thread.ID, topLevelQuoted(thread.Path), anchor.Atom)
		if anchor.Base != "" {
			fmt.Fprintf(&output, " base=%s", topLevelQuoted(anchor.Base))
		}
		if anchor.Selector != "" {
			fmt.Fprintf(&output, " selector=%s", topLevelQuoted(anchor.Selector))
		}
		if anchor.Quote != "" {
			fmt.Fprintf(&output, " quote=%s", topLevelQuoted(anchor.Quote))
		}
		output.WriteByte('\n')
		for _, comment := range thread.Comments {
			fmt.Fprintf(&output, "  %s %s\n", topLevelCommentActor(comment.CreatedBy), topLevelQuoted(comment.Body))
		}
	}
	_, err := io.WriteString(stdout, output.String())
	return err
}

type topLevelProjectedAnchor struct {
	Atom     string
	Base     string
	Selector string
	Quote    string
}

func topLevelProjectedAnchorFor(raw json.RawMessage) topLevelProjectedAnchor {
	var anchor struct {
		Surface   string `json:"surface"`
		Canonical struct {
			LineStart   int    `json:"lineStart"`
			LineEnd     int    `json:"lineEnd"`
			ColumnStart int    `json:"columnStart"`
			ColumnEnd   int    `json:"columnEnd"`
			Quote       string `json:"quote"`
		} `json:"canonical"`
		Rendered struct {
			Kind            string `json:"kind"`
			Selector        string `json:"selector"`
			TextQuote       string `json:"textQuote"`
			SourceLineStart int    `json:"sourceLineStart"`
			SourceLineEnd   int    `json:"sourceLineEnd"`
		} `json:"rendered"`
		Diff struct {
			Base         string `json:"base"`
			Side         string `json:"side"`
			OldLineStart int    `json:"oldLineStart"`
			OldLineEnd   int    `json:"oldLineEnd"`
			NewLineStart int    `json:"newLineStart"`
			NewLineEnd   int    `json:"newLineEnd"`
		} `json:"diff"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &anchor) != nil {
		return topLevelProjectedAnchor{Atom: "unknown@file"}
	}
	prefix := anchor.Surface
	start, end := anchor.Canonical.LineStart, anchor.Canonical.LineEnd
	switch anchor.Surface {
	case "source":
		prefix = "source"
	case "rendered":
		prefix = "rendered"
		if anchor.Rendered.Kind == "markdown" || anchor.Rendered.Kind == "html" {
			prefix += "-" + anchor.Rendered.Kind
		}
		if start <= 0 {
			start, end = anchor.Rendered.SourceLineStart, anchor.Rendered.SourceLineEnd
		}
	case "diff":
		prefix = "diff"
		if anchor.Diff.Side == "old" || anchor.Diff.Side == "new" {
			prefix += "-" + anchor.Diff.Side
			if anchor.Diff.Side == "old" && anchor.Diff.OldLineStart > 0 {
				start, end = anchor.Diff.OldLineStart, anchor.Diff.OldLineEnd
			}
			if anchor.Diff.Side == "new" && anchor.Diff.NewLineStart > 0 {
				start, end = anchor.Diff.NewLineStart, anchor.Diff.NewLineEnd
			}
		}
	default:
		prefix = "unknown"
	}
	projected := topLevelProjectedAnchor{Atom: prefix + topLevelLineAnchor(start, end, anchor.Canonical.ColumnStart, anchor.Canonical.ColumnEnd)}
	if anchor.Surface == "diff" {
		projected.Base = anchor.Diff.Base
	}
	projected.Quote = anchor.Canonical.Quote
	if anchor.Surface == "rendered" && anchor.Rendered.TextQuote != "" {
		projected.Quote = anchor.Rendered.TextQuote
	}
	if start <= 0 && anchor.Surface == "rendered" {
		projected.Selector = anchor.Rendered.Selector
	}
	return projected
}

func topLevelLineAnchor(start, end, columnStart, columnEnd int) string {
	if start <= 0 {
		return "@file"
	}
	anchor := fmt.Sprintf(":L%d", start)
	if end > start {
		anchor += fmt.Sprintf("-%d", end)
	}
	if columnStart > 0 {
		anchor += fmt.Sprintf(":C%d", columnStart)
		if columnEnd > columnStart {
			anchor += fmt.Sprintf("-%d", columnEnd)
		}
	}
	return anchor
}

func topLevelCommentActor(actor actorOutput) string {
	switch actor.Kind {
	case "human", "codex":
		return actor.Kind
	case "claude_code":
		return "claude"
	default:
		return "unknown"
	}
}

func topLevelQuoted(value string) string {
	return strconv.Quote(topLevelSafeExternalText(value))
}

func topLevelSafeExternalText(value string) string {
	var output strings.Builder
	for _, r := range value {
		if r == '\\' {
			output.WriteString(`\\`)
			continue
		}
		if r == '\u2028' || r == '\u2029' {
			fmt.Fprintf(&output, `\u%04X`, r)
			continue
		}
		if unicode.Is(unicode.C, r) {
			switch r {
			case '\t':
				output.WriteString(`\t`)
			case '\r':
				output.WriteString(`\r`)
			case '\n':
				output.WriteString(`\n`)
			default:
				if r <= 0xffff {
					fmt.Fprintf(&output, `\u%04X`, r)
				} else {
					fmt.Fprintf(&output, `\U%08X`, r)
				}
			}
			continue
		}
		output.WriteRune(r)
	}
	return output.String()
}

func validateTopLevelInboxProjection(threads []commentThreadOutput) error {
	for _, thread := range threads {
		if !validTopLevelThreadRef(thread.ID) {
			return fmt.Errorf("error: invalid thread reference %q", thread.ID)
		}
		if !utf8.ValidString(thread.Path) {
			return errors.New("error: inbox path is not valid UTF-8")
		}
		anchor := topLevelProjectedAnchorFor(thread.Anchor)
		for _, value := range []string{anchor.Base, anchor.Selector, anchor.Quote} {
			if !utf8.ValidString(value) {
				return errors.New("error: inbox anchor text is not valid UTF-8")
			}
		}
		for _, comment := range thread.Comments {
			if !utf8.ValidString(comment.Body) {
				return errors.New("error: inbox comment body is not valid UTF-8")
			}
		}
	}
	return nil
}

func validTopLevelThreadRef(value string) bool {
	if len(value) == 0 || len(value) > 128 || !isTopLevelThreadRefStart(value[0]) {
		return false
	}
	for index := 1; index < len(value); index++ {
		character := value[index]
		if !isTopLevelThreadRefStart(character) && character != '.' && character != '_' && character != ':' && character != '-' {
			return false
		}
	}
	return true
}

func isTopLevelThreadRefStart(character byte) bool {
	return character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9'
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
	return fmt.Errorf("error: missing actor; pass --actor or set VIVI_ACTOR (expected one of: %s)", supportedSimpleActors)
}

func topLevelInboxHelpText() string {
	return strings.Join([]string{
		"vivi inbox - fetch published feedback once",
		"",
		"Usage:",
		"  vivi inbox <url> [--read-as codex|claude] [--json]",
		"",
		"The default read is passive. It returns the current open snapshot and exits.",
		"Use --read-as only when Vivi should record a read receipt.",
		"Use --json for the legacy JSON Lines projection.",
		"Text output: <thread-id> <quoted-path> <anchor>, followed by indented <actor> <quoted-body> records.",
	}, "\n")
}

func topLevelServersHelpText() string {
	return strings.Join([]string{
		"vivi servers - identify running Vivi servers",
		"",
		"Usage:",
		"  vivi servers",
		"",
		"Lists validated running servers and prunes stale registrations.",
		"* means the root contains the current directory.",
		"Text output: servers count=<n> matches=<n>, followed by <marker> <quoted-root> <url> records.",
	}, "\n")
}

func topLevelReplyHelpText() string {
	return strings.Join([]string{
		"vivi reply - reply to published feedback",
		"",
		"Usage:",
		"  vivi reply <url> <thread-id>",
		"             (--body <text> | --body-file <path|->)",
		"             [--resolve | --archive]",
		"             [--actor codex|claude]",
		"",
		"Actor:",
		"  VIVI_ACTOR sets the default actor; --actor overrides it.",
		"  export VIVI_ACTOR=codex",
	}, "\n")
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
