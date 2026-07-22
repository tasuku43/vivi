package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestDefaultViviServerRegistryDirPrefersConfiguredRuntimeLocations(t *testing.T) {
	t.Run("vivi data directory", func(t *testing.T) {
		t.Setenv("VIVI_DATA_DIR", "/tmp/vivi-data")
		t.Setenv("XDG_RUNTIME_DIR", "/tmp/xdg-runtime")
		dir, err := defaultViviServerRegistryDir()
		if err != nil {
			t.Fatal(err)
		}
		if want := filepath.Join("/tmp/vivi-data", "runtime", "servers"); dir != want {
			t.Fatalf("dir = %q, want %q", dir, want)
		}
	})

	t.Run("xdg runtime directory", func(t *testing.T) {
		t.Setenv("VIVI_DATA_DIR", "")
		t.Setenv("XDG_RUNTIME_DIR", "/tmp/xdg-runtime")
		dir, err := defaultViviServerRegistryDir()
		if err != nil {
			t.Fatal(err)
		}
		if want := filepath.Join("/tmp/xdg-runtime", "vivi", "servers"); dir != want {
			t.Fatalf("dir = %q, want %q", dir, want)
		}
	})
}

func TestViviServerRegistryRegisterListAndRemove(t *testing.T) {
	root := t.TempDir()
	registry := newViviServerRegistry(filepath.Join(t.TempDir(), "registry"))
	registry.now = func() time.Time { return time.Date(2026, time.July, 22, 12, 30, 0, 0, time.UTC) }
	server := newRegistryGraphQLServer(t, root)
	defer server.Close()

	registration, err := registry.Register(root, server.URL+"/", os.Getpid())
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	assertFileMode(t, registry.dir, 0o700)
	assertFileMode(t, registration.path, 0o600)

	contents, err := os.ReadFile(registration.path)
	if err != nil {
		t.Fatal(err)
	}
	var stored viviServerRegistryEntry
	if err := json.Unmarshal(contents, &stored); err != nil {
		t.Fatalf("decode registration: %v", err)
	}
	canonicalRoot := mustCanonicalViviServerPath(t, root)
	if stored.SchemaVersion != 1 || stored.ID != registration.id || stored.Root != canonicalRoot || stored.URL != server.URL || stored.PID != os.Getpid() || !stored.StartedAt.Equal(registry.now()) {
		t.Fatalf("unexpected registration: %#v", stored)
	}

	workspace := filepath.Join(root, "nested", "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	servers, err := registry.List(context.Background(), workspace)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(servers) != 1 || servers[0].Root != canonicalRoot || servers[0].URL != server.URL || !servers[0].MatchesCWD {
		t.Fatalf("unexpected discovered servers: %#v", servers)
	}

	if err := registration.Remove(); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := os.Stat(registration.path); !os.IsNotExist(err) {
		t.Fatalf("registration still exists after removal: %v", err)
	}
	if err := registration.Remove(); err != nil {
		t.Fatalf("second remove should be idempotent: %v", err)
	}
}

func TestViviServerRegistryListMatchesCanonicalAncestorsAndSorts(t *testing.T) {
	base := t.TempDir()
	parentRoot := filepath.Join(base, "work")
	projectRoot := filepath.Join(parentRoot, "project")
	otherRoot := filepath.Join(base, "sandbox")
	for _, dir := range []string{projectRoot, otherRoot} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	registry := newViviServerRegistry(filepath.Join(t.TempDir(), "registry"))
	servers := []*httptest.Server{
		newRegistryGraphQLServer(t, otherRoot),
		newRegistryGraphQLServer(t, projectRoot),
		newRegistryGraphQLServer(t, parentRoot),
	}
	for _, server := range servers {
		defer server.Close()
	}
	for index, root := range []string{otherRoot, projectRoot, parentRoot} {
		if _, err := registry.Register(root, servers[index].URL, os.Getpid()); err != nil {
			t.Fatalf("register %q: %v", root, err)
		}
	}

	workspace := filepath.Join(projectRoot, "nested")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	cwd := workspace
	if runtime.GOOS != "windows" {
		link := filepath.Join(base, "workspace-link")
		if err := os.Symlink(workspace, link); err != nil {
			t.Fatal(err)
		}
		cwd = link
	}
	discovered, err := registry.List(context.Background(), cwd)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(discovered) != 3 {
		t.Fatalf("got %d servers: %#v", len(discovered), discovered)
	}
	wantRoots := []string{
		mustCanonicalViviServerPath(t, parentRoot),
		mustCanonicalViviServerPath(t, projectRoot),
		mustCanonicalViviServerPath(t, otherRoot),
	}
	wantMatches := []bool{true, true, false}
	for index := range discovered {
		if discovered[index].Root != wantRoots[index] || discovered[index].MatchesCWD != wantMatches[index] {
			t.Fatalf("server[%d] = %#v, want root=%q match=%t", index, discovered[index], wantRoots[index], wantMatches[index])
		}
	}
}

