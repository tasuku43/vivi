package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
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
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)
	thread := createTopLevelAgentThread(t, ctx, serverURL, "README.md", "導入文を新規ユーザー向けに寄せてください。")

	var passive bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"inbox", serverURL}, &passive); err != nil {
		t.Fatalf("passive inbox failed: %v", err)
	}
	passiveItem := decodeSingleJSONLine(t, passive.String())
	if passiveItem["type"] != "comment" || passiveItem["id"] != thread.ID || passiveItem["file"] != "README.md" || passiveItem["body"] != "導入文を新規ユーザー向けに寄せてください。" || passiveItem["action"] != "reply" {
		t.Fatalf("passive inbox item = %#v", passiveItem)
	}
	if _, ok := passiveItem["readBy"]; ok {
		t.Fatalf("passive inbox should not include readBy: %#v", passiveItem)
	}
	if readActivityCount(t, ctx, serverURL, thread.ID) != 0 {
		t.Fatal("plain inbox should not create read activity")
	}

	var readAs bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"inbox", serverURL, "--read-as", "codex"}, &readAs); err != nil {
		t.Fatalf("read-as inbox failed: %v", err)
	}
	readItem := decodeSingleJSONLine(t, readAs.String())
	if readItem["readBy"] != "codex" {
		t.Fatalf("read-as inbox item = %#v", readItem)
	}
	if readActivityCount(t, ctx, serverURL, thread.ID) != 1 {
		t.Fatal("read-as inbox should create one read activity")
	}
}

func TestTopLevelReplyCanLeaveOpenResolveAndArchive(t *testing.T) {
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)

	openThread := createTopLevelAgentThread(t, ctx, serverURL, "README.md", "質問です")
	var openReply bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"reply", serverURL, openThread.ID, "--actor", "codex", "--body", "確認です。CLI 初心者向けでよいですか？"}, &openReply); err != nil {
		t.Fatalf("open reply failed: %v", err)
	}
	assertTopLevelWriteOutput(t, openReply.String(), "reply", openThread.ID, "codex", "open")

	resolvedThread := createTopLevelAgentThread(t, ctx, serverURL, "docs/intro.md", "直してください")
	bodyFile := filepath.Join(t.TempDir(), "reply.md")
	if err := os.WriteFile(bodyFile, []byte("修正して確認しました。"), 0o644); err != nil {
		t.Fatal(err)
	}
	var resolveReply bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"reply", serverURL, resolvedThread.ID, "--actor", "codex", "--resolve", "--body-file", bodyFile}, &resolveReply); err != nil {
		t.Fatalf("resolve reply failed: %v", err)
	}
	assertTopLevelWriteOutput(t, resolveReply.String(), "reply", resolvedThread.ID, "codex", "resolved")

	archivedThread := createTopLevelAgentThread(t, ctx, serverURL, "docs/generated.md", "対象ですか")
	var archiveReply bytes.Buffer
	if err := runTopLevelAgentCommandForTest(ctx, []string{"reply", serverURL, archivedThread.ID, "--actor", "codex", "--archive", "--body-file", "-"}, &archiveReply, strings.NewReader("対象外なので archive します。\n")); err != nil {
		t.Fatalf("archive reply failed: %v", err)
	}
	assertTopLevelWriteOutput(t, archiveReply.String(), "reply", archivedThread.ID, "codex", "archived")
}

func TestTopLevelClaimAndReleaseProvideOwnershipPrimitive(t *testing.T) {
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)
	thread := createTopLevelAgentThread(t, ctx, serverURL, "README.md", "お願いします")

	var claimed bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"claim", serverURL, thread.ID, "--actor", "claude"}, &claimed); err != nil {
		t.Fatalf("claim failed: %v", err)
	}
	assertTopLevelWriteOutput(t, claimed.String(), "claim", thread.ID, "claude", "open")

	var released bytes.Buffer
	if err := runTopLevelAgentCommand(ctx, []string{"release", serverURL, thread.ID, "--actor", "claude", "--body", "別のサブエージェントに戻します。"}, &released); err != nil {
		t.Fatalf("release failed: %v", err)
	}
	assertTopLevelWriteOutput(t, released.String(), "release", thread.ID, "claude", "open")

	activities := fetchTopLevelAgentActivities(t, ctx, serverURL, thread.ID)
	if len(activities) < 2 || activities[len(activities)-2].Actor.Kind != "claude_code" || activities[len(activities)-1].Actor.Kind != "claude_code" {
		t.Fatalf("claim/release should map claude to claude_code activities: %#v", activities)
	}
}

func TestTopLevelReplyValidationIsNonInteractiveAndActorScoped(t *testing.T) {
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)
	thread := createTopLevelAgentThread(t, ctx, serverURL, "README.md", "お願いします")

	cases := []struct {
		name string
		args []string
		want string
	}{
		{
			name: "unsupported actor",
			args: []string{"reply", serverURL, thread.ID, "--actor", "cursor", "--body", "Fixed."},
			want: `error: unsupported actor "cursor"; expected one of: codex, claude`,
		},
		{
			name: "missing body",
			args: []string{"reply", serverURL, thread.ID, "--actor", "codex"},
			want: "error: missing reply body; pass --body <text> or --body-file <path|->",
		},
		{
			name: "missing actor",
			args: []string{"reply", serverURL, thread.ID, "--body", "Fixed."},
			want: "error: missing required --actor; expected one of: codex, claude",
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			var stdout bytes.Buffer
			err := runTopLevelAgentCommand(ctx, tt.args, &stdout)
			if err == nil || err.Error() != tt.want {
				t.Fatalf("error = %v, want %q", err, tt.want)
			}
			if stdout.Len() != 0 {
				t.Fatalf("validation should not write stdout, got %q", stdout.String())
			}
		})
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

func assertTopLevelWriteOutput(t *testing.T, raw string, kind string, id string, actor string, status string) {
	t.Helper()
	decoded := decodeSingleJSONLine(t, raw)
	if decoded["type"] != kind || decoded["id"] != id || decoded["actor"] != actor || decoded["status"] != status {
		t.Fatalf("write output = %#v, want type=%s id=%s actor=%s status=%s", decoded, kind, id, actor, status)
	}
}

func runTopLevelAgentCommandForTest(ctx context.Context, args []string, stdout io.Writer, stdin io.Reader) error {
	if stdin == nil {
		return runTopLevelAgentCommand(ctx, args, stdout)
	}
	previous := os.Stdin
	readFile, writeFile, err := os.Pipe()
	if err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() {
		_, copyErr := io.Copy(writeFile, stdin)
		closeErr := writeFile.Close()
		if copyErr != nil {
			done <- copyErr
			return
		}
		done <- closeErr
	}()
	os.Stdin = readFile
	defer func() {
		os.Stdin = previous
		_ = readFile.Close()
		<-done
	}()
	return runTopLevelAgentCommand(ctx, args, stdout)
}
