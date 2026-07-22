package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	viviServerRegistrySchemaVersion = 1
	viviServerProbeTimeout          = 500 * time.Millisecond
)

type viviServerRegistry struct {
	dir    string
	client *http.Client
	now    func() time.Time
	newID  func() (string, error)
}

type viviServerRegistryEntry struct {
	SchemaVersion int       `json:"schemaVersion"`
	ID            string    `json:"id"`
	Root          string    `json:"root"`
	URL           string    `json:"url"`
	PID           int       `json:"pid"`
	StartedAt     time.Time `json:"startedAt"`
}

type viviServerRegistration struct {
	path string
	id   string
}

type discoveredViviServer struct {
	Root       string
	URL        string
	MatchesCWD bool
}

func defaultViviServerRegistry() (*viviServerRegistry, error) {
	dir, err := defaultViviServerRegistryDir()
	if err != nil {
		return nil, err
	}
	return newViviServerRegistry(dir), nil
}

func defaultViviServerRegistryDir() (string, error) {
	if dataDir := strings.TrimSpace(os.Getenv("VIVI_DATA_DIR")); dataDir != "" {
		return filepath.Join(dataDir, "runtime", "servers"), nil
	}
	if runtimeDir := strings.TrimSpace(os.Getenv("XDG_RUNTIME_DIR")); runtimeDir != "" {
		return filepath.Join(runtimeDir, "vivi", "servers"), nil
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("resolve user cache directory: %w", err)
	}
	return filepath.Join(cacheDir, "vivi", "servers"), nil
}

