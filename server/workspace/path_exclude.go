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
	return excluder.matchesCanonical(normalized)
}

// matchesCanonical matches a path already normalized by the workspace walk.
// It parses path segments in place so hot directory walks do not allocate a
// second copy of every relative path just to evaluate exclusions.
func (excluder PathExcluder) matchesCanonical(relative string) bool {
	if relative == "" {
		return false
	}
	for _, pattern := range excluder.patterns {
		if matchExcludePath(pattern.segments, relative, 0) {
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

func matchExcludePath(pattern []string, target string, offset int) bool {
	if len(pattern) == 0 {
		return offset == len(target)
	}
	if pattern[0] == "**" {
		if matchExcludePath(pattern[1:], target, offset) {
			return true
		}
		for offset < len(target) {
			separator := strings.IndexByte(target[offset:], '/')
			if separator < 0 {
				offset = len(target)
			} else {
				offset += separator + 1
			}
			if matchExcludePath(pattern, target, offset) {
				return true
			}
		}
		return false
	}
	if offset >= len(target) {
		return false
	}
	segmentEnd := strings.IndexByte(target[offset:], '/')
	nextOffset := len(target)
	segment := target[offset:]
	if segmentEnd >= 0 {
		segment = target[offset : offset+segmentEnd]
		nextOffset = offset + segmentEnd + 1
	}
	matched, err := path.Match(pattern[0], segment)
	return err == nil && matched && matchExcludePath(pattern[1:], target, nextOffset)
}
