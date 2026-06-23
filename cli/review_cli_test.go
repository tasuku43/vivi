package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReviewCLIQueueAndDiffGuideAgentReview(t *testing.T) {
	server := newCommentsCLITestServerWithSetup(t, func(root string) {
		runGitForCLITest(t, root, "init")
		runGitForCLITest(t, root, "config", "user.email", "vivi@example.test")
		runGitForCLITest(t, root, "config", "user.name", "Vivi Test")
		runGitForCLITest(t, root, "add", "README.md")
		runGitForCLITest(t, root, "commit", "-m", "initial")
		if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n\nHello changed\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	})
	defer server.Close()

	queue := runReviewCLIForTest(t, "queue", "--url", server.URL, "--actor", "codex:test", "--json")
	var queuePayload struct {
		SchemaVersion int                         `json:"schemaVersion"`
		Available     bool                        `json:"available"`
		Count         int                         `json:"count"`
		Changes       []reviewChangeOutput        `json:"changes"`
		DiffBases     reviewDiffBaseSummaryOutput `json:"diffBases"`
		Summary       reviewRoutingSummary        `json:"summary"`
	}
	decodeReviewCLIJSON(t, queue, &queuePayload)
	if queuePayload.SchemaVersion != reviewCLISchemaVersion || !queuePayload.Available || queuePayload.Count != 1 {
		t.Fatalf("review queue payload = %s", queue.String())
	}
	if len(queuePayload.Changes) != 1 || queuePayload.Changes[0].Path != "README.md" || queuePayload.Changes[0].Status != "modified" {
		t.Fatalf("review queue changes = %#v", queuePayload.Changes)
	}
	if !queuePayload.DiffBases.Available || len(queuePayload.DiffBases.Options) == 0 || queuePayload.DiffBases.Options[0].Ref != "HEAD" {
		t.Fatalf("review diff bases = %#v", queuePayload.DiffBases)
	}
	if !queuePayload.Summary.RequiresAttention || queuePayload.Summary.RecommendedAction != "review_changed_files" || queuePayload.Summary.ChangedFileCount != 1 || !containsString(queuePayload.Summary.AttentionReasons, "changed_files_available") {
		t.Fatalf("review queue summary = %#v", queuePayload.Summary)
	}
	if len(queuePayload.Summary.SuggestedCommands) != 2 || queuePayload.Summary.SuggestedCommands[0].Command != "review diff" || !containsString(queuePayload.Summary.SuggestedCommands[0].Args, "README.md") || !containsString(queuePayload.Summary.SuggestedCommands[0].Args, server.URL) {
		t.Fatalf("review queue suggestions = %#v", queuePayload.Summary.SuggestedCommands)
	}
	if queuePayload.Summary.SuggestedCommands[1].Command != "comments work" || queuePayload.Summary.SuggestedCommands[1].Intent != "wait_for_gui_feedback" || !containsString(queuePayload.Summary.SuggestedCommands[1].Args, "--actor") || !containsString(queuePayload.Summary.SuggestedCommands[1].Args, "codex:test") || !containsString(queuePayload.Summary.SuggestedCommands[1].Args, "--wait") || !containsString(queuePayload.Summary.SuggestedCommands[1].Args, "--loop") || !containsString(queuePayload.Summary.SuggestedCommands[1].Args, server.URL) || queuePayload.Summary.SuggestedCommands[1].ClientEventID == "" {
		t.Fatalf("review queue suggestions = %#v", queuePayload.Summary.SuggestedCommands)
	}

	queueWithoutActor := runReviewCLIForTest(t, "queue", "--url", server.URL, "--json")
	var queueWithoutActorPayload struct {
		Summary reviewRoutingSummary `json:"summary"`
	}
	decodeReviewCLIJSON(t, queueWithoutActor, &queueWithoutActorPayload)
	if len(queueWithoutActorPayload.Summary.SuggestedCommands) != 2 || queueWithoutActorPayload.Summary.SuggestedCommands[1].Command != "comments doctor" || queueWithoutActorPayload.Summary.SuggestedCommands[1].Intent != "choose_agent_actor" || containsString(queueWithoutActorPayload.Summary.SuggestedCommands[1].Args, "<actor-id>") || containsString(queueWithoutActorPayload.Summary.SuggestedCommands[1].Args, "--actor") || !containsString(queueWithoutActorPayload.Summary.SuggestedCommands[1].Args, server.URL) {
		t.Fatalf("review queue suggestions without actor = %#v", queueWithoutActorPayload.Summary.SuggestedCommands)
	}

	bases := runReviewCLIForTest(t, "bases", "--url", server.URL, "--json")
	var basesPayload struct {
		SchemaVersion int                         `json:"schemaVersion"`
		DiffBases     reviewDiffBaseSummaryOutput `json:"diffBases"`
	}
	decodeReviewCLIJSON(t, bases, &basesPayload)
	if basesPayload.SchemaVersion != reviewCLISchemaVersion || !basesPayload.DiffBases.Available || len(basesPayload.DiffBases.Options) == 0 {
		t.Fatalf("review bases payload = %s", bases.String())
	}

	diff := runReviewCLIForTest(t, "diff", "README.md", "--url", server.URL, "--base", "HEAD", "--json")
	var diffPayload struct {
		SchemaVersion int            `json:"schemaVersion"`
		Diff          textDiffOutput `json:"diff"`
	}
	decodeReviewCLIJSON(t, diff, &diffPayload)
	if diffPayload.SchemaVersion != reviewCLISchemaVersion || diffPayload.Diff.Path != "README.md" || diffPayload.Diff.Status != "available" {
		t.Fatalf("review diff payload = %s", diff.String())
	}
	if !strings.Contains(diffPayload.Diff.Content, "+Hello changed") {
		t.Fatalf("review diff content = %s", diffPayload.Diff.Content)
	}
}

