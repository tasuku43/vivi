import { useEffect, useState } from "react";
import styles from "./ReaderGuidance.module.css";

export function ReaderWelcome({ onFind }: { onFind: () => void }) {
  return (
    <section className={styles.welcome} aria-label="Start reading">
      <small>YOUR LOCAL REVIEW SPACE</small>
      <h1>
        Open a document.
        <br />
        Make your next thought precise.
      </h1>
      <p>Choose Markdown or HTML from the tree.</p>
      <button type="button" onClick={onFind}>
        Find a document
      </button>
      <ol>
        <li>Read the document as it was written.</li>
        <li>Double-click a block to leave feedback.</li>
        <li>Save a draft, then publish for your agent.</li>
      </ol>
      <small>Local workspace · files stay read-only</small>
    </section>
  );
}
export function ReadingHint() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem("vivi.readingHintSeen.v1") !== "true";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("vivi.readingHintSeen.v1", "true");
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  if (!visible) return null;
  return (
    <div className={styles.hint} role="note">
      <span>
        Double-click a block to leave feedback. Save a draft, then publish for
        your agent.
      </span>
      <button
        type="button"
        aria-label="Dismiss reading tip"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  );
}
