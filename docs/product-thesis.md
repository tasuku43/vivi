# Vivi Product Thesis

## A local review adapter for humans and coding agents

Vivi is a local review adapter between humans and coding agents.

Humans need a low-friction browser interface for reading local artifacts. Coding agents need a precise command-line interface for receiving human feedback, replying to it, and closing the loop. Vivi sits between those two interfaces.

Vivi is not only a file viewer, a diff viewer, or a comment tool. It is a bridge that turns human review context into agent-readable work.

## Core thesis

Coding agents write. Humans read, judge, and redirect. The best interface for those two sides is not the same.

For humans, the right interface is a browser-based local review surface. It should make generated work easy to inspect across Markdown, HTML, source code, images, structured files, rendered views, and diffs. The UI should reduce cognitive load, preserve workspace context, and make feedback feel natural at the point where the human notices the issue.

For coding agents, the right interface is a command-line contract. Agents do not need a beautiful visual interface. They need clear, structured, current feedback: what is open, where it is anchored, what the human said, what needs a reply, and what can be resolved.

The feedback layer between those interfaces is the product's core. Today that layer is comment threads. Over time it may grow into a richer feedback protocol, but the job stays the same: convert human review context into actionable agent input.

## The three-interface model

Vivi should be designed as three connected interfaces, not as one generic app.

### 1. Human browser interface

The browser UI is for reading.

It should help the human understand the workspace with as little friction as possible. The file tree, tabs, rendered Markdown, safe HTML preview, source viewer, image viewer, structured file viewers, outlines, diffs, and review queue all serve this purpose.

The human should be able to review generated artifacts directly, not only their source diffs. A report should be readable as a report. An HTML file should be visible as a page. Markdown should be readable as a document. Images and screenshots should be visible as artifacts, not reduced to filenames.

The browser interface is successful when the human can quickly answer:

- What changed?
- What was generated?
- What needs attention?
- What do I want the agent to do next?

### 2. Feedback layer

The feedback layer is for handoff.

A comment is not just a note. In Vivi, a comment is a piece of human review context attached to a workspace artifact. It should preserve enough context for both sides to understand what was meant.

Useful feedback should capture:

- the target file or artifact,
- the surface where the issue was seen, such as rendered Markdown, HTML preview, source, or diff,
- the position or range when available,
- the human's message,
- the thread state,
- the activity history,
- whether the agent has read, replied to, resolved, or archived it.

The visible UX should still feel simple. Humans should not be forced to fill out a task form when they only want to say what looks wrong. The structure should exist to help the agent, not to burden the human.

### 3. Agent CLI interface

The CLI is for acting.

Coding agents should be able to ask Vivi for the next relevant feedback without scraping the UI or relying on copied prompts. The CLI should expose a small, stable contract for reading active threads, replying, and closing the loop.

The agent-side interface should optimize for:

- discovering open work,
- reading feedback with enough file and view context,
- recording read activity without creating noisy human work,
- replying into the same thread,
- resolving or archiving completed feedback,
- staying deterministic enough to test without a real model.

The CLI should not become a second human UI. It should be shaped around the needs of coding agents and automation.

## Product boundary

Vivi should not try to become the coding agent, the IDE, the task manager, or the hosted collaboration system.

The strongest version of Vivi stays local-first and review-focused:

- It does not need to edit files.
- It does not need to run the agent.
- It does not need to own project management.
- It does not need to replace GitHub Pull Request review.
- It does not need built-in LLM features to be useful.

Vivi's job is narrower and more durable: make human review legible to agents, while making agent-written local work easy for humans to inspect.

## Positioning against adjacent tools

Vivi should avoid competing as a generic diff viewer.

Tools like difit are strong local diff review tools for the AI era. They make code diffs readable and can turn comments into AI-ready prompts. Vivi can learn from that, but Vivi should not define itself primarily as a better diff viewer.

Vivi should also avoid competing as an agent workbench.

Tools like Vibe Kanban focus on orchestrating agents, tasks, branches, terminals, previews, and Pull Requests. Vivi can integrate with agent workflows, but its center should remain the review adapter between the human and the agent.

Vivi's distinct position is local artifact review with an agent-readable feedback loop:

- broader than a diff viewer,
- lighter than an IDE,
- more structured than copying prompts,
- more local and pre-PR than GitHub review,
- more focused than an agent orchestration tool.

## Design principles

### Optimize each side for its real user

Humans and agents should not be forced through the same interface.

Humans get the browser because visual reading, spatial context, rendered artifacts, and direct annotation reduce cognitive load. Agents get the CLI because structured text, stable identifiers, and explicit state transitions reduce ambiguity.

### Keep feedback anchored to what the human saw

A thread should not drift into a generic chat message. Its value comes from the artifact context: file, view surface, range, rendered location, diff side, or snapshot. The more precisely Vivi preserves what the human saw, the more useful the feedback becomes for the agent.

### Make comments feel simple, but store them as work

The human experience should feel like commenting. The agent experience should feel like receiving actionable review work. Vivi should hide unnecessary structure from the human while preserving it for automation.

### Prefer state over chat sprawl

Open, read, replied, resolved, and archived states matter. A long unstructured conversation is harder for both humans and agents to process. Vivi should support conversation, but the product should make the lifecycle of feedback clear.

### Stay local-first by default

Vivi's trust comes from local operation, read-only workspace behavior, and clear boundaries. The browser UI and CLI should assume local use first. Remote access, hosting, and external model features should not define the product's core.

## Near-term UX focus

The current product should focus on making comment threads excellent before adding broader workflow abstractions.

The most important near-term UX questions are:

- Can a human leave feedback exactly where they noticed the issue?
- Can the comment preserve the view context that made the issue clear?
- Can an agent fetch only the feedback it needs to act on?
- Can the agent reply in a way the human can review without losing context?
- Can both sides see whether the feedback loop is still open or complete?

If those questions are answered well, Vivi becomes more than a viewer. It becomes the local review adapter for agent-written workspaces.

## Working statement

Vivi gives humans a beautiful local review surface and gives coding agents a CLI-readable feedback queue. The glue is context-rich feedback attached to the artifacts the human reviewed.

In short:

> Vivi is a local review adapter between humans and coding agents.
