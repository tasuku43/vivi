export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      data-folder-icon
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6V4h6l2 2h8v11H2Z" />
    </svg>
  );
}
