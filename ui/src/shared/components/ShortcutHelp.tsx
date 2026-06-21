const globalShortcuts = [
  ["Quick open", "Cmd K"],
  ["Search text", "Cmd Shift F"],
  ["Toggle diff from HEAD", "Cmd D"],
  ["Open next unread review item", "Cmd Shift U"],
  ["Next review item", "Cmd Shift J"],
  ["Previous review item", "Cmd Shift K"],
  ["Close active tab", "Cmd W"],
  ["Show shortcuts", "Cmd /"],
];

const paletteShortcuts = [
  ["Preview result", "Enter"],
  ["Keep result open", "Cmd Enter"],
  ["Close overlay", "Esc"],
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
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcut-panel-header">
          <div>
            <p>Keyboard</p>
            <h2>Shortcuts</h2>
          </div>
          <button type="button" className="shortcut-close" onClick={onClose}>
            Close
          </button>
        </header>
        <ShortcutGroup title="Workspace" items={globalShortcuts} />
        <ShortcutGroup title="Command palette" items={paletteShortcuts} />
      </section>
    </div>
  );
}

function ShortcutGroup({ title, items }: { title: string; items: string[][] }) {
  return (
    <section className="shortcut-group">
      <h3>{title}</h3>
      <div className="shortcut-list">
        {items.map(([label, shortcut]) => (
          <div className="shortcut-row" key={label}>
            <span>{label}</span>
            <kbd>{shortcut}</kbd>
          </div>
        ))}
      </div>
    </section>
  );
}
