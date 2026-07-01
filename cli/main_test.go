package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestHelpTextSurfacesAgentCommentsLoop(t *testing.T) {
	help := helpText()
	for _, command := range []string{
		"vivi - local review adapter",
		"vivi inbox <url> [--watch] [--initial] [--read-as codex|claude]",
		"vivi claim <url> <thread-id> --actor codex|claude",
		"vivi release <url> <thread-id> --actor codex|claude [--body <text>|--body-file <path|->]",
		"vivi reply <url> <thread-id> --actor codex|claude (--body <text>|--body-file <path|->) [--resolve|--archive]",
		"vivi review <queue|bases|diff> [options]",
		"vivi comments <work|doctor|mine|check|triage|release|done|dismiss> [options]",
		"vivi comments <protocol|schema|inbox|watch|follow|claim|renew|hold|active|next|list|show|context|reply|resolve|archive|reopen> [advanced]",
		"Human:",
		"vivi [root] --open",
		"Agent:",
		"vivi inbox <url>",
		"vivi inbox <url> --watch",
		"vivi inbox <url> --watch --initial",
		"vivi inbox <url> --read-as codex",
		"vivi reply <url> <thread-id> --actor codex --body <text>",
		"Changed-file context:",
		"vivi review queue --actor <actor> --json",
		"Debug/recovery:",
		"vivi comments doctor|mine|check|protocol|schema ...",
		"Deeper help:",
		"vivi comments work --help",
		"--ready-json",
	} {
		if !strings.Contains(help, command) {
			t.Fatalf("help text did not include %q\n%s", command, help)
		}
	}
}

func TestServerReadyPayloadIncludesResolvedURLAndAgentCommands(t *testing.T) {
	payload := newServerReadyPayload("/work/linux", "http://127.0.0.1:59432")

	if payload.SchemaVersion != 1 || payload.Event != "vivi_server_ready" || payload.Root != "/work/linux" || payload.URL != "http://127.0.0.1:59432" {
		t.Fatalf("unexpected ready payload metadata: %#v", payload)
	}
	if len(payload.SuggestedCommands) != 3 {
		t.Fatalf("expected three suggested commands, got %#v", payload.SuggestedCommands)
	}
	inboxCommand := payload.SuggestedCommands[0]
	if inboxCommand.Intent != "read_agent_inbox" || inboxCommand.Command != "inbox" || !inboxCommand.Primary || inboxCommand.DisplayCommand != "vivi inbox http://127.0.0.1:59432 --watch" || !containsString(inboxCommand.Args, "inbox") || !containsString(inboxCommand.Args, "http://127.0.0.1:59432") || !containsString(inboxCommand.Args, "--watch") {
		t.Fatalf("ready payload should make top-level inbox primary: %#v", inboxCommand)
	}
	reviewCommand := payload.SuggestedCommands[1]
	if reviewCommand.Intent != "inspect_review_queue_context" || reviewCommand.Command != "review queue" || reviewCommand.DisplayCommand != "vivi review queue --url http://127.0.0.1:59432 --json" || !containsString(reviewCommand.Args, "--url") || !containsString(reviewCommand.Args, "http://127.0.0.1:59432") || !containsString(reviewCommand.Args, "--json") {
		t.Fatalf("review ready suggestion did not carry resolved url: %#v", reviewCommand)
	}
	commentsCommand := payload.SuggestedCommands[2]
	if commentsCommand.Intent != "check_comments_readiness" || commentsCommand.Command != "comments doctor" || commentsCommand.DisplayCommand != "vivi comments doctor --url http://127.0.0.1:59432 --json" || !containsString(commentsCommand.Args, "--url") || !containsString(commentsCommand.Args, "http://127.0.0.1:59432") || !containsString(commentsCommand.Args, "--json") {
		t.Fatalf("comments ready suggestion did not carry resolved url: %#v", commentsCommand)
	}

	var stdout bytes.Buffer
	if err := writeJSON(&stdout, payload); err != nil {
		t.Fatalf("write ready JSON: %v", err)
	}
	var decoded serverReadyPayload
	if err := json.Unmarshal(stdout.Bytes(), &decoded); err != nil {
		t.Fatalf("ready payload was not JSON: %v\n%s", err, stdout.String())
	}
	if decoded.Event != payload.Event || decoded.URL != payload.URL {
		t.Fatalf("decoded ready payload lost metadata: %#v", decoded)
	}
}

