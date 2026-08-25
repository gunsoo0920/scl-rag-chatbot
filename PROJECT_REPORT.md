# SCL 공개 검사정보 기반 RAG 챗봇 개발 보고서

## 문서 정보

| 항목 | 내용 |
|---|---|
| 프로젝트 | SCL 검사정보 RAG 챗봇 |
| 작성 기준일 | 2026-08-25 |
| 기준 브랜치 | refactor/qdrant-deterministic-rag |
| 배포 환경 | Vercel Preview |
| 데이터베이스 | Qdrant Cloud Free Tier |
| 데이터 규모 | 3,327 points |
| 벡터 규격 | Gemini Embedding 768차원, Cosine |

## 1. 프로젝트 요약

SCL 공식 홈페이지에 공개된 검사정보를 수집·정규화하고, 사용자가 검사코드·검사명·검체·검사방법·검사일·소요일 등을 자연어로 확인할 수 있도록 만든 안내 챗봇이다.

이번 개편에서는 기존 파일 기반 검색 구조를 Qdrant 기반 런타임 검색 구조로 전환하고, 정확한 사실 조회와 비교는 프로그램이 직접 처리하도록 변경했다. 자연어 의미 검색이 필요한 경우에만 Gemini Embedding을 호출하고, 여러 근거를 자연스럽게 설명해야 하는 경우에만 Gemini 생성 모델을 사용한다.

현재 React/Vite UI와 Node API는 Vercel Preview에 배포돼 있으며, Qdrant Cloud의 scl_tests 컬렉션과 연결되어 있다.

## 2. 핵심 설계 원칙

DB에 있는 사실은 DB가 답하고, 비교 가능한 사실은 프로그램이 계산하며, 자연어 검색이 필요할 때만 Vector Search를 사용하고, 자연스러운 설명이 필요한 경우에만 LLM을 사용한다.

이 원칙으로 다음 효과를 목표로 했다.

- 검사코드와 필드 질문의 응답 일관성 향상
- 불필요한 Gemini 호출과 무료 사용량 소비 감소
- 공식 SCL 출처에 근거하지 않은 답변 방지
- 검색 경로와 답변 정책을 분리하여 테스트 가능성 향상
- 변경된 검사만 재임베딩하는 증분 동기화

## 3. 현재 시스템 구조

사용자 → Vercel Authentication → React/Vite UI → Vercel Node Functions → Safety Gate → Query Analyzer → Retrieval Router → Qdrant Cloud/Gemini → Intent-aware Answer Service → Grounding Validator → 응답

세부 구성은 architecture.md, 사용자 및 동기화 프로세스는 bpmn.md를 참고한다.

## 4. 주요 구현 내용

### 4.1 프론트엔드

- React/Vite 기반 기존 UI 유지
- 질문 loading, 오류, 재시도 처리
- 답변과 함께 검사정보 카드, 공식 출처, 이미지/PDF 표시
- /api/health로 서버와 데이터 연결 상태 확인
- 브라우저 번들에는 Gemini/Qdrant 키를 포함하지 않음

### 4.2 API와 배포

