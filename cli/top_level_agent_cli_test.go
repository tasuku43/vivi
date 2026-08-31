package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tasuku43/vivi/server"
	"github.com/tasuku43/vivi/server/application"
	servercomments "github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	vivigraphql "github.com/tasuku43/vivi/server/graphql"
	"github.com/tasuku43/vivi/server/workspace"
)

func TestTopLevelInboxReadsOpenThreadsPassivelyAndWithReadReceipt(t *testing.T) {
	t.Setenv("VIVI_ACTOR", "codex")
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)
	thread := createTopLevelAgentThread(t, ctx, serverURL, "README.md", "導入文を新規ユーザー向けに寄せてください。")

	var passive bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"inbox", serverURL}, &passive); err != nil {
		t.Fatalf("passive inbox failed: %v", err)
	}
	wantPassive := fmt.Sprintf("inbox count=1 complete=true external-text=untrusted escaped\n%s \"README.md\" source:L1\n  human \"導入文を新規ユーザー向けに寄せてください。\"\n", thread.ID)
	if passive.String() != wantPassive {
		t.Fatalf("passive inbox = %q, want %q", passive.String(), wantPassive)
	}
	if readActivityCount(t, ctx, serverURL, thread.ID) != 0 {
		t.Fatal("plain inbox should not create read activity")
	}

	var legacyJSON bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"inbox", serverURL, "--json"}, &legacyJSON); err != nil {
		t.Fatalf("JSON inbox failed: %v", err)
	}
	legacyItem := decodeSingleJSONLine(t, legacyJSON.String())
	if legacyItem["type"] != "comment" || legacyItem["id"] != thread.ID || legacyItem["file"] != "README.md" || legacyItem["body"] != "導入文を新規ユーザー向けに寄せてください。" || legacyItem["action"] != "review" {
		t.Fatalf("legacy JSON inbox item = %#v", legacyItem)
	}
	if _, ok := legacyItem["readBy"]; ok {
		t.Fatalf("passive JSON inbox should not include readBy: %#v", legacyItem)
	}

	var readAs bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"inbox", serverURL, "--read-as", "codex"}, &readAs); err != nil {
		t.Fatalf("read-as inbox failed: %v", err)
	}
	if !strings.HasPrefix(readAs.String(), "inbox count=1 read-as=codex complete=true external-text=untrusted escaped\n") {
		t.Fatalf("read-as inbox = %q", readAs.String())
	}
	if readActivityCount(t, ctx, serverURL, thread.ID) != 1 {
		t.Fatal("read-as inbox should create one read activity")
	}
}

func TestTopLevelInboxProjectionKeepsAnchorsAndConversationHistory(t *testing.T) {
	threads := []commentThreadOutput{
		{
			ID:     "comment-thread-1",
			Path:   "README.md",
			Anchor: json.RawMessage(`{"surface":"rendered","canonical":{"lineStart":3,"lineEnd":4,"quote":"fallback"},"rendered":{"kind":"markdown","textQuote":"この導入文"}}`),
			Comments: []commentOutput{
				{Body: "新規ユーザー向けに寄せてください。", CreatedBy: actorOutput{Kind: "human"}},
				{Body: "導入を短くしました。", CreatedBy: actorOutput{Kind: "codex"}},
				{Body: "もう少し具体例を足してください。", CreatedBy: actorOutput{Kind: "human"}},
			},
		},
		{
			ID:     "comment-thread-2",
			Path:   "src/app.ts",
			Anchor: json.RawMessage(`{"surface":"diff","canonical":{"lineStart":99,"lineEnd":99},"diff":{"base":"HEAD","side":"old","oldLineStart":42,"oldLineEnd":44}}`),
			Comments: []commentOutput{
				{Body: "nil の場合も扱ってください。", CreatedBy: actorOutput{Kind: "human"}},
				{Body: "対応します。", CreatedBy: actorOutput{Kind: "claude_code"}},
			},
		},
	}
	var stdout bytes.Buffer
	if err := writeTopLevelInboxItems(&stdout, topLevelAgentOptions{}, threads); err != nil {
		t.Fatal(err)
	}
	want := "" +
		"inbox count=2 complete=true external-text=untrusted escaped\n" +
		"comment-thread-1 \"README.md\" rendered-markdown:L3-4 quote=\"この導入文\"\n" +
		"  human \"新規ユーザー向けに寄せてください。\"\n" +
		"  codex \"導入を短くしました。\"\n" +
		"  human \"もう少し具体例を足してください。\"\n" +
		"comment-thread-2 \"src/app.ts\" diff-old:L42-44 base=\"HEAD\"\n" +
		"  human \"nil の場合も扱ってください。\"\n" +
		"  claude \"対応します。\"\n"
	if stdout.String() != want {
		t.Fatalf("projection mismatch\ngot:\n%s\nwant:\n%s", stdout.String(), want)
	}
}

