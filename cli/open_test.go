package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenValidatedDocumentAndWorkspace(t *testing.T) {
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)
	thread := createTopLevelAgentThread(t, ctx, serverURL, "README.md", "Review this")
	for _, tc := range []struct {
		args     []string
		suffix   string
		launches int
	}{
		{[]string{serverURL, "./docs/intro.md"}, "/?path=docs%2Fintro.md", 1},
		{[]string{serverURL, "README.md", "--print"}, "/?path=README.md", 0},
		{[]string{"--print", serverURL}, "/", 0},
	} {
		var output bytes.Buffer
		calls := 0
		err := runOpen(ctx, tc.args, &output, func(link string) error {
			calls++
			if link != serverURL+tc.suffix {
				t.Fatalf("wrong launch URL: %q", link)
			}
			return nil
		})
		if err != nil || output.String() != serverURL+tc.suffix+"\n" || calls != tc.launches {
			t.Fatalf("open %v: output=%q calls=%d error=%v", tc.args, output.String(), calls, err)
		}
	}
	if readActivityCount(t, ctx, serverURL, thread.ID) != 0 {
		t.Fatal("open must not mark feedback read")
	}
}

func TestOpenRejectsInvalidTargetsBeforeLaunching(t *testing.T) {
	serverURL := newTopLevelAgentTestServer(t)
	for _, args := range [][]string{
		{}, {serverURL, "a", "b"}, {"file:///tmp/a"}, {serverURL + "/?path=README.md"},
		{serverURL + "/#fragment"}, {serverURL + "/graphql"}, {serverURL, "--unknown"},
		{serverURL, "../secret.md"}, {serverURL, "/tmp/a.md"}, {serverURL, "C:\\a.md"},
		{serverURL, ""}, {serverURL, "docs"}, {serverURL, "missing.md"}, {serverURL, ".git/config"},
	} {
		var output bytes.Buffer
		err := runOpen(context.Background(), args, &output, func(string) error { t.Fatal("launched invalid target"); return nil })
		if err == nil || output.Len() != 0 {
			t.Errorf("args=%v output=%q error=%v", args, output.String(), err)
		}
	}
}

func TestOpenEscapesDocumentNamesAndRejectsOutsideSymlinks(t *testing.T) {
	ctx := context.Background()
	serverURL := newTopLevelAgentTestServer(t)
	var config struct {
		Root string `json:"root"`
	}
	if err := postGraphQL(ctx, inboxRequestOptions{URL: serverURL}, graphqlRequest{Query: `query { config { root } }`}, "config", &config); err != nil {
		t.Fatal(err)
	}
	name := "docs/日本語 & # ? %.md"
	if err := os.WriteFile(filepath.Join(config.Root, name), []byte("# Review"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runOpen(ctx, []string{serverURL, name, "--print"}, &output, nil); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(strings.TrimSpace(output.String()))
	if err != nil || parsed.Query().Get("path") != name || len(parsed.Query()) != 1 || parsed.Fragment != "" {
		t.Fatalf("unsafe URL: %q", output.String())
	}
	outside := filepath.Join(t.TempDir(), "secret.md")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(config.Root, "escape.md")); err != nil {
		t.Skip(err)
	}
	output.Reset()
	if err := runOpen(ctx, []string{serverURL, "escape.md", "--print"}, &output, nil); err == nil {
		t.Fatal("accepted outside symlink")
	}
}

func TestOpenBrowserFailureKeepsRecoveryURL(t *testing.T) {
	serverURL := newTopLevelAgentTestServer(t)
	var output bytes.Buffer
	err := runOpen(context.Background(), []string{serverURL}, &output, func(string) error { return errors.New("no browser") })
	if err == nil || !strings.Contains(err.Error(), "URL printed above") || output.String() != serverURL+"/\n" {
		t.Fatalf("output=%q error=%v", output.String(), err)
	}
}

func TestOpenDoesNotPrintLinksForFailedOrMalformedServers(t *testing.T) {
	for _, body := range []string{
		`not JSON`,
		`{"data":{"file":null}}`,
		`{"data":{"file":{"path":"another.md"}}}`,
		`{"data":{"file":{"path":"README.md"}},"errors":[{"message":"denied"}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer srv.Close()
			var output bytes.Buffer
			err := runOpen(context.Background(), []string{srv.URL, "README.md", "--print"}, &output, nil)
			if err == nil || output.Len() != 0 {
				t.Fatalf("output=%q error=%v", output.String(), err)
			}
		})
	}
	srv := httptest.NewServer(http.NotFoundHandler())
	serverURL := srv.URL
	srv.Close()
	var output bytes.Buffer
	if err := runOpen(context.Background(), []string{serverURL, "--print"}, &output, nil); err == nil || output.Len() != 0 {
		t.Fatalf("unreachable server: %v", err)
	}
}
