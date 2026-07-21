package workspace

import (
	"fmt"
	"path"
	"strings"
)

// PathExcluder matches normalized workspace-relative paths against glob
// patterns. A double star matches zero or more complete path segments.
type PathExcluder struct {
	patterns []excludePattern
}

type excludePattern struct {
	raw      string
	segments []string
}

func NewPathExcluder(values []string) (PathExcluder, error) {
	patterns := []excludePattern{}
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			pattern, ok, err := parseExcludePattern(item)
			if err != nil {
				return PathExcluder{}, err
			}
			if ok {
				patterns = append(patterns, pattern)
			}
		}
	}
	return PathExcluder{patterns: patterns}, nil
}

func (excluder PathExcluder) Matches(relative string) bool {
	normalized, err := normalizeRelativePath(relative)
	if err != nil || normalized == "" {
		return false
	}
	segments := strings.Split(normalized, "/")
	for _, pattern := range excluder.patterns {
		if matchExcludeSegments(pattern.segments, segments) {
			return true
		}
	}
	return false
}

func parseExcludePattern(input string) (excludePattern, bool, error) {
	raw := strings.TrimSpace(strings.ReplaceAll(input, "\\", "/"))
	if raw == "" {
		return excludePattern{}, false, nil
	}
	directoryPattern := strings.HasSuffix(raw, "/")
	raw = strings.TrimPrefix(raw, "./")
	raw = strings.TrimPrefix(raw, "/")
	raw = strings.TrimSuffix(raw, "/")
	if raw == "" {
		return excludePattern{}, false, fmt.Errorf("invalid exclude glob %q", input)
	}
	segments := []string{}
	for _, segment := range strings.Split(raw, "/") {
		if segment == "" || segment == "." {
			continue
		}
		if segment == ".." {
			return excludePattern{}, false, fmt.Errorf("invalid exclude glob %q: parent segments are not allowed", input)
		}
		if segment != "**" {
			if _, err := path.Match(segment, ""); err != nil {
				return excludePattern{}, false, fmt.Errorf("invalid exclude glob %q: %w", input, err)
			}
		}
		segments = append(segments, segment)
	}
	if len(segments) == 0 {
		return excludePattern{}, false, fmt.Errorf("invalid exclude glob %q", input)
	}
	if !strings.Contains(raw, "/") {
		segments = append([]string{"**"}, segments...)
	}
	if directoryPattern {
		segments = append(segments, "**")
	}
	return excludePattern{raw: input, segments: segments}, true, nil
}

func matchExcludeSegments(pattern, target []string) bool {
	if len(pattern) == 0 {
		return len(target) == 0
	}
	if pattern[0] == "**" {
		if matchExcludeSegments(pattern[1:], target) {
			return true
		}
		return len(target) > 0 && matchExcludeSegments(pattern, target[1:])
	}
	if len(target) == 0 {
		return false
	}
	matched, err := path.Match(pattern[0], target[0])
	return err == nil && matched && matchExcludeSegments(pattern[1:], target[1:])
}
