export default function SourceCard({ source }) {
  return (
    <a className="source-card" href={source.url} target="_blank" rel="noreferrer">
      <span className="source-card__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z" /></svg>
      </span>
      <span>
        <small>SCL 공식 원문</small>
        <strong>{source.title}</strong>
      </span>
      <span className="source-card__arrow" aria-hidden="true">→</span>
    </a>
  );
}
