const SEVERITY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  CRITICAL: { bg: "#fee2e2", text: "#b91c1c", dot: "#dc2626" },
  HIGH: { bg: "#ffedd5", text: "#c2410c", dot: "#ea580c" },
  MEDIUM: { bg: "#fef9c3", text: "#a16207", dot: "#ca8a04" },
  LOW: { bg: "#dcfce7", text: "#15803d", dot: "#16a34a" },
  UNKNOWN: { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8" },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.UNKNOWN;
  return (
    <span className="badge" style={{ background: s.bg, color: s.text }}>
      <span className="badge-dot" style={{ background: s.dot }} />
      {severity}
    </span>
  );
}
