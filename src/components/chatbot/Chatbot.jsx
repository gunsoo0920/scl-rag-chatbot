import { useEffect, useRef, useState } from 'react';
import { ChatbotApiError, getChatbotHealth, interpretQuestion } from '../../services/chatbotApi.js';
import ChatbotHeader from './ChatbotHeader.jsx';
import ChatbotInput from './ChatbotInput.jsx';
import ChatMessage from './ChatMessage.jsx';

const EXAMPLE_QUESTIONS = [
  'ALT 검사는 어떤 검체를 사용하나요?',
  'ALT 검사 결과는 며칠 걸려?',
  '10130 검사 정보 알려줘',
];

const INITIAL_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  status: 'success',
  text: '안녕하세요. 찾고 싶은 검사명이나 검사코드를 입력해 주세요. 검사방법, 검체, 검사일과 소요일을 공식 자료에서 확인해 드릴게요.',
};

function messageId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function friendlyError(error) {
  if (error instanceof ChatbotApiError && error.code === 'GENERATION_UNAVAILABLE') {
    return '현재 AI 답변 기능이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (error instanceof ChatbotApiError) return error.message;
  return '예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

export default function Chatbot({ onClose }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const activeRequest = useRef(null);
  const conversationRef = useRef(null);
  const messagesRef = useRef(null);
  const shouldAutoScroll = useRef(true);
  const isLoading = messages.some((message) => message.status === 'loading');

  useEffect(() => {
    shouldAutoScroll.current = true;
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: messages.length > 2 ? 'smooth' : 'auto',
    });
  }, [messages]);

  useEffect(() => {
    const conversation = conversationRef.current;
    const messageList = messagesRef.current;
    if (!conversation || !messageList || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      if (shouldAutoScroll.current) conversation.scrollTop = conversation.scrollHeight;
    });
    observer.observe(messageList);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => activeRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    getChatbotHealth({ signal: controller.signal })
      .then((health) => setConnectionStatus(health.status === 'ok' ? 'ready' : 'degraded'))
      .catch((error) => {
        if (error.name !== 'AbortError') setConnectionStatus('offline');
      });
    return () => controller.abort();
  }, []);

  async function requestAnswer(question, assistantMessageId) {
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const response = await interpretQuestion(question, { signal: controller.signal });
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? { ...message, status: 'success', text: response.answer, response }
          : message
      )));
    } catch (error) {
      if (error.name === 'AbortError') return;
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? { ...message, status: 'error', text: friendlyError(error), question }
          : message
      )));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  function handleSend(question) {
    if (isLoading) return;
    const assistantMessageId = messageId();
    setMessages((current) => [
      ...current,
      { id: messageId(), role: 'user', status: 'success', text: question },
      { id: assistantMessageId, role: 'assistant', status: 'loading', text: '', question },
    ]);
    requestAnswer(question, assistantMessageId);
  }

  function handleRetry(message) {
    if (isLoading || !message.question) return;
    setMessages((current) => current.map((item) => (
      item.id === message.id ? { ...item, status: 'loading', text: '' } : item
    )));
    requestAnswer(message.question, message.id);
  }

  function handleConversationScroll() {
    const conversation = conversationRef.current;
    if (!conversation) return;
    const distanceFromBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 80;
  }

  return (
    <section className="chatbot" aria-label="SCL 검사정보 챗봇">
      <ChatbotHeader connectionStatus={connectionStatus} onClose={onClose} />
      <div
        ref={conversationRef}
        className="chatbot__conversation"
        aria-live="polite"
        aria-busy={isLoading}
        onScroll={handleConversationScroll}
      >
        <div ref={messagesRef} className="chatbot__messages">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} onRetry={handleRetry} />
          ))}

          {messages.length === 1 && (
            <div className="suggestions" aria-label="질문 예시">
              <p>이렇게 질문해 보세요</p>
              <div>
                {EXAMPLE_QUESTIONS.map((question) => (
                  <button type="button" key={question} disabled={isLoading} onClick={() => handleSend(question)}>
                    <span>{question}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m9 18 6-6-6-6 1.4-1.4 7.4 7.4-7.4 7.4L9 18Z" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <ChatbotInput disabled={isLoading} onSend={handleSend} />
    </section>
  );
}