func TestTopLevelInboxProjectionMakesEmptyAndHostileInputUnambiguous(t *testing.T) {
	var empty bytes.Buffer
	if err := writeTopLevelInboxItems(&empty, topLevelAgentOptions{}, nil); err != nil {
		t.Fatal(err)
	}
	if empty.String() != "inbox count=0\n" {
		t.Fatalf("empty projection = %q", empty.String())
	}

	thread := commentThreadOutput{
		ID:       "safe-thread-1",
		Path:     "docs/line\nbreak.md",
		Anchor:   json.RawMessage(`{"surface":"rendered","canonical":{},"rendered":{"kind":"html","selector":"h1\nforged","textQuote":"Hello\\World"}}`),
		Comments: []commentOutput{{Body: "first\nforged\tline\\nlast\u2028end", CreatedBy: actorOutput{Kind: "human"}}},
	}
	var hostile bytes.Buffer
	if err := writeTopLevelInboxItems(&hostile, topLevelAgentOptions{}, []commentThreadOutput{thread}); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(hostile.String(), "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("hostile text injected a physical record: %q", hostile.String())
	}
	for _, rawControl := range []string{"\r", "\t", "\u2028", "\u2029"} {
		if strings.Contains(hostile.String(), rawControl) {
			t.Fatalf("projection contains raw control %q: %q", rawControl, hostile.String())
		}
	}
	for _, escaped := range []string{`line\\nbreak.md`, `selector="h1\\nforged"`, `quote="Hello\\\\World"`, `first\\nforged\\tline\\\\nlast\\u2028end`} {
		if !strings.Contains(hostile.String(), escaped) {
			t.Fatalf("projection missing escaped text %q: %q", escaped, hostile.String())
		}
	}

	invalid := thread
	invalid.ID = "unsafe\nthread"
	var rejected bytes.Buffer
	if err := writeTopLevelInboxItems(&rejected, topLevelAgentOptions{}, []commentThreadOutput{invalid}); err == nil || !strings.Contains(err.Error(), "invalid thread reference") {
		t.Fatalf("invalid reference error = %v", err)
	}
	if rejected.Len() != 0 {
		t.Fatalf("invalid snapshot wrote partial output: %q", rejected.String())
	}

	invalidUTF8 := thread
	invalidUTF8.ID = "safe-thread-2"
	invalidUTF8.Comments = []commentOutput{{Body: string([]byte{0xff}), CreatedBy: actorOutput{Kind: "human"}}}
	var rejectedUTF8 bytes.Buffer
	if err := writeTopLevelInboxItems(&rejectedUTF8, topLevelAgentOptions{}, []commentThreadOutput{invalidUTF8}); err == nil || !strings.Contains(err.Error(), "not valid UTF-8") {
		t.Fatalf("invalid UTF-8 error = %v", err)
	}
	if rejectedUTF8.Len() != 0 {
		t.Fatalf("invalid UTF-8 snapshot wrote partial output: %q", rejectedUTF8.String())
	}
}