func TestReviewActorFromFlagUsesBrowserReviewerIdentity(t *testing.T) {
	actor := reviewActorFromFlag(" gui-reviewer ")
	if actor == nil {
		t.Fatal("expected review actor")
	}
	if actor.ID != "gui-reviewer" || actor.Kind != "human" || actor.DisplayName != "gui-reviewer" {
		t.Fatalf("unexpected review actor: %#v", actor)
	}
	if reviewActorFromFlag(" ") != nil {
		t.Fatal("blank actor should not create a review actor")
	}
}

func TestCommentsHelpTextSurfacesWorkSession(t *testing.T) {
	help := commentsHelpText()
	for _, text := range []string{
		"Agent common path:",
		"1. Start Vivi: vivi <root> --port 0 --ready-json --actor <actor>",
		"vivi comments work --actor <actor> --loop --url <url> --json",
		"Inspect the compact resident loop with: vivi comments work --help",
		"Recovery and adapter discovery:",
		"Safe write rules:",
		"Read stdinSchemaCommand before stdinRequired writes",
		"When using restart recovery, keep the same --receipt-log on startup, resident loop, and suggested writes",
		"Use --require-claim for triage, release, done, and dismiss in background loops",
		"Reuse a stable --client-event-id only for retries of the same logical write",
		"Run comments check <thread-id> --actor <actor> --full --json before writing when ownership may be stale",
		"Prefer done/dismiss --result-file - for terminal replies and release --triage-file - for blocked handoffs",
		"vivi comments protocol --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"vivi comments schema <list|protocol|doctor|triage|result|claim|inbox|mine|batch|check|commentTriageOutput|commentReleaseOutput|commentResultOutput|suggestedCommand|writeReceipt|receiptVerification|receiptLedgerVerification|activityBatch|workClaimed|workIdle|openWorklist|error|all> [--summary] --json",
		"vivi comments work --once --actor claude-code --full --json",
		"vivi comments work --actor claude-code --loop --json",
		"vivi comments release <thread-id> --triage-file - --actor claude-code --require-claim --json",
		"Advanced/debug commands:",
		"vivi comments watch --actor claude-code --json",
		"vivi comments follow <thread-id> --no-initial --json",
		"vivi comments claim --wait --actor claude-code --full --json",
		"--interval <duration>      Watch, follow, hold, or work polling interval",
		"--activity-limit <count>   Limit emitted activity history to the most recent count",
		"--comment-limit <count>    Limit emitted thread comments to the most recent count",
		"--renew-interval <dur>     Work lease renewal interval",
		"--idle-events              Emit comment_work_idle events when the waiting state changes",
		"--once                     Poll once, emit at most one idle/claimed work event, and exit",
		"--loop                     Wait for work and keep running after terminal status",
		"--max-events <count>       Stop streaming commands after emitting count events",
	} {
		if !strings.Contains(help, text) {
			t.Fatalf("comments help text did not include %q\n%s", text, help)
		}
	}
	if count := strings.Count(help, "vivi comments watch --actor claude-code --json"); count != 1 {
		t.Fatalf("comments help text should list watch once, got %d\n%s", count, help)
	}
	if strings.Index(help, "Common commands:") > strings.Index(help, "Advanced/debug commands:") {
		t.Fatalf("comments help should show common commands before advanced/debug commands:\n%s", help)
	}
}