func TestViviServerRegistryListPrunesMalformedUnreachableAndMismatchedEntries(t *testing.T) {
	registry := newViviServerRegistry(filepath.Join(t.TempDir(), "registry"))
	root := t.TempDir()
	otherRoot := t.TempDir()

	unreachable := newRegistryGraphQLServer(t, root)
	if _, err := registry.Register(root, unreachable.URL, os.Getpid()); err != nil {
		t.Fatal(err)
	}
	unreachable.Close()

	mismatched := newRegistryGraphQLServer(t, otherRoot)
	defer mismatched.Close()
	if _, err := registry.Register(root, mismatched.URL, os.Getpid()); err != nil {
		t.Fatal(err)
	}

	malformedPath := filepath.Join(registry.dir, "malformed.json")
	if err := os.WriteFile(malformedPath, []byte(`{"schemaVersion":1`), 0o600); err != nil {
		t.Fatal(err)
	}
	invalidURLID := strings.Repeat("a", 32)
	invalidURLPath := filepath.Join(registry.dir, invalidURLID+".json")
	writeRegistryTestEntry(t, invalidURLPath, viviServerRegistryEntry{
		SchemaVersion: 1,
		ID:            invalidURLID,
		Root:          root,
		URL:           "file:///tmp/not-a-server",
		PID:           os.Getpid(),
		StartedAt:     time.Now(),
	})

	servers, err := registry.List(context.Background(), root)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(servers) != 0 {
		t.Fatalf("stale registrations were returned: %#v", servers)
	}
	entries, err := os.ReadDir(registry.dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("stale registrations were not pruned: %#v", entries)
	}
}