- GET /api/health
- GET /api/stats
- POST /api/chatbot/interpret
- Vercel의 api/* Node Functions를 기존 HTTP handler에 연결
- JSON Content-Type, 32KB 본문, 질문 1,000자 제한
- 요청별 UUID와 안전한 4xx/5xx 오류 응답
- same-origin Preview 요청을 forwarded host/protocol 기준으로 허용

### 4.3 질문 분석

LLM 호출 없이 다음 정보를 추출한다.

- Entity: 검사코드, 복수 코드, 정규화된 검사명 후보
- Intent: FIELD_LOOKUP, COMPARISON, SEARCH, EXPLANATION, RESOURCE_REQUEST, UNKNOWN
- Field: 검사코드, 검사명, 검체, 검사방법, 보험코드, 검사일, 검사 구분, 소요일, 출처, 이미지/PDF

### 4.4 검색과 답변 경로

| 경로 | 처리 |
|---|---|
| Exact | 검사코드 또는 정확한 검사명을 Qdrant payload index로 조회 |
| Structured | 검체·방법·소요일 등 저장된 필드값을 직접 조립 |
| Comparison | 두 검사의 소요일 범위를 프로그램이 보수적으로 비교 |
| Vector | 질문을 임베딩하고 Qdrant cosine 유사도로 top-K 검색 |
| Explanation | 검색된 SCL 근거만 Gemini에 전달하고 출력 검증 |
| Blocked/No Result | 의료 안전 또는 검색 실패에 대한 고정 안내 |

필드, 비교, 자료, 일반 검색 결과는 생성 모델 없이 결정적으로 조립한다. EXPLANATION 질문만 생성 모델을 사용한다.

### 4.5 의료 안전

- 개인 검사결과 해석, 진단, 치료, 약물, 맞춤형 검사 추천을 retrieval 전에 차단
- 생성 프롬프트에 검색된 SCL 근거와 허용 source ID만 전달
- 생성 결과의 source ID, 원문 evidence, 공식 HTTPS URL과 의료 안전 표현 검증
- 답변 본문에는 임의 URL을 넣지 않고 서버가 검증한 출처만 별도 필드로 제공

## 5. Qdrant 데이터 구조

- Collection: scl_tests
- Points: 3,327
- Vector: 768차원, Cosine
- Runtime filter: active=true
- Payload index: id, testCode, sampleCode, normalizedTestName, contentHash, active
- 주요 payload: 검사코드, 검체코드, 검사명, 검체, 방법, 보험코드, 검사일, 소요일, 공식 URL, 이미지/PDF, contentHash, payloadHash

기존 로컬 vector index는 런타임에서 사용하지 않는다. 최초 Qdrant migration에서 동일 문서 ID의 기존 vector를 재사용하는 용도로만 보존한다.

## 6. 데이터 수집과 증분 동기화

SCL → 목록/상세 crawler → Raw snapshot → Knowledge JSON → validation → Qdrant sync

동기화 규칙은 다음과 같다.

- 신규 문서: 기존 vector가 있으면 재사용하고, 없으면 embedding 후 upsert
- contentHash 변경: 해당 문서만 재embedding
- URL/자료 등 payloadHash만 변경: vector를 유지하고 payload만 갱신
- 변경 없음: embedding과 update 생략
- 새 snapshot에서 사라진 항목: 즉시 삭제하지 않고 active=false
- 수집 실패가 있거나 새 snapshot이 기존 active 데이터의 80% 미만이면 비활성화 생략

런타임은 요청마다 Qdrant를 조회하므로 동기화 후 Vercel 재배포는 필요하지 않다.

## 7. 환경변수와 보안

실제 키는 Git에 포함하지 않는다.

- 로컬: Git에서 제외된 .env
- 배포: Vercel Preview Environment Variables
- 저장소: 값이 비어 있거나 예시값만 포함된 .env.example

필수 변수는 GEMINI_API_KEY, GEMINI_MODEL, GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_DIMENSION, QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION이다.

API 키가 스크린샷, 로그 또는 메시지에 노출되면 즉시 폐기하고 재발급해야 한다.

## 8. 테스트 및 검증 결과

| 검증 | 결과 |
|---|---|
| npm test | 52 pass, 1 opt-in test skip |
| npm run test:e2e | 8 pass |
| npm run build | 성공 |
| Vercel build | 성공 |
| Preview status | Ready |
| /api/health | ok |
| Qdrant health | connected, collectionExists=true, pointCount=3327 |
| 검사코드 16290 질문 | 공식 검사정보와 출처를 포함한 정상 응답 |
| Fabry 관련 검체 질문 | 관련 검사 목록과 검체정보 정상 응답 |

## 9. 현재 배포

- Preview: https://scl-rag-chatbot-b4yxo085s-gunsoo0920.vercel.app
- Environment: Preview
- Deployment Protection: Vercel Authentication

인증 없는 외부 사용자는 기본 URL에서 Vercel 로그인 화면으로 이동한다. 외부 테스트에는 Vercel Shareable Link를 발급하고, 완전 공개가 필요한 경우에만 Deployment Protection 정책을 변경한다.

## 10. 무료 서비스와 운영 제한

- Qdrant Free: 1GB RAM, 4GB disk의 단일 노드이며 고가용성·자동 백업이 없음
- Qdrant Free: 장기간 미사용 시 suspend/delete 정책 확인 필요
- Vercel Hobby: 무료 포함량을 초과하면 서비스가 제한될 수 있음
- Gemini Free: 분당·일일 quota 초과 시 429가 발생하고 quota 초기화 후 재사용
- /api/stats: Serverless instance 메모리 통계이므로 전역 영속 통계가 아님
- 현재 Vercel에는 crawler Cron을 구성하지 않아 데이터 동기화는 별도 관리 작업으로 실행

## 11. 로컬 실행

1. npm install
2. npm run qdrant:health
3. npm run qdrant:seed
4. npm run chatbot:server
5. npm run dev

로컬 Docker를 쓰려면 먼저 docker compose up -d를 실행한다. Qdrant Cloud를 사용하는 경우 .env의 QDRANT_URL과 QDRANT_API_KEY를 사용한다.

## 12. 후속 과제

1. 외부 담당자 테스트 결과 반영
2. Preview 접근 정책 확정
3. 데이터 동기화 Scheduled Job 또는 CI 작업 구성
4. Qdrant backup과 장애 복구 정책 수립
5. 영속 metrics와 알림 구성
6. 의료·개인정보·서비스 운영 정책 검토
7. Production 배포 전 비용·quota·보안 점검

## 13. 결론

현재 프로젝트는 기존 UI를 유지하면서 Qdrant Cloud 기반 검색, 결정적 답변, 제한적 Gemini 사용, 의료 안전 검증, 증분 데이터 갱신 및 Vercel Preview 배포까지 구성된 상태다. 로컬 PoC를 넘어 외부 검토가 가능한 Preview 단계까지 검증했으며, Production 전환 전에는 접근 정책, 자동 동기화, 모니터링과 운영 정책을 추가로 확정해야 한다.
