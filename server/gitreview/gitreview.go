package gitreview

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/tasuku43/vivi/internal/telemetry"
	"github.com/tasuku43/vivi/server/workspace"
)

type Change struct {
	Path         string `json:"path"`
	Status       string `json:"status"`
	Kind         string `json:"kind,omitempty"`
	OriginalPath string `json:"originalPath,omitempty"`
}

type Summary struct {
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`
	Changes   []Change `json:"changes"`
}

type DiffBase struct {
	Ref     string `json:"ref"`
	Label   string `json:"label"`
	Subject string `json:"subject,omitempty"`
}

type DiffBaseSummary struct {
	Available bool       `json:"available"`
	Reason    string     `json:"reason,omitempty"`
	Options   []DiffBase `json:"options"`
}

type TextDiff struct {
	Path         string `json:"path"`
	Status       string `json:"status"`
	Kind         string `json:"kind,omitempty"`
	BaseLabel    string `json:"baseLabel"`
	BaseRef      string `json:"baseRef"`
	CompareLabel string `json:"compareLabel"`
	DiffHash     string `json:"diffHash,omitempty"`
	Content      string `json:"content"`
	Reason       string `json:"reason,omitempty"`
}

type Reviewer struct {
	root           string
	rootReal       string
	timeout        time.Duration
	maxDiffBytes   int64
	suppressedTill time.Time
}

func New(root string, timeout time.Duration) (*Reviewer, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	rootReal, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		rootReal = absolute
	}
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	return &Reviewer{
		root:         absolute,
		rootReal:     rootReal,
		timeout:      timeout,
		maxDiffBytes: 256 * 1024,
	}, nil
}

func (reviewer *Reviewer) ReadChanges(ctx context.Context) (summary Summary) {
	started := time.Now()
	defer func() {
		telemetry.RecordOperation(ctx, "git.review_status_refresh", telemetry.OperationStats{
			DurationMs:  time.Since(started).Milliseconds(),
			ResultCount: len(summary.Changes),
			Error:       !summary.Available,
		})
	}()
	if time.Now().Before(reviewer.suppressedTill) {
		summary = unavailable(timeoutReason)
		return summary
	}
	gitRoot, prefix, reason, ok := reviewer.workspace(ctx)
	if !ok {
		summary = unavailable(reason)
		return summary
	}
	output, reason, ok := reviewer.gitStatus(ctx)
	if !ok {
		if reason == timeoutReason {
			reviewer.suppressedTill = time.Now().Add(30 * time.Second)
		}
		summary = unavailable(reason)
		return summary
	}
	_ = gitRoot
	changes := parseStatus(output)
	workspaceChanges := []Change{}
	for _, change := range changes {
		converted, ok := changeToWorkspace(change, prefix)
		if !ok || isIgnored(converted.Path) {
			continue
		}
		classified := reviewer.classify(converted)
		workspaceChanges = append(workspaceChanges, classified...)
	}
	sort.Slice(workspaceChanges, func(i, j int) bool {
		return workspaceChanges[i].Path < workspaceChanges[j].Path
	})
	summary = Summary{Available: true, Reason: reason, Changes: workspaceChanges}
	return summary
}

func (reviewer *Reviewer) ReadDiffBases(ctx context.Context) DiffBaseSummary {
	output, reason, ok := reviewer.gitLog(ctx)
	if !ok {
		return DiffBaseSummary{Available: false, Reason: reason, Options: []DiffBase{}}
	}
	commits := strings.Split(output, "\x00")
	options := []DiffBase{{Ref: "HEAD", Label: "HEAD"}}
	if len(commits) >= 3 {
		options[0].Subject = strings.TrimSpace(commits[2])
	}
	for index := 3; index+2 < len(commits); index += 3 {
		sha := strings.TrimSpace(commits[index])
		short := strings.TrimSpace(commits[index+1])
		subject := strings.TrimSpace(commits[index+2])
		if sha == "" || short == "" {
			continue
		}
		label := short
		if index == 3 {
			label = "HEAD~1"
		}
		options = append(options, DiffBase{Ref: sha, Label: label, Subject: subject})
	}
	return DiffBaseSummary{Available: true, Options: options}
}

func (reviewer *Reviewer) ReadDiff(ctx context.Context, relativePath, baseRef string) TextDiff {
	if baseRef == "" {
		baseRef = "HEAD"
	}
	relativePath, err := normalizeRelativePath(relativePath)
	if err != nil {
		return unavailableDiff(relativePath, err.Error())
	}
	if relativePath == "" {
		return unavailableDiff(relativePath, "file path is required")
	}
	if _, ok := reviewer.absolutePathForWorkspacePath(relativePath); !ok {
		return unavailableDiff(relativePath, "path escapes root")
	}
	base, ok := reviewer.allowedBase(ctx, baseRef)
	if !ok {
		return unavailableDiff(relativePath, "Diff base is not an allowed recent commit.")
	}
	changes := reviewer.ReadChanges(ctx)
	if !changes.Available {
		return unavailableDiff(relativePath, changes.Reason)
	}
	var selected *Change
	for index := range changes.Changes {
		if changes.Changes[index].Path == relativePath {
			selected = &changes.Changes[index]
			break
		}
	}
	if selected == nil {
		return unavailableDiff(relativePath, "No uncommitted Git change was found for this file.")
	}
	if selected.Kind == "directory" || selected.Kind == "embedded-repo" {
		return TextDiff{
			Path:         relativePath,
			Status:       "unavailable",
			Kind:         selected.Kind,
			BaseLabel:    base.Label,
			CompareLabel: "working tree",
			Content:      "",
			Reason:       kindReason(selected.Kind),
		}
	}
	if selected.Status == "added" && base.Ref == "HEAD" {
		return reviewer.addedDiff(relativePath, base)
	}
	output, reason, ok := reviewer.gitPathDiff(ctx, base.Ref, relativePath)
	if !ok {
		return unavailableDiff(relativePath, reason)
	}
	if strings.TrimSpace(output) == "" {
		return unavailableDiff(relativePath, "No text diff is available for this file.")
	}
	if int64(len(output)) > reviewer.maxDiffBytes {
		return TextDiff{Path: relativePath, Status: "too-large", BaseLabel: base.Label, CompareLabel: "working tree", Content: "", Reason: "Diff exceeds 256.0 KB."}
	}
	if strings.Contains(output, "Binary files ") {
		return TextDiff{Path: relativePath, Status: "binary", BaseLabel: base.Label, CompareLabel: "working tree", Content: "", Reason: "Binary diff is not shown in Vivi."}
	}
	return availableDiff(relativePath, base, output)
}

func (reviewer *Reviewer) addedDiff(relativePath string, base DiffBase) TextDiff {
	absolute, ok := reviewer.absolutePathForWorkspacePath(relativePath)
	if !ok {
		return unavailableDiff(relativePath, "path escapes root")
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return unavailableDiff(relativePath, "File no longer exists in the working tree.")
	}
	if info.IsDir() {
		kind := "directory"
		if isEmbeddedRepo(absolute) {
			kind = "embedded-repo"
		}
		return TextDiff{Path: relativePath, Status: "unavailable", Kind: kind, BaseLabel: base.Label, CompareLabel: "working tree", Content: "", Reason: kindReason(kind)}
	}
	if info.Size() > reviewer.maxDiffBytes {
		return TextDiff{Path: relativePath, Status: "too-large", BaseLabel: base.Label, CompareLabel: "working tree", Content: "", Reason: "File exceeds 256.0 KB."}
	}
	content, err := os.ReadFile(absolute)
	if err != nil {
		return unavailableDiff(relativePath, err.Error())
	}
	if workspace.IsBinary(content) {
		return TextDiff{Path: relativePath, Status: "binary", BaseLabel: base.Label, CompareLabel: "working tree", Content: "", Reason: "Binary diff is not shown in Vivi."}
	}
	return availableDiff(relativePath, base, buildAddedDiff(relativePath, string(content)))
}

func availableDiff(path string, base DiffBase, content string) TextDiff {
	hash := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(content)))
	return TextDiff{Path: path, Status: "available", BaseLabel: base.Label, BaseRef: base.Ref, CompareLabel: "working tree", DiffHash: hash, Content: content}
}

func (reviewer *Reviewer) allowedBase(ctx context.Context, ref string) (DiffBase, bool) {
	if ref == "HEAD" {
		return DiffBase{Ref: "HEAD", Label: "HEAD"}, true
	}
	bases := reviewer.ReadDiffBases(ctx)
	if !bases.Available {
		return DiffBase{}, false
	}
	for _, base := range bases.Options {
		if base.Ref == ref {
			return base, true
		}
	}
	return DiffBase{}, false
}

func (reviewer *Reviewer) classify(change Change) []Change {
	if change.Status != "added" {
		change.Kind = "file"
		return []Change{change}
	}
	absolute, ok := reviewer.absolutePathForWorkspacePath(change.Path)
	if !ok {
		return nil
	}
	linkInside, isLink := reviewer.symlinkInsideRoot(absolute)
	if isLink && !linkInside {
		return nil
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		change.Kind = "file"
		return []Change{change}
	}
	if isEmbeddedRepo(absolute) {
		change.Kind = "embedded-repo"
		return []Change{change}
	}
	expanded := reviewer.expandAddedDirectory(change.Path, absolute)
	if len(expanded) == 0 {
		change.Kind = "directory"
		return []Change{change}
	}
	return expanded
}

func (reviewer *Reviewer) expandAddedDirectory(relative, absolute string) []Change {
	entries, err := os.ReadDir(absolute)
	if err != nil {
		return []Change{{Path: relative, Status: "added", Kind: "directory"}}
	}
	changes := []Change{}
	for _, entry := range entries {
		childRelative := relative + "/" + entry.Name()
		if isIgnored(childRelative) {
			continue
		}
		childAbsolute, ok := reviewer.absolutePathForWorkspacePath(childRelative)
		if !ok {
			continue
		}
		if linkInside, isLink := reviewer.symlinkInsideRoot(childAbsolute); isLink && !linkInside {
			continue
		}
		info, err := os.Stat(childAbsolute)
		if err != nil {
			continue
		}
		if info.IsDir() {
			if isEmbeddedRepo(childAbsolute) {
				changes = append(changes, Change{Path: childRelative, Status: "added", Kind: "embedded-repo"})
				continue
			}
			changes = append(changes, reviewer.expandAddedDirectory(childRelative, childAbsolute)...)
			continue
		}
		if info.Mode().IsRegular() {
			changes = append(changes, Change{Path: childRelative, Status: "added", Kind: "file"})
		}
	}
	return changes
}

func (reviewer *Reviewer) workspace(ctx context.Context) (string, string, string, bool) {
	output, reason, ok := reviewer.gitRevParseTopLevel(ctx)
	if !ok {
		if strings.Contains(reason, "not a git repository") || strings.Contains(reason, "not a Git repository") {
			return "", "", "This workspace is not a Git repository.", false
		}
		return "", "", reason, false
	}
	gitRoot := strings.TrimSpace(output)
	gitRootReal, err := filepath.EvalSymlinks(gitRoot)
	if err != nil {
		gitRootReal = gitRoot
	}
	relative, err := filepath.Rel(gitRootReal, reviewer.rootReal)
	if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		return "", "", "workspace is outside the Git repository", false
	}
	if relative == "." {
		relative = ""
	}
	return gitRootReal, filepath.ToSlash(relative), "", true
}

func (reviewer *Reviewer) symlinkInsideRoot(absolute string) (bool, bool) {
	info, err := os.Lstat(absolute)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		return true, false
	}
	target, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return false, true
	}
	return insidePath(reviewer.rootReal, target), true
}

func (reviewer *Reviewer) gitStatus(ctx context.Context) (string, string, bool) {
	command := exec.Command("git", "status", "--porcelain=v1", "--untracked-files=all", "-z", "--", ".")
	output, reason, ok := reviewer.runGit(ctx, command)
	if ok || reason != timeoutReason {
		return output, reason, ok
	}
	fallback := exec.Command("git", "status", "--porcelain=v1", "--untracked-files=no", "-z", "--", ".")
	output, reason, ok = reviewer.runGit(ctx, fallback)
	if !ok {
		return output, reason, ok
	}
	return output, partialTimeoutReason, true
}

func (reviewer *Reviewer) gitLog(ctx context.Context) (string, string, bool) {
	command := exec.Command("git", "log", "--max-count=8", "--format=%H%x00%h%x00%s%x00")
	return reviewer.runGit(ctx, command)
}

func (reviewer *Reviewer) gitRevParseTopLevel(ctx context.Context) (string, string, bool) {
	command := exec.Command("git", "rev-parse", "--show-toplevel")
	return reviewer.runGit(ctx, command)
}

func (reviewer *Reviewer) gitPathDiff(ctx context.Context, baseRef string, relativePath string) (string, string, bool) {
	ref := strings.TrimSpace(baseRef)
	if ref == "" {
		ref = "HEAD"
	}
	gitRoot, prefix, reason, ok := reviewer.workspace(ctx)
	if !ok {
		return "", reason, false
	}
	_ = gitRoot
	args := []string{"diff"}
	if prefix != "" {
		args = append(args, "--relative="+prefix)
	}
	args = append(args, "--unified=1000000", ref, "--", relativePath)
	command := exec.Command("git", args...)
	return reviewer.runGit(ctx, command)
}

func (reviewer *Reviewer) runGit(ctx context.Context, command *exec.Cmd) (string, string, bool) {
	timeoutCtx, cancel := context.WithTimeout(ctx, reviewer.timeout)
	defer cancel()
	command.Dir = reviewer.root
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	if err := command.Start(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", "Git executable was not found. Install Git or start vivi with Git on PATH.", false
		}
		return "", err.Error(), false
	}
	done := make(chan error, 1)
	go func() {
		done <- command.Wait()
	}()

	select {
	case err := <-done:
		if err != nil {
			reason := strings.TrimSpace(stderr.String())
			if reason == "" {
				reason = err.Error()
			}
			return "", reason, false
		}
	case <-timeoutCtx.Done():
		killProcessGroup(command)
		<-done
		return "", timeoutReason, false
	}
	return stdout.String(), "", true
}

func (reviewer *Reviewer) absolutePathForWorkspacePath(relative string) (string, bool) {
	normalized, err := normalizeRelativePath(relative)
	if err != nil || normalized == "" {
		return "", false
	}
	absolute := filepath.Join(reviewer.root, filepath.FromSlash(normalized))
	if !insidePath(reviewer.root, absolute) {
		return "", false
	}
	return absolute, true
}

func killProcessGroup(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil {
		_ = command.Process.Kill()
	}
}

type rawChange struct {
	path         string
	status       string
	originalPath string
}

func parseStatus(output string) []Change {
	fields := strings.Split(output, "\x00")
	changes := []Change{}
	for index := 0; index < len(fields); index++ {
		entry := fields[index]
		if entry == "" || len(entry) < 4 {
			continue
		}
		code := entry[:2]
		pathname := entry[3:]
		status := statusFromCode(code)
		if status == "" || pathname == "" {
			continue
		}
		change := Change{Path: filepath.ToSlash(pathname), Status: status}
		if status == "renamed" && index+1 < len(fields) {
			change.OriginalPath = filepath.ToSlash(fields[index+1])
			index++
		}
		changes = append(changes, change)
	}
	return changes
}

func statusFromCode(code string) string {
	if strings.Contains(code, "R") {
		return "renamed"
	}
	if code == "??" || strings.Contains(code, "A") {
		return "added"
	}
	if strings.Contains(code, "D") {
		return "deleted"
	}
	if strings.Contains(code, "M") || strings.Contains(code, "T") {
		return "modified"
	}
	return ""
}

func changeToWorkspace(change Change, prefix string) (Change, bool) {
	pathname, ok := gitPathToWorkspace(change.Path, prefix)
	if !ok {
		return Change{}, false
	}
	change.Path = pathname
	if change.OriginalPath != "" {
		if original, ok := gitPathToWorkspace(change.OriginalPath, prefix); ok {
			change.OriginalPath = original
		}
	}
	return change, true
}

func gitPathToWorkspace(pathname, prefix string) (string, bool) {
	normalized, err := normalizeRelativePath(pathname)
	if err != nil || normalized == "" {
		return "", false
	}
	if prefix == "" {
		return normalized, true
	}
	needle := prefix + "/"
	if !strings.HasPrefix(normalized, needle) {
		return "", false
	}
	result := strings.TrimPrefix(normalized, needle)
	return result, result != ""
}

func normalizeRelativePath(input string) (string, error) {
	raw := strings.TrimSpace(strings.ReplaceAll(input, "\\", "/"))
	if raw == "" || raw == "." || strings.HasPrefix(raw, "/") || strings.Contains(raw, "\x00") {
		return "", fmt.Errorf("path escapes root")
	}
	parts := []string{}
	for _, part := range strings.Split(raw, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			if len(parts) == 0 {
				return "", fmt.Errorf("path escapes root")
			}
			parts = parts[:len(parts)-1]
			continue
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, "/"), nil
}

func isIgnored(relative string) bool {
	for _, segment := range strings.Split(relative, "/") {
		switch segment {
		case ".git", "node_modules", ".turbo", ".next", ".cache", ".parcel-cache", ".vite", ".tmp-go-build-cache", ".tmp-go-mod-cache", "dist", "coverage", "storybook-static":
			return true
		}
	}
	return false
}

func isEmbeddedRepo(absolute string) bool {
	_, err := os.Stat(filepath.Join(absolute, ".git"))
	return err == nil
}

func insidePath(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return relative == "." || (!strings.HasPrefix(relative, "..") && !filepath.IsAbs(relative))
}

func buildAddedDiff(relativePath, content string) string {
	content = strings.TrimSuffix(content, "\n")
	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		lines = []string{""}
	}
	output := []string{
		"diff --git a/dev/null b/" + relativePath,
		"new file mode 100644",
		"index 0000000..0000000",
		"--- /dev/null",
		"+++ b/" + relativePath,
		fmt.Sprintf("@@ -0,0 +1,%d @@", max(1, len(lines))),
	}
	for _, line := range lines {
		output = append(output, "+"+line)
	}
	return strings.Join(output, "\n")
}

func kindReason(kind string) string {
	if kind == "embedded-repo" {
		return "Diff is not available because the selected path is an embedded Git repository."
	}
	if kind == "directory" {
		return "Diff is not available because the selected path is a directory."
	}
	return "No text diff is available for this file."
}

func unavailable(reason string) Summary {
	return Summary{Available: false, Reason: reason, Changes: []Change{}}
}

func unavailableDiff(pathname, reason string) TextDiff {
	return TextDiff{Path: pathname, Status: "unavailable", BaseLabel: "HEAD", CompareLabel: "working tree", Content: "", Reason: reason}
}

const timeoutReason = "Git command timed out while reading this workspace."
const partialTimeoutReason = "Git untracked scan timed out; showing tracked changes only."
