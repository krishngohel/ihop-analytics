const TONE_CLASS = { ok: "tone-ok", watch: "tone-watch", attention: "tone-attention" };

export default function StatusBadge({ tone = "ok", children }) {
  return <span className={`status-badge ${TONE_CLASS[tone] || TONE_CLASS.ok}`}>{children}</span>;
}
