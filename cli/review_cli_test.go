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

	queue := runReviewCLIForTest(t, "queue", "--url", server.URL, "--json")
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
	if len(queuePayload.Summary.SuggestedCommands) != 1 || queuePayload.Summary.SuggestedCommands[0].Command != "review diff" || !containsString(queuePayload.Summary.SuggestedCommands[0].Args, "README.md") || !containsString(queuePayload.Summary.SuggestedCommands[0].Args, server.URL) {
		t.Fatalf("review queue suggestions = %#v", queuePayload.Summary.SuggestedCommands)
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
		"vivi review queue --json",
		"vivi review bases --url",
		"vivi review diff <path> --base HEAD",
		"vivi comments work --wait --loop --idle-events --full --json",
	} {
		if !strings.Contains(help, text) {
			t.Fatalf("review help text did not include %q\n%s", text, help)
		}
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