func TestViviServerRegistryListIgnoresAtomicWriteTemporaryFiles(t *testing.T) {
	registry := newViviServerRegistry(filepath.Join(t.TempDir(), "registry"))
	if err := os.MkdirAll(registry.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	temporaryPath := filepath.Join(registry.dir, ".vivi-server-in-progress.tmp")
	if err := os.WriteFile(temporaryPath, []byte(`{"partial":`), 0o600); err != nil {
		t.Fatal(err)
	}

	servers, err := registry.List(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(servers) != 0 {
		t.Fatalf("temporary file produced servers: %#v", servers)
	}
	if _, err := os.Stat(temporaryPath); err != nil {
		t.Fatalf("temporary file should be ignored, not pruned: %v", err)
	}
}

func TestViviServerRegistryListDeduplicatesRestartedServer(t *testing.T) {
	root := t.TempDir()
	registry := newViviServerRegistry(filepath.Join(t.TempDir(), "registry"))
	startedAt := time.Date(2026, time.July, 22, 9, 0, 0, 0, time.UTC)
	registry.now = func() time.Time { return startedAt }
	server := newRegistryGraphQLServer(t, root)
	defer server.Close()

	older, err := registry.Register(root, server.URL, os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	startedAt = startedAt.Add(time.Minute)
	newer, err := registry.Register(root, server.URL, os.Getpid())
	if err != nil {
		t.Fatal(err)
	}

	servers, err := registry.List(context.Background(), root)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(servers) != 1 || servers[0].URL != server.URL {
		t.Fatalf("duplicate server registrations were returned: %#v", servers)
	}
	if _, err := os.Stat(older.path); !os.IsNotExist(err) {
		t.Fatalf("older registration was not pruned: %v", err)
	}
	if _, err := os.Stat(newer.path); err != nil {
		t.Fatalf("newer registration was not retained: %v", err)
	}
}

func TestViviServerRegistrationRemoveDoesNotDeleteChangedEntry(t *testing.T) {
	root := t.TempDir()
	registry := newViviServerRegistry(filepath.Join(t.TempDir(), "registry"))
	registration, err := registry.Register(root, "http://127.0.0.1:4317", os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(registration.path)
	if err != nil {
		t.Fatal(err)
	}
	var entry viviServerRegistryEntry
	if err := json.Unmarshal(contents, &entry); err != nil {
		t.Fatal(err)
	}
	entry.ID = "replacement"
	writeRegistryTestEntry(t, registration.path, entry)

	if err := registration.Remove(); err == nil || !strings.Contains(err.Error(), "id changed") {
		t.Fatalf("remove error = %v, want changed id error", err)
	}
	if _, err := os.Stat(registration.path); err != nil {
		t.Fatalf("changed registration was deleted: %v", err)
	}
}

func TestWriteViviServersProjectionIsCompactEscapedAndDeterministic(t *testing.T) {
	servers := []discoveredViviServer{
		{Root: "/work/zeta", URL: "http://127.0.0.1:4318"},
		{Root: "/work/alpha\nforged", URL: "http://127.0.0.1:4317", MatchesCWD: true},
	}
	var stdout bytes.Buffer
	if err := writeViviServersProjection(&stdout, servers); err != nil {
		t.Fatal(err)
	}
	want := "servers count=2 matches=1 external-text=untrusted escaped\n" +
		"* \"/work/alpha\\\\nforged\" http://127.0.0.1:4317\n" +
		"  \"/work/zeta\" http://127.0.0.1:4318\n"
	if stdout.String() != want {
		t.Fatalf("projection mismatch\ngot:\n%s\nwant:\n%s", stdout.String(), want)
	}

	stdout.Reset()
	if err := writeViviServersProjection(&stdout, nil); err != nil {
		t.Fatal(err)
	}
	if stdout.String() != "servers count=0 matches=0\n" {
		t.Fatalf("zero projection = %q", stdout.String())
	}
}

func TestNormalizeViviServerURLRequiresHTTPOrigin(t *testing.T) {
	for _, rawURL := range []string{
		"file:///tmp/vivi",
		"http://127.0.0.1:4317/path",
		"http://user@127.0.0.1:4317",
		"http://127.0.0.1:4317?query=yes",
	} {
		if _, err := normalizeViviServerURL(rawURL); err == nil {
			t.Fatalf("normalizeViviServerURL(%q) succeeded", rawURL)
		}
	}
	if got, err := normalizeViviServerURL(" https://localhost:4317/ "); err != nil || got != "https://localhost:4317" {
		t.Fatalf("normalized url = %q, %v", got, err)
	}
}

func TestReadViviServerRegistryEntryRejectsRelativeRoot(t *testing.T) {
	dir := t.TempDir()
	id := strings.Repeat("b", 32)
	path := filepath.Join(dir, id+".json")
	writeRegistryTestEntry(t, path, viviServerRegistryEntry{
		SchemaVersion: 1,
		ID:            id,
		Root:          "relative/workspace",
		URL:           "http://127.0.0.1:4317",
		PID:           os.Getpid(),
		StartedAt:     time.Now(),
	})
	if _, valid := readViviServerRegistryEntry(path, filepath.Base(path)); valid {
		t.Fatal("relative root was accepted")
	}
}

func newRegistryGraphQLServer(t *testing.T, root string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/graphql" {
			http.NotFound(response, request)
			return
		}
		var body graphqlRequest
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode graphql request: %v", err)
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		if !strings.Contains(body.Query, "config { root }") {
			t.Errorf("unexpected graphql query: %s", body.Query)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = fmt.Fprintf(response, `{"data":{"config":{"root":%q}}}`, root)
	}))
}

func writeRegistryTestEntry(t *testing.T, path string, entry viviServerRegistryEntry) {
	t.Helper()
	contents, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertFileMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("mode for %q = %#o, want %#o", path, got, want)
	}
}

func mustCanonicalViviServerPath(t *testing.T, path string) string {
	t.Helper()
	canonical, err := canonicalViviServerPath(path)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}
