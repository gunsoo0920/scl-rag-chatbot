# SCL 검사정보 RAG 챗봇 아키텍처

이 문서는 현재 배포된 React/Vite UI, Vercel Node Functions, Gemini API, Qdrant Cloud 기반 구조를 설명합니다.

> DB에 있는 사실은 DB가 답하고, 비교 가능한 사실은 프로그램이 계산하며, 자연어 검색이 필요할 때만 Embedding을 사용하고, 자연스러운 설명이 필요한 경우에만 생성 모델을 사용합니다.

## 1. 배포 아키텍처

```mermaid
flowchart LR
    USER([사용자 브라우저])

    subgraph VERCEL["Vercel Preview"]
        ACCESS{"Deployment Protection<br/>Vercel Authentication"}
        STATIC["Vite 정적 UI<br/>React"]

        subgraph FUNCTIONS["Node Serverless Functions"]
            HEALTH["GET /api/health"]
            STATS["GET /api/stats"]
            CHAT["POST /api/chatbot/interpret"]
            ADAPTER["vercelAdapter<br/>warm instance별 lazy singleton"]
            HANDLER["공통 HTTP Handler<br/>CORS · JSON · 길이 · Request ID"]
        end
    end

    subgraph RUNTIME["RAG Runtime"]
        SAFETY["Safety Gate"]
        ANALYZER["Query Analyzer<br/>Intent · Entity · Field"]
        ROUTER["Retrieval Router"]
        ANSWER["Intent-aware Answer Service"]
        VALIDATOR["Grounding / Safety Validator"]
        METRICS["In-memory Query Metrics"]
    end

    subgraph EXTERNAL["외부 관리형 서비스"]
        QDRANT[("Qdrant Cloud<br/>scl_tests · 3,327 points<br/>768D Cosine")]
        EMBED["Gemini Embedding API<br/>gemini-embedding-001"]
        GENERATE["Gemini GenerateContent API<br/>gemini-3.1-flash-lite"]
        SCL["SCL 공식 웹/자료<br/>원문 · 이미지 · PDF"]
    end

    USER --> ACCESS
    ACCESS -->|허용| STATIC
    ACCESS -->|미인증| LOGIN["Vercel 로그인 / 접근 요청"]
    STATIC --> CHAT
    STATIC --> HEALTH
    CHAT --> ADAPTER
    HEALTH --> ADAPTER
    STATS --> ADAPTER
    ADAPTER --> HANDLER
    HANDLER --> SAFETY
    SAFETY --> ANALYZER
    ANALYZER --> ROUTER
    ROUTER --> QDRANT
    ROUTER --> EMBED
    ROUTER --> ANSWER
    ANSWER --> GENERATE
    ANSWER --> VALIDATOR
    VALIDATOR --> HANDLER
    ANSWER --> METRICS
    STATIC -->|공식 링크 열기| SCL
```

### 현재 Preview 상태

- Preview URL: `https://scl-rag-chatbot-1du1267ac-gunsoo0920.vercel.app`
- 배포 상태: `Preview / Ready`
- Health: `ok`
- Qdrant: `scl_tests`, 3,327 points, 768차원 Cosine
- 접근 정책: Vercel Authentication 활성화
- 외부 사용자의 인증 없는 요청: 앱 대신 Vercel 로그인으로 `302` 리디렉션

따라서 기본 Preview URL은 공개 URL이 아닙니다. 외부 테스트 사용자는 프로젝트 접근 승인을 받거나 Vercel의 Shareable Link를 사용해야 합니다. 완전 공개하려면 Project Settings의 Deployment Protection을 해제해야 합니다.

## 2. 요청 처리 구조

