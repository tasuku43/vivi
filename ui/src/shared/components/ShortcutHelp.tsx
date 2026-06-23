type ShortcutItem = readonly [label: string, shortcut: string];

const shortcutGroups: readonly {
  title: string;
  items: readonly ShortcutItem[];
}[] = [
  {
    title: "Find",
    items: [
      ["Command palette", "Cmd/Ctrl K"],
      ["Search text", "Cmd/Ctrl Shift F"],
      ["Next search match", "Cmd/Ctrl G"],
      ["Previous search match", "Cmd/Ctrl Shift G"],
      ["Show shortcuts", "Cmd/Ctrl /"],
    ],
  },
  {
    title: "Review",
    items: [
      ["Open next unseen item", "Cmd/Ctrl Shift U"],
      ["Next review item", "Cmd/Ctrl Shift J"],
      ["Previous review item", "Cmd/Ctrl Shift K"],
      ["Open Attention / Comments", "Cmd/Ctrl Shift C"],
      ["Return to current thread", "Cmd/Ctrl I"],
      ["Resolve / reopen current thread", "Cmd/Ctrl Shift Enter"],
      ["Archive current thread", "Cmd/Ctrl Shift Backspace"],
      ["Next open thread", "Cmd/Ctrl ]"],
      ["Previous open thread", "Cmd/Ctrl ["],
    ],
  },
  {
    title: "Viewer",
    items: [
      ["Toggle source/rendered", "Cmd/Ctrl E"],
      ["Toggle diff from HEAD", "Cmd/Ctrl D"],
      ["Close active tab", "Cmd/Ctrl W"],
    ],
  },
  {
    title: "Layout",
    items: [
      ["Toggle Explorer", "Cmd/Ctrl B"],
      ["Toggle inspector", "Cmd/Ctrl Shift \\"],
    ],
  },
  {
    title: "Tabs",
    items: [
      ["Move across open tabs", "Left / Right"],
      ["First open tab", "Home"],
      ["Last open tab", "End"],
    ],
  },
  {
    title: "Palette",
    items: [
      ["Preview result", "Enter"],
      ["Keep result open", "Cmd/Ctrl Enter"],
      ["Close overlay", "Esc"],
    ],
  },
];

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  if (!open) return null;

  return (
    <div className="shortcut-overlay" role="presentation" onClick={onClose}>
      <section
        className="shortcut-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        aria-labelledby="shortcut-help-title"
        aria-describedby="shortcut-help-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcut-panel-header">
          <div>
            <p>Keyboard</p>
            <h2 id="shortcut-help-title">Shortcuts</h2>
            <p className="sr-only" id="shortcut-help-description">
              A bundled reference for search, review, viewer, layout, tab, and
              palette keyboard shortcuts.
            </p>
          </div>
          <button
            type="button"
            className="shortcut-close"
            aria-label="Close keyboard shortcuts"
            title="Close keyboard shortcuts"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        {shortcutGroups.map((group) => (
          <ShortcutGroup
            items={group.items}
            key={group.title}
            title={group.title}
          />
        ))}
      </section>
    </div>
  );
}

function ShortcutGroup({
  title,
  items,
}: {
  title: string;
  items: readonly ShortcutItem[];
}) {
  const titleId = `shortcut-group-${title.toLowerCase()}`;

  return (
    <section className="shortcut-group" aria-labelledby={titleId}>
      <h3 id={titleId}>{title}</h3>
      <dl className="shortcut-list">
        {items.map(([label, shortcut]) => (
          <div className="shortcut-row" key={label}>
            <dt>{label}</dt>
            <dd>
              <kbd aria-label={shortcutA11yLabel(shortcut)}>{shortcut}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function shortcutA11yLabel(shortcut: string) {
  if (shortcut === "Left / Right") return "Left or Right arrow";

  return [
    ["Cmd/Ctrl", "Command or Control"],
    ["\\", "Backslash"],
    ["/", "Slash"],
    ["[", "Left bracket"],
    ["]", "Right bracket"],
    ["Esc", "Escape"],
  ].reduce((label, [from, to]) => label.split(from).join(to), shortcut);
}
