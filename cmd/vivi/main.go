package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/tasuku43/vivi/internal/comments"
	"github.com/tasuku43/vivi/internal/gitreview"
	"github.com/tasuku43/vivi/internal/server"
	"github.com/tasuku43/vivi/internal/workspace"
)

var version = "0.0.0"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("vivi", flag.ContinueOnError)
	flags.SetOutput(os.Stdout)
	host := flags.String("host", "127.0.0.1", "host to bind")
	port := flags.Int("port", 4317, "port to bind")
	open := flags.Bool("open", false, "open browser after startup")
	include := flags.String("include", "", "comma-separated extension allow-list")
	maxFileSize := flags.Int64("max-file-size", 1024*1024, "rich preview byte limit")
	allowHTMLScripts := flags.Bool("allow-html-scripts", false, "allow scripts in HTML preview for trusted files")
	noHTMLScripts := flags.Bool("no-html-scripts", false, "keep HTML preview scripts disabled")
	gitTimeout := flags.Duration("git-review-timeout", 2*time.Second, "Git review timeout")
	logLevel := flags.String("log-level", "info", "log level")
	showVersion := flags.Bool("version", false, "print version")
	flags.Usage = func() { fmt.Fprintln(flags.Output(), helpText()) }
	flagArgs, positional := splitFlagsAndPositionals(args)
	if err := flags.Parse(flagArgs); err != nil {
		if err == flag.ErrHelp {
			return nil
		}
		return err
	}
	if *showVersion {
		fmt.Println(version)
		return nil
	}
	_ = logLevel
	if *noHTMLScripts {
		*allowHTMLScripts = false
	}
	root := "."
	if len(positional) > 0 {
		root = positional[0]
	}
	workspaceFS, err := workspace.New(workspace.Options{
		Root:             root,
		Include:          parseInclude(*include),
		MaxFileSizeBytes: *maxFileSize,
		AllowHTMLScripts: *allowHTMLScripts,
	})
	if err != nil {
		return err
	}
	reviewer, err := gitreview.New(workspaceFS.Config().Root, *gitTimeout)
	if err != nil {
		return err
	}
	commentStore, err := comments.NewStore("")
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	httpServer, err := server.Start(ctx, server.Options{
		Host:             *host,
		Port:             *port,
		Workspace:        workspaceFS,
		Git:              reviewer,
		Comments:         commentStore,
		AllowHTMLScripts: *allowHTMLScripts,
	})
	if err != nil {
		return err
	}
	fmt.Printf("Vivi serving %s\n", workspaceFS.Config().Root)
	fmt.Println(httpServer.URL())
	if *open {
		_ = openBrowser(httpServer.URL())
	}
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return httpServer.Close(shutdownCtx)
}

func helpText() string {
	return strings.Join([]string{
		"vivi - read-only visual workspace viewer",
		"",
		"Usage:",
		"  vivi [root] [--host 127.0.0.1] [--port 4317] [--open] [--include md,html,ts] [--max-file-size 1048576] [--allow-html-scripts]",
		"",
		"Options:",
		"  --host <host>              Host to bind (default: 127.0.0.1)",
		"  --port <port>              Port to bind (default: 4317, 0 for random)",
		"  --open                     Open the browser after startup",
		"  --include <extensions>     Comma-separated extension allow-list",
		"  --max-file-size <bytes>    Rich preview byte limit",
		"  --allow-html-scripts       Allow scripts in HTML preview for trusted files",
		"  --no-html-scripts          Keep HTML preview scripts disabled",
		"  --git-review-timeout <d>   Git review timeout such as 2s or 500ms",
		"  --log-level <level>        Log level (default: info)",
		"  --version                  Print version",
		"  --help                     Show this help",
	}, "\n")
}

func splitFlagsAndPositionals(args []string) ([]string, []string) {
	flagArgs := []string{}
	positionals := []string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positionals = append(positionals, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			positionals = append(positionals, arg)
			continue
		}
		flagArgs = append(flagArgs, arg)
		if flagRequiresValue(arg) && !strings.Contains(arg, "=") && i+1 < len(args) {
			i++
			flagArgs = append(flagArgs, args[i])
		}
	}
	return flagArgs, positionals
}

func flagRequiresValue(arg string) bool {
	name := strings.TrimLeft(arg, "-")
	if before, _, ok := strings.Cut(name, "="); ok {
		name = before
	}
	switch name {
	case "host", "port", "include", "max-file-size", "git-review-timeout", "log-level":
		return true
	default:
		return false
	}
}

func parseInclude(value string) []string {
	parts := []string{}
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimPrefix(strings.TrimSpace(item), ".")
		if item != "" {
			parts = append(parts, item)
		}
	}
	return parts
}

func openBrowser(rawURL string) error {
	if _, err := url.Parse(rawURL); err != nil {
		return err
	}
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
		args = []string{rawURL}
	case "windows":
		command = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", rawURL}
	default:
		command = "xdg-open"
		args = []string{rawURL}
	}
	cmd := exec.Command(command, args...)
	return cmd.Start()
}

func init() {
	flag.CommandLine.Usage = func() {
		fmt.Fprintln(os.Stdout, helpText())
	}
}
