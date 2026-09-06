// Package attention persists workspace activity independently of browser sessions.
package attention

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const Window = 30 * time.Minute

type Event struct {
	Path        string `json:"path"`
	At          int64  `json:"at"`
	Order       int64  `json:"order,omitempty"`
	Reason      string `json:"reason"`
	Fingerprint string `json:"fingerprint,omitempty"`
}
type Store struct{ Dir string }

func New(dir string) *Store { return &Store{Dir: filepath.Join(dir, "attention")} }
func (s *Store) Append(e Event) error {
	if err := os.MkdirAll(s.Dir, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(s.Dir, time.Now().UTC().Format("2006-01-02")+".jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(data, '\n'))
	return err
}
func (s *Store) Snapshot(now time.Time) ([]Event, error) {
	latest := map[string]Event{}
	hidden := map[string]Event{}
	// Read only the two UTC days that can contain the 30-minute window.
	for _, day := range []time.Time{now.Add(-24 * time.Hour), now} {
		f, err := os.Open(filepath.Join(s.Dir, day.UTC().Format("2006-01-02")+".jsonl"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		info, err := f.Stat()
		if err != nil {
			f.Close()
			return nil, err
		}
		const limit int64 = 32 * 1024 * 1024
		if info.Size() > limit {
			_, _ = f.Seek(info.Size()-limit, 0)
		}
		scan := bufio.NewScanner(f)
		scan.Buffer(make([]byte, 4096), 1024*1024)
		for scan.Scan() {
			var e Event
			if json.Unmarshal(scan.Bytes(), &e) != nil || e.At > now.UnixMilli() || e.Path == "" {
				continue
			}
			if e.Reason == "hidden" {
				if newer(e, hidden[e.Path]) {
					hidden[e.Path] = e
				}
				continue
			}
			if newer(e, latest[e.Path]) {
				latest[e.Path] = e
			}
		}
		err = scan.Err()
		f.Close()
		if err != nil {
			return nil, err
		}
	}
	result := []Event{}
	for path, e := range latest {
		if now.UnixMilli()-e.At < Window.Milliseconds() && newer(e, hidden[path]) {
			result = append(result, e)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].At == result[j].At {
			return result[i].Path < result[j].Path
		}
		return result[i].At > result[j].At
	})
	return result, nil
}

func newer(a, b Event) bool { return a.At > b.At || (a.At == b.At && a.Order > b.Order) }
