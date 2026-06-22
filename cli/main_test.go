package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestHelpTextSurfacesAgentCommentsLoop(t *testing.T) {
	help := helpText()
	for _, command := range []string{
		"vivi comments <protocol|schema|doctor|inbox|batch|mine|claim|work|renew|hold|watch|follow|check> [options]",
		"vivi comments <active|next|list|show|context|reply|done|dismiss|resolve|archive|reopen> [options]",
	} {
		if !strings.Contains(help, command) {
			t.Fatalf("help text did not include %q\n%s", command, help)
		}
	}
}

func TestCommentsHelpTextSurfacesWorkSession(t *testing.T) {
	help := commentsHelpText()
	for _, text := range []string{
		"Agent quick path:",
		"1. Discover the contract: vivi comments protocol --json",
		"2. Cache schemas offline: vivi comments schema all --json",
		"3. Check startup state: vivi comments doctor --actor <actor> --json",
		"4. Resume owned work first: vivi comments mine --actor <actor> --full --json",
		"5. Run the resident loop: vivi comments work --actor <actor> --wait --loop --idle-events --full --json",
		"6. Execute suggestedCommands from protocol, doctor, work, follow, check, and errors before inventing argv",
		"Agent write rules:",
		"Read stdinSchemaCommand before stdinRequired writes",
		"Use --require-claim for triage, release, done, and dismiss in background loops",
		"Reuse a stable --client-event-id only for retries of the same logical write",
		"Run comments check <thread-id> --actor <actor> --full --json before writing when ownership may be stale",
		"Prefer done/dismiss --result-file - for terminal replies and release --triage-file - for blocked handoffs",
		"vivi comments protocol --json",
		"vivi comments protocol --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"vivi comments schema <protocol|doctor|triage|result|claim|inbox|mine|batch|check|commentTriageOutput|commentReleaseOutput|commentResultOutput|suggestedCommand|writeReceipt|receiptVerification|receiptLedgerVerification|activityBatch|workClaimed|workIdle|openWorklist|error|all> --json",
		"vivi comments doctor --actor claude-code --json",
		"vivi comments doctor --actor claude-code --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"vivi comments work --wait --actor claude-code --full --json",
		"vivi comments release <thread-id> --triage-file - --actor claude-code --require-claim --json",
		"vivi comments verify-receipt --receipt-file /tmp/vivi-receipt.json --json",
		"vivi comments verify-receipts --receipt-log /tmp/vivi-agent-receipts.jsonl --json",
		"vivi comments schema commentTriageFileInput --json",
		"vivi comments schema commentResultFileInput --json",
		"vivi comments schema commentProtocolManifest --json",
		"vivi comments schema commentDoctorOutput --json",
		"vivi comments schema commentClaimOutput --json",
		"vivi comments schema commentInboxOutput --json",
		"vivi comments schema commentMineOutput --json",
		"vivi comments schema commentBatchOutput --json",
		"vivi comments schema commentCheckOutput --json",
		"vivi comments schema commentTriageOutput --json",
		"vivi comments schema commentReleaseOutput --json",
		"vivi comments schema commentResultOutput --json",
		"vivi comments schema commentSuggestedCommand --json",
		"vivi comments schema commentWriteReceipt --json",
		"vivi comments schema commentWriteReceiptVerification --json",
		"vivi comments schema commentWriteReceiptLedgerVerification --json",
		"vivi comments schema commentActivityBatchEvent --json",
		"vivi comments schema commentWorkClaimedEvent --json",
		"vivi comments schema commentWorkIdleEvent --json",
		"vivi comments schema commentOpenWorklistEvent --json",
		"vivi comments work --loop --actor claude-code --idle-events --full --json",
		"--interval <duration>      Watch, follow, hold, or work polling interval",
		"--renew-interval <dur>     Work lease renewal interval",
		"--idle-events              Emit comment_work_idle heartbeat events",
		"--loop                     Keep comments work running",
		"--max-events <count>       Stop streaming commands after emitting count events",
	} {
		if !strings.Contains(help, text) {
			t.Fatalf("comments help text did not include %q\n%s", text, help)
		}
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