func newViviServerRegistry(dir string) *viviServerRegistry {
	return &viviServerRegistry{
		dir: dir,
		client: &http.Client{
			Timeout: viviServerProbeTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		now:   time.Now,
		newID: newViviServerRegistryID,
	}
}

func (r *viviServerRegistry) Register(root, serverURL string, pid int) (*viviServerRegistration, error) {
	canonicalRoot, err := canonicalViviServerPath(root)
	if err != nil {
		return nil, fmt.Errorf("canonicalize server root: %w", err)
	}
	resolvedURL, err := normalizeViviServerURL(serverURL)
	if err != nil {
		return nil, err
	}
	if pid <= 0 {
		return nil, errors.New("server pid must be positive")
	}
	id, err := r.newID()
	if err != nil {
		return nil, fmt.Errorf("create server registration id: %w", err)
	}
	entry := viviServerRegistryEntry{
		SchemaVersion: viviServerRegistrySchemaVersion,
		ID:            id,
		Root:          canonicalRoot,
		URL:           resolvedURL,
		PID:           pid,
		StartedAt:     r.now().UTC(),
	}
	if err := os.MkdirAll(r.dir, 0o700); err != nil {
		return nil, fmt.Errorf("create server registry: %w", err)
	}
	if err := os.Chmod(r.dir, 0o700); err != nil {
		return nil, fmt.Errorf("protect server registry: %w", err)
	}
	path := filepath.Join(r.dir, id+".json")
	if err := writeViviServerRegistryEntry(path, entry); err != nil {
		return nil, err
	}
	return &viviServerRegistration{path: path, id: id}, nil
}

func (r *viviServerRegistry) List(ctx context.Context, cwd string) ([]discoveredViviServer, error) {
	canonicalCWD, err := canonicalViviServerPath(cwd)
	if err != nil {
		return nil, fmt.Errorf("canonicalize current directory: %w", err)
	}
	directoryEntries, err := os.ReadDir(r.dir)
	if errors.Is(err, os.ErrNotExist) {
		return []discoveredViviServer{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read server registry: %w", err)
	}
	type liveRegistration struct {
		entry viviServerRegistryEntry
		path  string
	}
	liveByServer := make(map[string]liveRegistration, len(directoryEntries))
	for _, directoryEntry := range directoryEntries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if directoryEntry.IsDir() || filepath.Ext(directoryEntry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(r.dir, directoryEntry.Name())
		entry, valid := readViviServerRegistryEntry(path, directoryEntry.Name())
		if valid {
			liveRoot, probeErr := r.probeRoot(ctx, entry.URL)
			if probeErr == nil {
				canonicalLiveRoot, canonicalErr := canonicalViviServerPath(liveRoot)
				valid = canonicalErr == nil && canonicalLiveRoot == entry.Root
			} else {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				valid = false
			}
		}
		if !valid {
			if err := removeViviServerRegistryPath(path); err != nil {
				return nil, fmt.Errorf("prune stale server registration %q: %w", directoryEntry.Name(), err)
			}
			continue
		}
		key := entry.Root + "\x00" + entry.URL
		if previous, exists := liveByServer[key]; exists {
			keepCurrent := entry.StartedAt.After(previous.entry.StartedAt) || (entry.StartedAt.Equal(previous.entry.StartedAt) && path > previous.path)
			stalePath := path
			if keepCurrent {
				stalePath = previous.path
				liveByServer[key] = liveRegistration{entry: entry, path: path}
			}
			if err := removeViviServerRegistryPath(stalePath); err != nil {
				return nil, fmt.Errorf("prune duplicate server registration %q: %w", filepath.Base(stalePath), err)
			}
			continue
		}
		liveByServer[key] = liveRegistration{entry: entry, path: path}
	}
	discovered := make([]discoveredViviServer, 0, len(liveByServer))
	for _, live := range liveByServer {
		discovered = append(discovered, discoveredViviServer{
			Root:       live.entry.Root,
			URL:        live.entry.URL,
			MatchesCWD: viviServerRootContains(live.entry.Root, canonicalCWD),
		})
	}
	sortDiscoveredViviServers(discovered)
	return discovered, nil
}

func (r *viviServerRegistry) probeRoot(ctx context.Context, serverURL string) (string, error) {
	body, err := json.Marshal(graphqlRequest{
		OperationName: "ViviServerRegistryConfig",
		Query:         `query ViviServerRegistryConfig { config { root } }`,
	})
	if err != nil {
		return "", err
	}
	probeContext, cancel := context.WithTimeout(ctx, viviServerProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(probeContext, http.MethodPost, serverURL+"/graphql", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	res, err := r.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("graphql request failed with status %d", res.StatusCode)
	}
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, 1024*1024))
	if err != nil {
		return "", err
	}
	var payload struct {
		Data struct {
			Config *struct {
				Root string `json:"root"`
			} `json:"config"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return "", err
	}
	if len(payload.Errors) > 0 || payload.Data.Config == nil || strings.TrimSpace(payload.Data.Config.Root) == "" {
		return "", errors.New("graphql response did not contain a server root")
	}
	return payload.Data.Config.Root, nil
}

func (registration *viviServerRegistration) Remove() error {
	contents, err := os.ReadFile(registration.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read server registration before removal: %w", err)
	}
	var entry viviServerRegistryEntry
	if err := json.Unmarshal(contents, &entry); err != nil {
		return fmt.Errorf("decode server registration before removal: %w", err)
	}
	if entry.ID != registration.id {
		return fmt.Errorf("server registration id changed: got %q, want %q", entry.ID, registration.id)
	}
	if err := os.Remove(registration.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove server registration: %w", err)
	}
	return nil
}

func writeViviServersProjection(stdout io.Writer, servers []discoveredViviServer) error {
	ordered := append([]discoveredViviServer(nil), servers...)
	for index := range ordered {
		resolvedURL, err := normalizeViviServerURL(ordered[index].URL)
		if err != nil {
			return fmt.Errorf("project server %q: %w", ordered[index].Root, err)
		}
		ordered[index].URL = resolvedURL
	}
	sortDiscoveredViviServers(ordered)
	matches := 0
	for _, server := range ordered {
		if server.MatchesCWD {
			matches++
		}
	}
	var output strings.Builder
	fmt.Fprintf(&output, "servers count=%d matches=%d", len(ordered), matches)
	if len(ordered) == 0 {
		output.WriteByte('\n')
		_, err := io.WriteString(stdout, output.String())
		return err
	}
	output.WriteString(" external-text=untrusted escaped\n")
	for _, server := range ordered {
		marker := "  "
		if server.MatchesCWD {
			marker = "* "
		}
		fmt.Fprintf(&output, "%s%s %s\n", marker, topLevelQuoted(server.Root), server.URL)
	}
	_, err := io.WriteString(stdout, output.String())
	return err
}

func canonicalViviServerPath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("path is empty")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	return filepath.Clean(abs), nil
}

func viviServerRootContains(root, cwd string) bool {
	relative, err := filepath.Rel(root, cwd)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative))
}

func normalizeViviServerURL(rawURL string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(rawURL), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid server url: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("invalid server url %q: expected an http(s) origin", rawURL)
	}
	return trimmed, nil
}

func sortDiscoveredViviServers(servers []discoveredViviServer) {
	sort.SliceStable(servers, func(left, right int) bool {
		if servers[left].MatchesCWD != servers[right].MatchesCWD {
			return servers[left].MatchesCWD
		}
		if servers[left].Root != servers[right].Root {
			return servers[left].Root < servers[right].Root
		}
		return servers[left].URL < servers[right].URL
	})
}

func writeViviServerRegistryEntry(path string, entry viviServerRegistryEntry) error {
	contents, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("encode server registration: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".vivi-server-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary server registration: %w", err)
	}
	temporaryPath := temporary.Name()
	cleanup := func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryPath)
	}
	if err := temporary.Chmod(0o600); err != nil {
		cleanup()
		return fmt.Errorf("protect temporary server registration: %w", err)
	}
	if _, err := temporary.Write(contents); err != nil {
		cleanup()
		return fmt.Errorf("write temporary server registration: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("sync temporary server registration: %w", err)
	}
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("close temporary server registration: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("publish server registration: %w", err)
	}
	return nil
}

func readViviServerRegistryEntry(path, filename string) (viviServerRegistryEntry, bool) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return viviServerRegistryEntry{}, false
	}
	var entry viviServerRegistryEntry
	if err := json.Unmarshal(contents, &entry); err != nil {
		return viviServerRegistryEntry{}, false
	}
	if entry.SchemaVersion != viviServerRegistrySchemaVersion || entry.ID == "" || filename != entry.ID+".json" || entry.PID <= 0 || entry.StartedAt.IsZero() || !filepath.IsAbs(entry.Root) {
		return viviServerRegistryEntry{}, false
	}
	canonicalRoot, err := canonicalViviServerPath(entry.Root)
	if err != nil {
		return viviServerRegistryEntry{}, false
	}
	resolvedURL, err := normalizeViviServerURL(entry.URL)
	if err != nil {
		return viviServerRegistryEntry{}, false
	}
	entry.Root = canonicalRoot
	entry.URL = resolvedURL
	return entry, true
}

func removeViviServerRegistryPath(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func newViviServerRegistryID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
