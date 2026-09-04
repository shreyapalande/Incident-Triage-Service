const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  OPEN: { bg: "#eff6ff", text: "#1d4ed8", dot: "#3b82f6" },
  RESOLVED: { bg: "#f0fdf4", text: "#15803d", dot: "#22c55e" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.OPEN;
  return (
    <span className="badge" style={{ background: s.bg, color: s.text }}>
      <span className="badge-dot" style={{ background: s.dot }} />
      {status === "OPEN" ? "Open" : "Resolved"}
    </span>
  );
}
