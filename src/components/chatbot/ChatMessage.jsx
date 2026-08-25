import TestResultPanel from './TestResultPanel.jsx';

function LoadingMessage() {
  return (
    <div className="typing" role="status" aria-label="답변 생성 중">
      <span /><span /><span />
      <em>공식 자료를 확인하고 있어요</em>
    </div>
  );
}

function AssistantAnswer({ text, highlighted }) {
  const lines = text
    .replace(/[ \t]*[•●][ \t]*/gu, '\n• ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className={`message__text${highlighted ? ' message__text--answer' : ''}`}>
      {lines.map((line, index) => {
        const bullet = line.match(/^(?:[-*•]|\d+[.)])\s*(.+)$/u)?.[1];
        if (!bullet) return <p className="answer-line" key={`${index}-${line}`}>{line}</p>;
        return (
          <p className="answer-line answer-line--bullet" key={`${index}-${line}`}>
            <span aria-hidden="true">•</span>
            <span>{bullet}</span>
          </p>
        );
      })}
    </div>
  );
}

export default function ChatMessage({ message, onRetry }) {
  const isUser = message.role === 'user';
  const hasResults = message.response?.matchedTests?.length > 0;

  return (
    <article className={`message message--${message.role}`} data-testid={`message-${message.role}`}>
      {!isUser && <div className="message__avatar" aria-hidden="true">AI</div>}
      <div className="message__body">
        {message.status === 'loading' ? (
          <LoadingMessage />
        ) : isUser ? (
          <p className="message__text">{message.text}</p>
        ) : (
          <AssistantAnswer text={message.text} highlighted={hasResults} />
        )}

        {import.meta.env.DEV && message.status === 'success' && message.response?.retrievalPath && (
          <span className="retrieval-path" aria-label={`검색 경로 ${message.response.retrievalPath}`}>
            {message.response.retrievalPath}
          </span>
        )}

        {message.status === 'error' && (
          <button type="button" className="retry-button" onClick={() => onRetry(message)}>
            다시 시도
          </button>
        )}

        {hasResults && <TestResultPanel response={message.response} messageId={message.id} />}
      </div>
    </article>
  );
}