func TestReviewHelpTextSurfacesAgentQuickPath(t *testing.T) {
	help := reviewHelpText()
	for _, text := range []string{
		"vivi review - agent-oriented Git review CLI",
		"Git working-tree review queue",
		"vivi review queue --actor <actor> --json",
		"vivi review bases --url",
		"vivi review diff <path> --base HEAD",
		"vivi comments work --actor <actor> --wait --loop --idle-events --full --json",
		"--actor <id>",
	} {
		if !strings.Contains(help, text) {
			t.Fatalf("review help text did not include %q\n%s", text, help)
		}
	}
}

func TestReviewJSONErrorEnvelopeForAgentCLI(t *testing.T) {
	err := run([]string{"review", "diff", "--json"})
	if err == nil {
		t.Fatal("expected review diff without a path to fail")
	}
	payload, ok := cliErrorPayload(err)
	if !ok {
		t.Fatalf("expected structured review CLI error, got %T %v", err, err)
	}
	envelope, ok := payload.(reviewErrorEnvelope)
	if !ok {
		t.Fatalf("unexpected review error payload type %T", payload)
	}
	if envelope.Error.SchemaVersion != reviewCLISchemaVersion || envelope.Error.Code != "invalid_arguments" || envelope.Error.Command != "review diff" || envelope.Error.Recoverable {
		t.Fatalf("unexpected review error envelope: %#v", envelope)
	}
	if !strings.Contains(envelope.Error.Message, "requires exactly one path") || !containsString(envelope.Error.Args, "review") || !containsString(envelope.Error.Args, "--json") {
		t.Fatalf("incomplete review error envelope: %#v", envelope)
	}
	if len(envelope.Error.SuggestedCommands) != 1 || envelope.Error.SuggestedCommands[0].Command != "review --help" {
		t.Fatalf("review error suggestions = %#v", envelope.Error.SuggestedCommands)
	}

	plain := run([]string{"review", "diff", "--json=false"})
	if plain == nil {
		t.Fatal("expected plain review error")
	}
	if _, ok := cliErrorPayload(plain); ok {
		t.Fatalf("did not expect structured review payload when --json=false: %T", plain)
	}
}

func runReviewCLIForTest(t *testing.T, args ...string) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	if err := runReviewCommand(context.Background(), args, &output); err != nil {
		t.Fatalf("runReviewCommand(%v): %v\noutput:\n%s", args, err, output.String())
	}
	return &output
}

func decodeReviewCLIJSON(t *testing.T, output *bytes.Buffer, target any) {
	t.Helper()
	if err := json.Unmarshal(output.Bytes(), target); err != nil {
		t.Fatalf("invalid json %q: %v", output.String(), err)
	}
}
