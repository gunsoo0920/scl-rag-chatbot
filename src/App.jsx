import { useState } from 'react';
import Chatbot from './components/chatbot/Chatbot.jsx';

export default function App() {
  const [isChatbotOpen, setIsChatbotOpen] = useState(true);

  return (
    <main className="app-shell">
      <section className="intro" aria-labelledby="page-title">
        <p className="intro__eyebrow">SCL PUBLIC TEST INFORMATION</p>
        <h1 id="page-title">검사정보를 더 빠르고 쉽게</h1>
        <p className="intro__description">
          검사명이나 검사코드로 질문하면 SCL 공개 자료에서 관련 정보를 찾아 안내합니다.
        </p>
      </section>

      <aside className="chatbot-dock" aria-label="검사정보 챗봇 위젯" hidden={!isChatbotOpen}>
        <Chatbot onClose={() => setIsChatbotOpen(false)} />
      </aside>

      <button
        type="button"
        className="chatbot-launcher"
        aria-label="검사정보 챗봇 열기"
        hidden={isChatbotOpen}
        onClick={() => setIsChatbotOpen(true)}
      >
        <span aria-hidden="true">SCL</span>
        <strong>검사정보 문의</strong>
      </button>
    </main>
  );
}