func TestCommentsWorkHelpTextSurfacesCompactResidentLoop(t *testing.T) {
	help := commentsWorkHelpText()
	for _, text := range []string{
		"vivi comments work - compact resident feedback loop",
		"Wait silently for GUI feedback",
		"vivi <root> --port 0 --ready-json --actor <actor>",
		"vivi comments work --actor <actor> --loop --url <url> --json",
		"vivi comments work --once --actor <actor> --full --url <url> --json",
		"silent idle       no claimable feedback; no output by default",
		"claimed work      event=comment_work_claimed; follow summary.suggestedCommands[0]",
		"--loop is compact: no --full, no --idle-events, limited activity/comment history.",
		"Use emitted triage/release/done/dismiss suggestedCommands as-is.",
		"--receipt-log <path>       Persist write receipts for restart recovery",
	} {
		if !strings.Contains(help, text) {
			t.Fatalf("comments work help text did not include %q\n%s", text, help)
		}
	}
}

func TestNestedHelpFlagsPrintHumanHelp(t *testing.T) {
	var commentsStdout bytes.Buffer
	if err := runCommentsCommand(context.Background(), []string{"doctor", "--help"}, &commentsStdout); err != nil {
		t.Fatalf("comments doctor --help failed: %v", err)
	}
	if text := commentsStdout.String(); !strings.Contains(text, "vivi comments - agent-oriented comment thread CLI") || strings.Contains(text, `"error"`) {
		t.Fatalf("comments doctor --help printed unexpected output:\n%s", text)
	}

	var workStdout bytes.Buffer
	if err := runCommentsCommand(context.Background(), []string{"work", "--help"}, &workStdout); err != nil {
		t.Fatalf("comments work --help failed: %v", err)
	}
	if text := workStdout.String(); !strings.Contains(text, "vivi comments work - compact resident feedback loop") || strings.Contains(text, `"error"`) || strings.Contains(text, "Advanced/debug commands:") {
		t.Fatalf("comments work --help printed unexpected output:\n%s", text)
	}

	var reviewStdout bytes.Buffer
	if err := runReviewCommand(context.Background(), []string{"queue", "--help"}, &reviewStdout); err != nil {
		t.Fatalf("review queue --help failed: %v", err)
	}
	if text := reviewStdout.String(); !strings.Contains(text, "vivi review - agent-oriented Git review CLI") || strings.Contains(text, `"error"`) {
		t.Fatalf("review queue --help printed unexpected output:\n%s", text)
	}
}

func TestCommentsJSONErrorEnvelopeForAgentCLI(t *testing.T) {
	err := run([]string{"comments", "done", "thread-1", "--actor", "codex:error", "--json"})
	if err == nil {
		t.Fatal("expected comments done without a body to fail")
	}
	payload, ok := cliErrorPayload(err)
	if !ok {
		t.Fatalf("expected structured CLI error, got %T %v", err, err)
	}
	envelope, ok := payload.(commentsErrorEnvelope)
	if !ok {
		t.Fatalf("unexpected error payload type %T", payload)
	}
	if envelope.Error.SchemaVersion != commentsStreamSchemaVersion || envelope.Error.Code != "invalid_arguments" || envelope.Error.Command != "comments done" || envelope.Error.Recoverable {
		t.Fatalf("unexpected error envelope: %#v", envelope)
	}
	if !strings.Contains(envelope.Error.Message, "done requires --body") || !containsString(envelope.Error.Args, "done") || !containsString(envelope.Error.SchemaCommand, "commentErrorEvent") {
		t.Fatalf("incomplete error envelope: %#v", envelope)
	}

	plain := run([]string{"comments", "done", "thread-1", "--actor", "codex:error", "--json=false"})
	if plain == nil {
		t.Fatal("expected plain comments error")
	}
	if _, ok := cliErrorPayload(plain); ok {
		t.Fatalf("did not expect structured payload when --json=false: %T", plain)
	}
}

