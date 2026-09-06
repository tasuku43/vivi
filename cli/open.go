package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
)

const openHelp = `vivi open - open a document on an existing Vivi server

Usage:
  vivi open <url> [path] [--print]

path is relative to the selected server's workspace root, not the current directory.
Omit path to open the workspace. The server validates the target before opening.
--print returns only the validated browser URL without launching a browser.
This command never starts a server or changes another browser tab.
`

func runOpen(ctx context.Context, args []string, stdout io.Writer, launch func(string) error) error {
	if hasHelpFlag(args) {
		_, err := io.WriteString(stdout, openHelp)
		return err
	}
	flags := flag.NewFlagSet("vivi open", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	printOnly := flags.Bool("print", false, "print the validated browser URL")
	flagArgs, positional := splitTopLevelAgentFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		return err
	}
	if len(positional) < 1 || len(positional) > 2 {
		return errors.New("error: open requires <url> [path]")
	}
	base := strings.TrimRight(positional[0], "/")
	if err := validateTopLevelURL(base); err != nil {
		return err
	}
	target, _ := url.Parse(base)
	if target.User != nil || target.RawQuery != "" || target.ForceQuery || target.Fragment != "" || target.Path != "" {
		return errors.New("error: use the server base URL from vivi servers, without a path, credentials, query, or fragment")
	}
	options := inboxRequestOptions{URL: base}
	if len(positional) == 2 {
		filePath := positional[1]
		clean := path.Clean(filePath)
		if strings.TrimSpace(filePath) != filePath || filePath == "" || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || path.IsAbs(filePath) || strings.ContainsAny(filePath, "\\\x00\r\n") || strings.Contains(filePath, ":") {
			return errors.New("error: path must be a file relative to the selected server's workspace root")
		}
		var file *struct {
			Path string `json:"path"`
		}
		if err := postGraphQL(ctx, options, graphqlRequest{
			OperationName: "OpenDocument", Query: `query OpenDocument($path: String!) { file(path: $path) { path } }`, Variables: map[string]any{"path": clean},
		}, "file", &file); err != nil {
			return fmt.Errorf("open document: %w", err)
		}
		if file == nil || file.Path != clean {
			return errors.New("error: server did not confirm the requested document")
		}
		target.RawQuery = url.Values{"path": {clean}}.Encode()
	} else {
		var config *struct {
			Root string `json:"root"`
		}
		if err := postGraphQL(ctx, options, graphqlRequest{OperationName: "OpenWorkspace", Query: `query OpenWorkspace { config { root } }`}, "config", &config); err != nil {
			return fmt.Errorf("open workspace: %w", err)
		}
		if config == nil || config.Root == "" {
			return errors.New("error: server did not confirm a workspace")
		}
	}
	target.Path = "/"
	link := target.String()
	if _, err := fmt.Fprintln(stdout, link); err != nil {
		return err
	}
	if !*printOnly {
		if err := launch(link); err != nil {
			return fmt.Errorf("could not launch browser; open the URL printed above: %w", err)
		}
	}
	return nil
}
