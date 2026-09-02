const COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#ca8a04",
  LOW: "#16a34a",
  UNKNOWN: "#6b7280",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const color = COLORS[severity] ?? COLORS.UNKNOWN;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: "#fff",
        background: color,
      }}
    >
      {severity}
    </span>
  );
}