func TestPositionalServerURLSuggestsURLFlag(t *testing.T) {
	commentsErr := run([]string{"comments", "doctor", "--actor", "codex:url", "--json", "http://127.0.0.1:4318"})
	if commentsErr == nil {
		t.Fatal("expected comments doctor positional URL to fail")
	}
	commentsPayload, ok := cliErrorPayload(commentsErr)
	if !ok {
		t.Fatalf("expected structured comments error, got %T", commentsErr)
	}
	commentsEnvelope := commentsPayload.(commentsErrorEnvelope)
	if len(commentsEnvelope.Error.SuggestedCommands) == 0 || commentsEnvelope.Error.SuggestedCommands[0].Intent != "retry_with_url_flag" || !containsString(commentsEnvelope.Error.SuggestedCommands[0].Args, "--url") || !containsString(commentsEnvelope.Error.SuggestedCommands[0].Args, "http://127.0.0.1:4318") {
		t.Fatalf("comments positional URL suggestions = %#v", commentsEnvelope.Error.SuggestedCommands)
	}

	reviewErr := run([]string{"review", "queue", "--actor", "codex:url", "--json", "http://127.0.0.1:4318"})
	if reviewErr == nil {
		t.Fatal("expected review queue positional URL to fail")
	}
	reviewPayload, ok := cliErrorPayload(reviewErr)
	if !ok {
		t.Fatalf("expected structured review error, got %T", reviewErr)
	}
	reviewEnvelope := reviewPayload.(reviewErrorEnvelope)
	if len(reviewEnvelope.Error.SuggestedCommands) == 0 || reviewEnvelope.Error.SuggestedCommands[0].Intent != "retry_with_url_flag" || !containsString(reviewEnvelope.Error.SuggestedCommands[0].Args, "--url") || !containsString(reviewEnvelope.Error.SuggestedCommands[0].Args, "http://127.0.0.1:4318") {
		t.Fatalf("review positional URL suggestions = %#v", reviewEnvelope.Error.SuggestedCommands)
	}
}

func TestCommentsJSONErrorEnvelopeThroughCLIProcess(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=TestCommentsCLIProcessMain", "--", "comments", "done", "thread-1", "--actor", "codex:error", "--json")
	cmd.Env = append(os.Environ(), "VIVI_CLI_HELPER_PROCESS=1")
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err == nil {
		t.Fatal("expected CLI process to exit non-zero")
	}
	exit, ok := err.(*exec.ExitError)
	if !ok {
		t.Fatalf("expected exit error, got %T %v", err, err)
	}
	if exit.ExitCode() != 1 {
		t.Fatalf("exit code = %d, stdout=%s stderr=%s", exit.ExitCode(), stdout.String(), stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("expected machine-readable JSON errors on stdout only, stderr=%s", stderr.String())
	}
	var envelope commentsErrorEnvelope
	if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil {
		t.Fatalf("stdout was not a JSON error envelope: %v\n%s", err, stdout.String())
	}
	if envelope.Error.SchemaVersion != commentsStreamSchemaVersion || envelope.Error.Code != "invalid_arguments" || envelope.Error.Command != "comments done" || envelope.Error.Recoverable {
		t.Fatalf("unexpected process error envelope: %#v", envelope)
	}
	if !containsString(envelope.Error.Args, "comments") || !containsString(envelope.Error.Args, "--json") || !containsString(envelope.Error.SchemaCommand, "commentErrorEvent") {
		t.Fatalf("process error envelope missing agent routing details: %#v", envelope)
	}
}

func TestCommentsCLIProcessMain(t *testing.T) {
	if os.Getenv("VIVI_CLI_HELPER_PROCESS") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append([]string{"vivi"}, os.Args[i+1:]...)
			main()
			return
		}
	}
	t.Fatal("missing helper process argument separator")
}
