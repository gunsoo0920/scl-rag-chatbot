import { useState } from 'react';

export default function RelatedResource({ resource }) {
  const [imageFailed, setImageFailed] = useState(false);
  const isImage = resource.type === 'image';

  return (
    <a className="resource-card" href={resource.url} target="_blank" rel="noreferrer">
      {isImage && !imageFailed ? (
        <img
          src={resource.url}
          alt={resource.title}
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={`resource-card__fallback resource-card__fallback--${resource.type}`} aria-hidden="true">
          {resource.type === 'pdf' ? 'PDF' : 'IMG'}
        </span>
      )}
      <span className="resource-card__copy">
        <small>{resource.type === 'pdf' ? '관련 PDF' : '검체용기 이미지'}</small>
        <strong>{resource.title}</strong>
      </span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}
