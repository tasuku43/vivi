import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";

const meta = {
  title: "Design Review/Workflow",
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const stages = [
  {
    label: "1. HTML Concept Mock",
    purpose: "Explore the product direction before React implementation.",
    artifact: "docs/ui-mocks/NN-*.html",
    review:
      "layout, density, information hierarchy, state visibility, and whether the direction feels like Vivi",
    gate: "User chooses, combines, or revises the concept.",
  },
  {
    label: "2. Storybook Facade",
    purpose:
      "Approve the visual contract with React components before wiring real behavior.",
    artifact: "ui/src/**/*.stories.tsx",
    review:
      "props-driven states, static fixture data, simplified callbacks, responsive shape, and open/closed UI gestures",
    gate: "User approves the facade story as the implementation target.",
  },
  {
    label: "3. Wired Feature",
    purpose:
      "Connect the approved facade to application use cases, infrastructure, and server behavior.",
    artifact: "feature code, tests, integrated stories, and E2E coverage",
    review:
      "real state transitions, data loading, stale updates, safety boundaries, and regression coverage",
    gate: "task check passes and the shipped behavior matches the approved facade.",
  },
];

const surfaceExamples = [
  "Workspace shell",
  "Review navigation",
  "Comment lifecycle",
  "Viewer coverage",
  "Diff review",
  "Navigation overlays",
  "Stress and empty states",
];

export const ThreeStageReviewPath: Story = {
  name: "HTML concept to facade to wired feature",
  render: () => (
    <main style={styles.shell} aria-labelledby="design-review-flow-title">
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Vivi Storybook Lab</p>
          <h1 id="design-review-flow-title" style={styles.title}>
            Three-stage GUI review path
          </h1>
          <p style={styles.lede}>
            Meaningful GUI changes move from an HTML concept, to a Storybook
            facade, to wired implementation. Storybook is the design approval
            surface before real app behavior is connected.
          </p>
        </div>
        <div style={styles.statusPanel} aria-label="Current review contract">
          <strong style={styles.statusValue}>Facade first</strong>
          <span style={styles.statusText}>
            Static props and fixtures are valid until the visual contract is
            approved.
          </span>
        </div>
      </section>

      <section style={styles.timeline} aria-label="Review stages">
        {stages.map((stage) => (
          <article key={stage.label} style={styles.stageCard}>
            <div style={styles.stageHeader}>
              <h2 style={styles.stageTitle}>{stage.label}</h2>
              <code style={styles.artifact}>{stage.artifact}</code>
            </div>
            <p style={styles.purpose}>{stage.purpose}</p>
            <dl style={styles.definitionList}>
              <div>
                <dt>Review focus</dt>
                <dd>{stage.review}</dd>
              </div>
              <div>
                <dt>Exit gate</dt>
                <dd>{stage.gate}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section style={styles.rulesGrid} aria-label="Storybook facade rules">
        <article style={styles.rulePanel}>
          <h2 style={styles.ruleTitle}>Facade stories may</h2>
          <ul style={styles.list}>
            <li>use static props and simplified callbacks</li>
            <li>reuse domain-shaped fixtures</li>
            <li>show empty, dense, loading, error, selected, and stale states</li>
            <li>include lightweight play interactions for visible UI gestures</li>
          </ul>
        </article>
        <article style={styles.rulePanel}>
          <h2 style={styles.ruleTitle}>Facade stories should not</h2>
          <ul style={styles.list}>
            <li>mock filesystem watchers</li>
            <li>mock HTTP routes, GraphQL transport, or SSE</li>
            <li>pretend the HTML preview server is running</li>
            <li>replace use-case, adapter, or E2E tests for real behavior</li>
          </ul>
        </article>
        <article style={styles.rulePanel}>
          <h2 style={styles.ruleTitle}>Manifest review surfaces</h2>
          <div style={styles.tagList}>
            {surfaceExamples.map((surface) => (
              <span key={surface} style={styles.tag}>
                {surface}
              </span>
            ))}
          </div>
        </article>
      </section>
    </main>
  ),
};

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100vh",
    background: "#f5f7f8",
    color: "#1e2329",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: 32,
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 280px",
    gap: 24,
    alignItems: "end",
    maxWidth: 1120,
    margin: "0 auto 28px",
  },
  eyebrow: {
    margin: "0 0 12px",
    color: "#5f6b75",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: 36,
    lineHeight: 1.08,
    letterSpacing: 0,
  },
  lede: {
    maxWidth: 720,
    margin: "14px 0 0",
    color: "#4b535c",
    fontSize: 16,
    lineHeight: 1.6,
  },
  statusPanel: {
    border: "1px solid #d8d0c4",
    background: "#f7fbfa",
    borderRadius: 8,
    padding: 18,
    boxShadow: "0 1px 0 rgba(30, 35, 41, 0.06)",
  },
  statusValue: {
    display: "block",
    fontSize: 18,
    marginBottom: 8,
  },
  statusText: {
    display: "block",
    color: "#5b626b",
    fontSize: 13,
    lineHeight: 1.45,
  },
  timeline: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto 20px",
  },
  stageCard: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    minHeight: 300,
    border: "1px solid #d9d2c8",
    background: "#ffffff",
    borderRadius: 8,
    padding: 20,
  },
  stageHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  stageTitle: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.25,
    letterSpacing: 0,
  },
  artifact: {
    display: "inline-block",
    alignSelf: "flex-start",
    maxWidth: "100%",
    border: "1px solid #d7dde2",
    background: "#eaf4f2",
    borderRadius: 6,
    padding: "5px 7px",
    color: "#273947",
    fontSize: 12,
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  purpose: {
    margin: 0,
    color: "#37414a",
    fontSize: 14,
    lineHeight: 1.55,
  },
  definitionList: {
    display: "grid",
    gap: 12,
    margin: "auto 0 0",
  },
  rulesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto",
  },
  rulePanel: {
    border: "1px solid #d9d2c8",
    background: "#ffffff",
    borderRadius: 8,
    padding: 18,
  },
  ruleTitle: {
    margin: "0 0 12px",
    fontSize: 15,
    letterSpacing: 0,
  },
  list: {
    display: "grid",
    gap: 8,
    margin: 0,
    paddingLeft: 20,
    color: "#4b535c",
    fontSize: 13,
    lineHeight: 1.45,
  },
  tagList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    border: "1px solid #d8d0c4",
    background: "#eef5f4",
    borderRadius: 6,
    padding: "6px 8px",
    color: "#3e454d",
    fontSize: 12,
  },
};