```mermaid
flowchart TD
    REQUEST["POST question"] --> HTTP["HTTP 경계 검증"]
    HTTP -->|실패| HTTP_ERROR["4xx + requestId"]
    HTTP -->|통과| SAFE{"의료 안전 정책 위반?"}
    SAFE -->|예| BLOCKED["고정 안전 응답<br/>Embedding 0 · Generate 0"]
    SAFE -->|아니오| CASUAL{"일상/범위 밖 대화?"}
    CASUAL -->|예| SCOPE["검사정보 전용 안내"]
    CASUAL -->|아니오| ANALYZE["Intent · Entity · Field 분석"]

    ANALYZE --> INSURANCE{"급여·비급여 코드가 있는가?"}
    INSURANCE -->|예| INSURANCE_SEARCH["Qdrant normalizedInsuranceCodes<br/>payload 검색"]
    INSURANCE -->|아니오| CODE{"검사코드가 있는가?"}
    CODE -->|예| CODE_SEARCH["Qdrant testCode payload 검색"]
    CODE -->|아니오| NAME{"질문 전체에서 검사명 후보가 있는가?"}
    NAME -->|예| NAME_SEARCH["Qdrant normalizedTestName<br/>match any 1회"]
    NAME_SEARCH -->|정확 일치| SELECT
    NAME_SEARCH -->|불일치| VECTOR
    NAME -->|아니오| VECTOR["Gemini query embedding"]
    VECTOR --> VECTOR_SEARCH["Qdrant vector query<br/>top-K · min score · active=true"]
    CODE_SEARCH --> SELECT{"답변 정책 선택"}
    INSURANCE_SEARCH --> SELECT
    VECTOR_SEARCH --> SELECT

    SELECT -->|FIELD_LOOKUP| FIELD["필드값 결정적 조립"]
    SELECT -->|COMPARISON| COMPARE["소요일 범위 프로그램 비교"]
    SELECT -->|RESOURCE_REQUEST| RESOURCE["공식 PDF/이미지 조립"]
    SELECT -->|SEARCH/EXACT| EXACT["검사 목록 결정적 조립"]
    SELECT -->|SEARCH/VECTOR| SEMANTIC["유사 검사 목록 결정적 조립"]
    SELECT -->|EXPLANATION| GEN["검색 근거만 Gemini Generate에 전달"]
    GEN --> VALIDATE["JSON Schema · sourceId · evidence<br/>공식 URL · 의료 안전 검증"]

    FIELD --> RESPONSE
    COMPARE --> RESPONSE
    RESOURCE --> RESPONSE
    EXACT --> RESPONSE
    SEMANTIC --> RESPONSE
    VALIDATE -->|통과| RESPONSE["answer · matchedTests<br/>sources · resources · retrievalPath"]
    VALIDATE -->|실패| SAFE_ERROR["검증 실패 응답"]
```

### 검색 방식과 답변 방식

검색 방식과 사용자에게 보여주는 답변 방식은 별개의 결정입니다.

| 구분 | 조건 | 외부 AI 호출 | 결과 |
|---|---|---:|---|
| Payload 검색 | 검사코드, 급여·비급여 코드 또는 정확한 검사명 | 0 | Qdrant의 구조화 payload 조회 |
| Vector 검색 | 코드/정확한 이름으로 찾지 못함 | Embedding 1회 | Qdrant cosine 유사도 검색 |
| 결정적 답변 | 필드, 목록, 자료, 비교, 일반 검색 | Generate 0회 | 저장된 사실을 프로그램이 조립 |
| 생성 답변 | `EXPLANATION` intent | Generate 1회 | 검색 근거 기반 설명 후 검증 |

예를 들어 검사명 후보를 Vector Search로 찾더라도 질문이 검체 필드 조회라면 최종 응답은 `STRUCTURED` 형식으로 조립될 수 있습니다. `/api/stats`의 경로 카운터는 내부 검색 경로를 기준으로 기록됩니다.

## 3. 주요 컴포넌트 책임

### React/Vite UI

- 질문 입력, loading, 오류와 재시도 처리
- 답변, 매칭 검사, 공식 출처, 이미지/PDF 렌더링
- `/api/health`로 연결 상태 확인
- Gemini 및 Qdrant 비밀키를 브라우저에 전달하지 않음

### Vercel API 계층

- `api/health.js`, `api/stats.js`, `api/chatbot/interpret.js`가 Serverless Function 진입점
- `server/vercelAdapter.js`가 세 진입점을 기존 Node HTTP handler에 연결
- warm instance 안에서 런타임 서비스와 클라이언트를 재사용
- 인스턴스가 교체되면 메모리 metrics가 초기화되므로 `/api/stats`는 전역 영속 통계가 아님
- 동일 Vercel 호스트 요청은 forwarded host/protocol 기준으로 CORS 허용
- JSON Content-Type, 32KB 본문 제한, 질문 1,000자 제한, 요청별 UUID 적용

### Safety Gate와 Query Analyzer

- 개인 검사결과 해석, 진단, 치료·약물, 개인 맞춤 검사 추천을 검색 전에 차단
- LLM 호출 없이 검사코드, 급여·비급여 코드, 질문 전체의 검사명 후보 목록, intent, field 분석
- 검사명 위치를 앞부분으로 고정하지 않고 영문·숫자·그리스 문자 토큰과 최대 8어절 후보를 최대 128개 생성
- 후보별 요청 대신 Qdrant `normalizedTestName match any` 한 번으로 실제 검사명만 검증
- 지원 intent: `FIELD_LOOKUP`, `COMPARISON`, `SEARCH`, `EXPLANATION`, `RESOURCE_REQUEST`, `UNKNOWN`