func TestTopLevelInboxProjectionHasAStableByteBudgetAgainstEquivalentJSON(t *testing.T) {
	type semanticComment struct {
		Actor string `json:"actor"`
		Body  string `json:"body"`
	}
	type semanticThread struct {
		ThreadID string            `json:"threadId"`
		Path     string            `json:"path"`
		Anchor   string            `json:"anchor"`
		Comments []semanticComment `json:"comments"`
	}
	type semanticInbox struct {
		Count        int              `json:"count"`
		Complete     bool             `json:"complete"`
		ExternalText string           `json:"externalText"`
		Threads      []semanticThread `json:"threads"`
	}

	threads := make([]commentThreadOutput, 0, 5)
	semantic := semanticInbox{Count: 5, Complete: true, ExternalText: "untrusted escaped"}
	for index := 1; index <= 5; index++ {
		threadID := fmt.Sprintf("comment-thread-%d", index)
		path := fmt.Sprintf("docs/section-%d.md", index)
		body := fmt.Sprintf("Please make section %d clearer for a first-time reader.", index)
		response := fmt.Sprintf("Updated section %d with a concrete example.", index)
		anchor := fmt.Sprintf("source:L%d-%d", index*10, index*10+2)
		threads = append(threads, commentThreadOutput{
			ID:     threadID,
			Path:   path,
			Anchor: json.RawMessage(fmt.Sprintf(`{"surface":"source","canonical":{"lineStart":%d,"lineEnd":%d}}`, index*10, index*10+2)),
			Comments: []commentOutput{
				{Body: body, CreatedBy: actorOutput{Kind: "human"}},
				{Body: response, CreatedBy: actorOutput{Kind: "codex"}},
			},
		})
		semantic.Threads = append(semantic.Threads, semanticThread{
			ThreadID: threadID,
			Path:     path,
			Anchor:   anchor,
			Comments: []semanticComment{{Actor: "human", Body: body}, {Actor: "codex", Body: response}},
		})
	}
	var projection bytes.Buffer
	if err := writeTopLevelInboxItems(&projection, topLevelAgentOptions{}, threads); err != nil {
		t.Fatal(err)
	}
	jsonProjection, err := json.Marshal(semantic)
	if err != nil {
		t.Fatal(err)
	}
	ratio := float64(projection.Len()) * 100 / float64(len(jsonProjection))
	t.Logf("equivalent projection bytes: text=%d JSON=%d ratio=%.1f%%", projection.Len(), len(jsonProjection), ratio)
	if len(projection.Bytes())*100 > len(jsonProjection)*75 {
		t.Fatalf("projection byte budget regressed: text=%d JSON=%d ratio=%.1f%%", projection.Len(), len(jsonProjection), ratio)
	}
}

func TestTopLevelAgentCommandHelpIsCommandSpecific(t *testing.T) {
	for _, tt := range []struct {
		command string
		want    []string
	}{
		{command: "servers", want: []string{"vivi servers - identify running Vivi servers", "* means the root contains the current directory", "stale registrations", "servers count=<n> matches=<n>"}},
		{command: "inbox", want: []string{"vivi inbox - fetch published feedback once", "vivi inbox <url> [--read-as codex|claude]", "The default read is passive."}},
	} {
		t.Run(tt.command, func(t *testing.T) {
			var stdout bytes.Buffer
			if err := runTopLevelAgentCommand(context.Background(), []string{tt.command, "--help"}, &stdout); err != nil {
				t.Fatalf("%s --help failed: %v", tt.command, err)
			}
			for _, want := range tt.want {
				if !strings.Contains(stdout.String(), want) {
					t.Fatalf("%s --help missing %q:\n%s", tt.command, want, stdout.String())
				}
			}
		})
	}
}

func TestTopLevelServersCommandUsesTheDefaultRegistry(t *testing.T) {
	t.Setenv("VIVI_DATA_DIR", t.TempDir())
	var stdout bytes.Buffer
	if err := runTopLevelAgentCommand(context.Background(), []string{"servers"}, &stdout); err != nil {
		t.Fatalf("servers failed: %v", err)
	}
	if stdout.String() != "servers count=0 matches=0\n" {
		t.Fatalf("servers output = %q", stdout.String())
	}

	stdout.Reset()
	if err := runTopLevelAgentCommand(context.Background(), []string{"servers", "extra"}, &stdout); err == nil || err.Error() != "error: servers accepts no arguments" {
		t.Fatalf("servers extra argument error = %v", err)
	}
}

func TestTopLevelInboxRejectsRemovedResidentFlags(t *testing.T) {
	for _, flag := range []string{"--watch", "--initial", "--no-initial", "--interval"} {
		var stdout bytes.Buffer
		args := []string{"inbox", "http://127.0.0.1:4317", flag}
		if flag == "--interval" {
			args = append(args, "10ms")
		}
		err := runTopLevelAgentCommand(context.Background(), args, &stdout)
		if err == nil || !strings.Contains(err.Error(), "flag provided but not defined") {
			t.Fatalf("%s error = %v", flag, err)
		}
		if stdout.Len() != 0 {
			t.Fatalf("%s should not write stdout, got %q", flag, stdout.String())
		}
	}
}

func TestTopLevelClaimAndReleaseAreRemovedWithResidentInbox(t *testing.T) {
	for _, command := range []string{"claim", "release"} {
		var stdout bytes.Buffer
		err := runTopLevelAgentCommand(context.Background(), []string{command}, &stdout)
		want := "error: vivi " + command + " was removed with the resident inbox workflow; use one-shot inbox"
		if err == nil || err.Error() != want {
			t.Fatalf("%s error = %v, want %q", command, err, want)
		}
	}
}

