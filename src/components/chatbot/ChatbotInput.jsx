import { useRef, useState } from 'react';

export default function ChatbotInput({ disabled, onSend }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  function submit() {
    const question = value.trim();
    if (!question || disabled) return;
    onSend(question);
    setValue('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="chatbot-input-wrap">
      <div className="chatbot-input">
        <label className="sr-only" htmlFor="chatbot-question">검사정보 질문</label>
        <textarea
          id="chatbot-question"
          ref={inputRef}
          rows="1"
          maxLength="1000"
          value={value}
          disabled={disabled}
          placeholder="검사명이나 검사코드를 입력해 주세요"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="send-button"
          disabled={disabled || !value.trim()}
          aria-label="질문 전송"
          onClick={submit}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 4 17 8-17 8 3-8-3-8Zm3.6 7h7.8L6.7 6.9 7.6 11Zm-.9 6.1 8.7-4.1H7.6l-.9 4.1Z" />
          </svg>
        </button>
      </div>
      <p className="input-hint">공개 검사정보 안내 · 의료적 진단용이 아닙니다.</p>
    </div>
  );
}