### Qdrant Cloud

- Collection: `scl_tests`
- Vector: 768차원, Cosine
- Exact index: `id`, `testCode`, `sampleCode`, `normalizedTestName`, `normalizedInsuranceCodes`, `contentHash`, `active`
- 런타임 필터: `active=true`
- Payload에는 검사명, 검체, 방법, 보험코드, 검사일, 소요일, 공식 URL, 이미지/PDF, hash가 저장됨

### Gemini

- Embedding: 정확한 payload 검색으로 해결되지 않을 때만 질문 벡터 생성
- Generate: 자연어 설명 intent에서만 검색 근거를 전달해 호출
- `GEMINI_API_KEY`는 Vercel Preview Secret이며 프론트엔드 번들에 포함되지 않음

## 4. 비밀정보와 신뢰 경계

```mermaid
flowchart LR
    BROWSER["Browser<br/>비밀키 없음"] -->|same-origin HTTPS| VERCEL["Vercel Function<br/>환경변수 주입"]
    VERCEL -->|QDRANT_API_KEY| QDRANT["Qdrant Cloud"]
    VERCEL -->|GEMINI_API_KEY| GEMINI["Gemini API"]

    LOCAL["로컬 .env<br/>Git 제외"] -->|CLI로 Secret 등록| VERCEL
    LOCAL -->|seed / sync| QDRANT
```

- 소스 저장소와 정적 프론트엔드에는 API 키를 넣지 않습니다.
- 로컬 `.env`와 Vercel Preview 환경변수만 비밀값을 보관합니다.
- `QDRANT_API_KEY`와 `GEMINI_API_KEY`는 Secret으로 등록합니다.
- 키가 화면, 로그, 스크린샷에 노출되면 즉시 폐기하고 재발급합니다.

## 5. 데이터 수집과 증분 동기화

```mermaid
flowchart LR
    SCL["SCL 공개 웹"] --> CRAWL["목록/상세 Crawler"]
    CRAWL --> RAW["Raw Snapshot"]
    RAW --> BUILD["Normalize + Knowledge Build"]
    BUILD --> CHECK["Validation"]
    CHECK --> DIFF{"Qdrant와 hash 비교"}

    DIFF -->|신규| NEW["legacy vector 재사용<br/>또는 document embedding"]
    DIFF -->|contentHash 변경| REEMBED["재embedding"]
    DIFF -->|payloadHash만 변경| PAYLOAD["payload update"]
    DIFF -->|변경 없음| NOOP["no-op"]
    DIFF -->|신규 snapshot에서 누락| COVERAGE{"failures=0 및<br/>coverage >= 80%?"}
    COVERAGE -->|예| DEACTIVATE["active=false"]
    COVERAGE -->|아니오| KEEP["기존 active 유지"]

    NEW --> UPSERT[("Qdrant upsert")]
    REEMBED --> UPSERT
    PAYLOAD --> UPSERT
    DEACTIVATE --> UPSERT
```

현재 Vercel 배포에는 crawler Cron이 포함되어 있지 않습니다. 데이터 갱신은 신뢰된 로컬/CI 관리 작업에서 `npm run scl:sync` 또는 `npm run scl:sync:data`를 실행해 Qdrant Cloud에 반영합니다. 런타임은 요청마다 Qdrant를 조회하므로 동기화 후 재배포나 서버 재시작이 필요하지 않습니다.

## 6. 운영 상태 확인

- `GET /api/health`: Node API, Qdrant 연결, collection, point count, vector dimension, Gemini 설정
- `GET /api/stats`: instance-local 검색 경로와 AI 호출 우회율
- Vercel Logs: Serverless Function의 4xx/5xx와 request ID 확인
- Qdrant Console: cluster health, point count, 저장공간 확인
- AI Studio: Gemini 요청량과 Free Tier quota 확인

## 7. 로컬 개발과 Preview 차이

| 항목 | 로컬 개발 | Vercel Preview |
|---|---|---|
| UI | Vite dev server | Vercel static output |
| API | `node server/chatbotServer.js` | `api/*` Node Functions |
| Qdrant | Docker 또는 Cloud | Qdrant Cloud 필수 |
| 환경변수 | `.env` | Vercel Preview Environment Variables |
| 접근 통제 | localhost | 현재 Vercel Authentication |
| 동기화 | 로컬 스크립트/스케줄러 | 별도 관리 작업 필요 |
