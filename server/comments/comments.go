package comments

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Store struct {
	path string
	mu   sync.Mutex
}

type Filters struct {
	Path   string
	Status string
}

func NewStore(dataDir string) (*Store, error) {
	if dataDir == "" {
		dataDir = defaultDataDir()
	}
	return &Store{path: filepath.Join(dataDir, "comments.jsonl")}, nil
}

func (store *Store) List(filters Filters) ([]map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	filtered := []map[string]any{}
	for _, comment := range comments {
		if filters.Path != "" && comment["path"] != filters.Path {
			continue
		}
		if filters.Status != "" && comment["status"] != filters.Status {
			continue
		}
		filtered = append(filtered, comment)
	}
	return filtered, nil
}

func (store *Store) Create(input map[string]any, fileHash, viewerKind string) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	pathValue, _ := input["path"].(string)
	body, _ := input["body"].(string)
	if strings.TrimSpace(pathValue) == "" {
		return nil, errors.New("path is required")
	}
	if strings.TrimSpace(body) == "" {
		return nil, errors.New("body is required")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	comment := copyMap(input)
	comment["id"] = randomID()
	comment["path"] = strings.TrimSpace(pathValue)
	comment["body"] = strings.TrimSpace(body)
	comment["viewerKind"] = viewerKind
	if _, ok := comment["status"].(string); !ok {
		comment["status"] = "open"
	}
	comment["createdAt"] = now
	comment["updatedAt"] = now
	addFileHash(comment, fileHash)
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	comments = append(comments, comment)
	return comment, store.writeAll(comments)
}

func (store *Store) Update(id string, input map[string]any) (map[string]any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("comment id is required")
	}
	comments, err := store.readAll()
	if err != nil {
		return nil, err
	}
	for index, comment := range comments {
		if comment["id"] != id {
			continue
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if body, ok := input["body"].(string); ok {
			comment["body"] = strings.TrimSpace(body)
		}
		if status, ok := input["status"].(string); ok {
			comment["status"] = status
			if status == "resolved" {
				comment["resolvedAt"] = now
			}
			if status == "archived" {
				comment["archivedAt"] = now
			}
		}
		comment["updatedAt"] = now
		comments[index] = comment
		return comment, store.writeAll(comments)
	}
	return nil, errors.New("comment not found")
}

func (store *Store) ExportJSONL(filters Filters) (string, error) {
	comments, err := store.List(filters)
	if err != nil {
		return "", err
	}
	lines := []string{}
	for _, comment := range comments {
		bytes, err := json.Marshal(comment)
		if err != nil {
			return "", err
		}
		lines = append(lines, string(bytes))
	}
	return strings.Join(lines, "\n"), nil
}

func (store *Store) readAll() ([]map[string]any, error) {
	file, err := os.Open(store.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	defer file.Close()
	comments := []map[string]any{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var comment map[string]any
		if err := json.Unmarshal([]byte(line), &comment); err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	return comments, scanner.Err()
}

func (store *Store) writeAll(comments []map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(store.path), 0o755); err != nil {
		return err
	}
	tmp := store.path + ".tmp"
	file, err := os.Create(tmp)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	for _, comment := range comments {
		if err := encoder.Encode(comment); err != nil {
			file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, store.path)
}

func addFileHash(comment map[string]any, fileHash string) {
	anchor, ok := comment["anchor"].(map[string]any)
	if !ok {
		return
	}
	canonical, ok := anchor["canonical"].(map[string]any)
	if !ok {
		return
	}
	if canonical["fileHash"] == nil {
		canonical["fileHash"] = fileHash
	}
}

func copyMap(input map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range input {
		output[key] = value
	}
	return output
}

func randomID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(bytes[:])
}

func defaultDataDir() string {
	if value := os.Getenv("VIVI_DATA_DIR"); value != "" {
		return value
	}
	if value := os.Getenv("XDG_DATA_HOME"); value != "" {
		return filepath.Join(value, "vivi")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "vivi")
	}
	return filepath.Join(home, ".local", "share", "vivi")
}
