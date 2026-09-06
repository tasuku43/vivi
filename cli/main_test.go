package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestHelpTextSurfacesOneShotAgentReview(t *testing.T) {
	help := helpText()
	for _, command := range []string{
		"vivi - local workspace review",
		"vivi [root] [options]",
		"vivi servers",
		"vivi inbox <url>",
		"Run 'vivi servers --help', 'vivi open --help', or 'vivi inbox --help' for details.",
		"--ready-json",
		"--exclude <glob>",
		"Document extension allow-list (default: md,markdown,mdown,html,htm)",
		"wins over --include",
		"$XDG_CONFIG_HOME/vivi/config.json",
		"default: ~/.config/vivi/config.json",
		"VIVI_CONFIG",
		"Global and CLI excludes are additive",
	} {
		if !strings.Contains(help, command) {
			t.Fatalf("help text did not include %q\n%s", command, help)
		}
	}
	for _, hiddenCommand := range []string{
		"vivi inbox <url> --watch",
		"vivi claim <url>",
		"vivi release <url>",
		"vivi reply",
		"vivi review <queue|bases|diff>",
		"vivi comments <work|doctor",
		"Changed-file context:",
		"Debug/recovery:",
		"--no-html-scripts",
		"--git-review-timeout",
		"--log-level",
	} {
		if strings.Contains(help, hiddenCommand) {
			t.Fatalf("common help should not expose non-core command %q\n%s", hiddenCommand, help)
		}
	}
}

func TestRemovedReplyCommandsAreRejected(t *testing.T) {
	for _, args := range [][]string{{"reply"}, {"comments", "reply"}} {
		err := run(args)
		if err == nil || !strings.Contains(err.Error(), "has been removed") {
			t.Fatalf("run(%q) error = %v, want unknown command", args, err)
		}
	}
}

func TestDefaultLaunchIncludesMarkdownAndHTMLDocuments(t *testing.T) {
	got := parseInclude(defaultDocumentInclude)
	want := []string{"md", "markdown", "mdown", "html", "htm"}
	if len(got) != len(want) {
		t.Fatalf("default include = %#v, want %#v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("default include = %#v, want %#v", got, want)
		}
	}
}

func TestCommaListFlagAcceptsRepeatedAndCommaSeparatedExcludes(t *testing.T) {
	values := commaListFlag{}
	if err := values.Set("package-lock.json, **/generated/**"); err != nil {
		t.Fatal(err)
	}
	if err := values.Set("snapshots/"); err != nil {
		t.Fatal(err)
	}
	want := []string{"package-lock.json", "**/generated/**", "snapshots/"}
	if len(values) != len(want) {
		t.Fatalf("values = %#v, want %#v", values, want)
	}
	for index := range want {
		if values[index] != want[index] {
			t.Fatalf("values = %#v, want %#v", values, want)
		}
	}
}

func TestServerReadyPayloadIncludesResolvedURLAndAgentCommands(t *testing.T) {
	payload := newServerReadyPayload("/work/linux", "http://127.0.0.1:59432")

	if payload.SchemaVersion != 1 || payload.Event != "vivi_server_ready" || payload.Root != "/work/linux" || payload.URL != "http://127.0.0.1:59432" {
		t.Fatalf("unexpected ready payload metadata: %#v", payload)
	}
	if len(payload.SuggestedCommands) != 1 {
		t.Fatalf("expected one suggested command, got %#v", payload.SuggestedCommands)
	}
	inboxCommand := payload.SuggestedCommands[0]
	if inboxCommand.Intent != "fetch_published_review" || inboxCommand.Command != "inbox" || !inboxCommand.Primary || inboxCommand.DisplayCommand != "vivi inbox http://127.0.0.1:59432" || !containsString(inboxCommand.Args, "inbox") || !containsString(inboxCommand.Args, "http://127.0.0.1:59432") || containsString(inboxCommand.Args, "--watch") {
		t.Fatalf("ready payload should make top-level inbox primary: %#v", inboxCommand)
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

func TestOnlyCoreCommandsRemain(t *testing.T) {
	for _, command := range []string{"comments", "review", "reply", "claim", "release"} {
		if err := run([]string{command, "--help"}); err == nil || !strings.Contains(err.Error(), "has been removed") {
			t.Fatalf("removed command %s: %v", command, err)
		}
	}
}
func containsString(items []string, expected string) bool {
	for _, item := range items {
		if item == expected {
			return true
		}
	}
	return false
}
