package workspace

import "testing"

func TestPathExcluderMatchesWorkspaceGlobPatterns(t *testing.T) {
	excluder, err := NewPathExcluder([]string{
		"package-lock.json, snapshots/",
		"**/generated/**",
		"fixtures/*.snap",
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, relative := range []string{
		"package-lock.json",
		"packages/app/package-lock.json",
		"snapshots",
		"snapshots/home.png",
		"src/generated/client.go",
		"generated/schema.ts",
		"fixtures/home.snap",
	} {
		if !excluder.Matches(relative) {
			t.Errorf("expected %q to be excluded", relative)
		}
	}
	for _, relative := range []string{
		"package.json",
		"src/generator/client.go",
		"nested/fixtures/home.snap",
		"docs/snapshots.md",
	} {
		if excluder.Matches(relative) {
			t.Errorf("did not expect %q to be excluded", relative)
		}
	}
}

func TestPathExcluderRejectsInvalidPatterns(t *testing.T) {
	for _, pattern := range []string{"[broken", "../outside/**"} {
		if _, err := NewPathExcluder([]string{pattern}); err == nil {
			t.Errorf("expected %q to be rejected", pattern)
		}
	}
}