func TestTopLevelInboxWithoutURLDoesNotStartServer(t *testing.T) {
	done := make(chan error, 1)
	go func() {
		done <- run([]string{"inbox"})
	}()
	select {
	case err := <-done:
		if err == nil || err.Error() != "error: inbox requires <url>" {
			t.Fatalf("run inbox error = %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("vivi inbox without a URL looked like it was starting a server")
	}
}

func TestStartViviServerIncrementsWhenDefaultPortIsBusy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:4317")
	if err != nil {
		t.Skipf("default port already unavailable: %v", err)
	}
	defer listener.Close()

	root := t.TempDir()
	fsys, err := workspace.New(workspace.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	httpServer, err := startViviServer(ctx, server.Options{Host: "127.0.0.1", Port: 4317, Workspace: fsys}, true)
	if err != nil {
		t.Fatal(err)
	}
	defer httpServer.Close(context.Background())
	if strings.Contains(httpServer.URL(), ":4317") {
		t.Fatalf("server URL = %s, want incremented port", httpServer.URL())
	}
}

func newTopLevelAgentTestServer(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"intro.md", "generated.md"} {
		if err := os.WriteFile(filepath.Join(root, "docs", name), []byte("# Doc\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fsys, err := workspace.New(workspace.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	reviewer, err := gitreview.New(root, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	store, err := servercomments.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := vivigraphql.NewHandler(application.NewService(application.Options{Workspace: fsys, Git: reviewer, Comments: store}), func(*http.Request) bool { return true })
	mux := http.NewServeMux()
	mux.Handle("/graphql", handler)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server.URL
}

func createTopLevelAgentThread(t *testing.T, ctx context.Context, serverURL string, path string, body string) commentThreadOutput {
	t.Helper()
	var thread commentThreadOutput
	if err := postGraphQL(ctx, commentsCommandOptions{URL: serverURL}, graphqlRequest{
		OperationName: "CreateTopLevelAgentThread",
		Query: `mutation CreateTopLevelAgentThread($input: CommentInput!) {
			createThread(input: $input) {
				id
				path
				status
				createdAt
				updatedAt
				comments {
					id
					threadId
					path
					viewerKind
					body
					status
					createdAt
					updatedAt
					createdBy { id kind displayName }
				}
			}
		}`,
		Variables: map[string]any{
			"input": map[string]any{
				"path": path,
				"body": body,
				"anchor": map[string]any{
					"surface": "source",
					"canonical": map[string]any{
						"path":      path,
						"lineStart": float64(1),
						"lineEnd":   float64(1),
					},
				},
				"actor": map[string]any{
					"id":          "human:tester",
					"kind":        "human",
					"displayName": "Tester",
				},
			},
		},
	}, "createThread", &thread); err != nil {
		t.Fatalf("create thread: %v", err)
	}
	return thread
}

func readActivityCount(t *testing.T, ctx context.Context, serverURL string, threadID string) int {
	t.Helper()
	count := 0
	for _, activity := range fetchTopLevelAgentActivities(t, ctx, serverURL, threadID) {
		if activity.Type == "thread_read" {
			count++
		}
	}
	return count
}

func fetchTopLevelAgentActivities(t *testing.T, ctx context.Context, serverURL string, threadID string) []commentActivityOutput {
	t.Helper()
	var activities []commentActivityOutput
	if err := postGraphQL(ctx, commentsCommandOptions{URL: serverURL}, graphqlRequest{
		OperationName: "TopLevelAgentActivities",
		Query: `query TopLevelAgentActivities($threadId: ID!) {
			commentThreadActivities(threadId: $threadId) {
				id
				threadId
				type
				actor { id kind displayName }
				commentId
				status
				clientEventId
				leaseExpiresAt
				createdAt
			}
		}`,
		Variables: map[string]any{"threadId": threadID},
	}, "commentThreadActivities", &activities); err != nil {
		t.Fatalf("fetch activities: %v", err)
	}
	return activities
}

func decodeSingleJSONLine(t *testing.T, line string) map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(line), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d JSON lines: %q", len(lines), line)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &decoded); err != nil {
		t.Fatalf("decode JSON line: %v\n%s", err, line)
	}
	return decoded
}
