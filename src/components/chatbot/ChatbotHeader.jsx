const STATUS_COPY = {
  checking: '서버 연결 확인 중',
  ready: '공식 공개정보 기반 안내',
  degraded: 'AI 답변 기능 준비 중',
  offline: '챗봇 서버 연결 안 됨',
};

export default function ChatbotHeader({ connectionStatus = 'checking', onClose }) {
  return (
    <header className="chatbot-header">
      <div className="chatbot-header__brand" aria-hidden="true">SCL</div>
      <div className="chatbot-header__copy">
        <h2>SCL 검사정보 AI 도우미</h2>
        <p role="status">
          <span className={`status-dot status-dot--${connectionStatus}`} />
          {STATUS_COPY[connectionStatus]}
        </p>
      </div>
      <button type="button" className="chatbot-header__close" aria-label="챗봇 닫기" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 11h14v2H5z" />
        </svg>
      </button>
    </header>
  );
}
