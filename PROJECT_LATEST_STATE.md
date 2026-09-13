# SCL 검사정보 Hybrid RAG 챗봇 — 최신 구현 상태 조사서

> 조사 기준 시각: 2026-09-13 16:53~17:10 KST  
> Git 기준: refactor/qdrant-deterministic-rag 브랜치, HEAD 45e4c71622194779aaadbc153101cb41b4ad68e7  
> 중요: HEAD 이후 커밋되지 않은 변경 파일 14개가 있다. 따라서 이 문서에서 “현재 코드”는 별도 표시가 없는 한 **HEAD + 현재 working tree**를 뜻하며, “배포 상태”는 이 코드와 동일하다고 간주하지 않는다.  
> Secret 값, Qdrant endpoint 전체 주소, Vercel 공유 토큰은 출력하지 않았다.

## 1. 조사 기준

이 문서는 기존 REPORT_SOURCE.md를 요약한 문서가 아니다. 현재 Git 상태, 실제 파일, 저장 데이터, 로컬 실행 결과, Cloud Qdrant 조회 결과, Vercel URL의 외부 HTTP 응답을 다시 확인해 작성했다.

조사에 사용한 주요 방법은 다음과 같다.

- Git: branch, HEAD, tracking, status, 최근 10개 commit 직접 조회
- 코드: runtime API, Query Analyzer, Retrieval Router, Qdrant Store, deterministic response, Gemini, Safety Gate, sync 구현 직접 추적
- 데이터: raw, detail, failure, processed, knowledge JSON을 직접 집계
- 실행 검증: Node test, 실 Qdrant opt-in test, Playwright E2E, Vite build, integration validation, crawl/knowledge/vector validator
- 실질의: Cloud Qdrant에 연결된 로컬 Node API로 exact, structured, comparison, semantic, explanation, safety 질문 실행
- 배포: Preview 후보 URL과 Production alias 후보를 인증 없는 HTTP 요청으로 확인

검증 상태는 다음 의미로 사용한다.

| 상태 | 의미 |
|---|---|
| 확인 | 현재 코드 또는 실제 실행으로 확인 |
| 부분 확인 | 일부 계층만 확인했거나 mock 기반 |
| 미확인 | 인증·외부 상태 등의 이유로 현재 조사에서 확인하지 못함 |
| 실패 | 명령을 실제 실행했고 실패 결과를 얻음 |
| 미반영 | working tree에는 있으나 Git remote, Qdrant 또는 Vercel에 반영되지 않음 |

## 2. Git 최신 상태

### 2.1 현재 branch와 HEAD

| 항목 | 현재 값 |
|---|---|
| Branch | refactor/qdrant-deterministic-rag |
| HEAD | 45e4c71622194779aaadbc153101cb41b4ad68e7 |
| HEAD 제목 | feat: improve semantic test search results |
| Tracking | origin/refactor/qdrant-deterministic-rag |
| Ahead/behind 표시 | 없음. HEAD와 tracking commit은 같음 |
| Remote | 사내 GitLab origin 1개 |
| Working tree | 조사 시작 시 수정 파일 14개. 조사 결과물 PROJECT_LATEST_STATE.md가 새 untracked file로 추가됨 |

remote URL에는 사용자명이 포함되므로 이 문서에는 전체 값을 반복하지 않는다.

### 2.2 미커밋 변경

조사 시작 시 수정된 기존 파일은 14개이며 총 diff는 170 insertions, 20 deletions다. 이 문서를 작성한 뒤에는 여기에 untracked PROJECT_LATEST_STATE.md 1개가 추가된다.

| 범주 | 파일 |
|---|---|
| 문서 | README.md, TROUBLESHOOTING.md, architecture.md, bpmn.md |
| 검색 데이터 정규화 | server/rag/contentIdentity.js |
| Qdrant | server/rag/qdrantStore.js |
| Query Analyzer | server/rag/queryAnalyzer.js |
| Routing | server/rag/retrievalRouter.js |
| Sync | server/sync/incrementalSync.js |
| E2E | tests/e2e/chatbot.spec.js |
| Unit/integration | tests/incremental-sync.test.mjs, tests/intent-aware-answer-service.test.mjs, tests/qdrant-integration.test.mjs, tests/query-analyzer.test.mjs |

위 변경의 핵심은 급여·비급여 코드 역검색이다. working tree에는 구현과 mock/unit/E2E 테스트가 있지만, 아직 commit·push·Vercel 배포되지 않았고 Cloud Qdrant에도 normalizedInsuranceCodes payload/index가 반영되지 않았다.

### 2.3 최근 commit 10개

| 순서 | Commit | 일시(KST) | 제목 |
|---:|---|---|---|
| 1 | 45e4c71 | 2026-09-01 15:59 | feat: improve semantic test search results |
| 2 | a14d47b | 2026-08-28 17:54 | fix: improve exact test name routing |
| 3 | f92abaf | 2026-08-25 15:49 | docs: add project report and troubleshooting |
| 4 | fce3fef | 2026-08-25 15:16 | docs: update deployed rag architecture |
| 5 | bcb33a7 | 2026-08-25 14:21 | docs: record explicit preview deployment |
| 6 | 42511fd | 2026-08-25 12:54 | chore: prepare vercel preview deployment |
| 7 | 0c961d0 | 2026-08-25 12:35 | docs: align ui and operations guide |
| 8 | e4caded | 2026-08-25 12:35 | feat: introduce qdrant deterministic rag |
| 9 | 506ce2d | 2026-08-13 14:56 | 로컬 환경 자동 설정 추가 |
| 10 | c1d728a | 2026-08-13 14:17 | SCL RAG 챗봇 초기 구현 |

HEAD의 semantic 개선에는 name reranker, clarification path, 결과 개수 문구 제거, RESULTS_ONLY presentation, 관련 unit/E2E가 포함된다. ALT 조사·어순 exact 개선은 직전 a14d47b에 포함되어 있다.

## 3. 프로젝트 목적

이 프로젝트는 SCL 공개 검사정보를 일반 사용자와 업무 담당자가 검사명, SCL 검사코드 또는 자연어 질문으로 조회하도록 돕는 검사정보 안내 챗봇이다.

현재 사용하는 데이터는 SCL 공개 검사 목록·상세 페이지에서 수집한 3,327개 지식 문서다. 검사명, SCL 검사코드, 검체, 검사방법, 급여·비급여 코드, 검사일, 검사 구분, 소요일, 공식 원문, 검체용기 이미지 등을 구조화 필드와 검색용 텍스트로 보관한다.

처리할 수 있는 질문은 다음과 같다.

- 정확한 SCL 검사코드 조회
- 정확한 검사명 조회
- 검체·검사방법·소요일·검사일 등 특정 필드 조회
- 두 검사코드 또는 두 검사명의 공식 소요일 비교
- 정확한 이름이 없는 질환·관련 표현의 의미 검색
- 공식 자료 범위 안의 설명형 질문
- 현재 working tree 기준 급여·비급여 코드 역검색

처리하지 않거나 제한하는 질문은 다음과 같다.

- 개인 검사결과 해석, 질병 진단, 치료·약물 결정
- 증상만으로 특정 검사를 골라 달라는 개인 맞춤 추천
- SCL 검사정보와 관계없는 일상 대화
- 공식 데이터에 없는 사실
- 정확히 한 검사로 특정할 수 없는 넓은 범주어 일부

핵심 특징은 “모든 질문을 LLM에게 보내는 챗봇”이 아니라, 정확한 값은 Qdrant payload로 조회해 코드가 답하고 의미 검색에만 Gemini Embedding을 사용하며, 설명 의도에만 Gemini Generate를 제한적으로 사용하는 Hybrid RAG 구조라는 점이다.

## 4. 최신 Architecture

### 4.1 구성 요소와 실제 코드

| 단계 | 실제 파일·함수 | 역할 |
|---|---|---|
| React UI | src/components/chatbot/Chatbot.jsx: Chatbot | health 확인, 메시지 상태, API 호출, retry |
| API client | src/services/chatbotApi.js: getChatbotHealth, interpretQuestion | GET /api/health, POST /api/chatbot/interpret |
| Vercel entry | api/health.js, api/stats.js, api/chatbot/interpret.js | Vercel Node Function 진입점 |
| Adapter | server/vercelAdapter.js: createVercelHandler | 환경 로드, runtime singleton 구성, 경로 전달 |
| API boundary | server/chatbotServer.js: createChatbotRequestHandler | CORS, JSON/body 검증, 응답 schema, request ID, 오류 처리 |
| Safety | server/rag/safetyGate.js: evaluateSafety, assertSafeGeneratedOutput | 의료 조언 입력 차단, 생성 답변 위험 문구 차단 |
| Query Analyzer | server/rag/queryAnalyzer.js: analyzeQuery | 코드·보험코드·검사명 후보·intent·field 추출 |
| Router | server/rag/retrievalRouter.js: RetrievalRouter.retrieve | payload exact 우선, 실패 시 embedding/vector |
| Exact DB | server/rag/qdrantStore.js: findByTestCodes, findByExactNames | active payload keyword filter |
| Insurance DB | server/rag/qdrantStore.js: findByInsuranceCodes | working tree 추가. Cloud DB migration 전 |
| Vector DB | server/rag/qdrantStore.js: semanticSearch | Qdrant Cosine query, payload 반환 |
| Rerank | server/rag/nameReranker.js | exact anchor, fuzzy token, 범주 모호성 판단 |
| Response | server/rag/intentAwareAnswerService.js: IntentAwareAnswerService.answer | 경로별 deterministic response 또는 Generate |
| Gemini Embedding | server/rag/embeddingService.js: GeminiEmbeddingService | RETRIEVAL_QUERY/RETRIEVAL_DOCUMENT, 768차원 |
| Gemini Generate | server/rag/ragAnswerService.js: GeminiGenerationService | EXPLANATION용 JSON schema 응답 |
| Grounding 검증 | server/rag/responseValidator.js | sourceId, 원문 quote, 숫자, 공식 URL 검증 |
| Metrics | server/rag/queryMetrics.js: QueryMetrics | 메모리 내 카운터·평균 latency |
| Sync | server/sync/incrementalSync.js: syncDocuments | contentHash/payloadHash diff, upsert, payload update, deactivate |

### 4.2 실제 처리 특성

- React는 데이터베이스에 직접 접근하지 않는다.
- Vercel 또는 로컬 Node API가 Qdrant와 Gemini Secret을 보유한다.
- exact/structured/comparison도 모두 Qdrant가 가동 중이어야 한다.
- exact 성공 시 Gemini Embedding과 Generate를 모두 호출하지 않는다.
- semantic 검색은 Gemini Embedding과 Qdrant vector query를 사용하지만 일반 검색 답변 문장은 코드가 만든다.
- EXPLANATION intent만 Gemini Generate를 호출한다.
- Qdrant payload는 요청마다 조회되므로 DB update 후 API 재시작은 필요 없다.
- legacy vector-index.json과 VectorStore 구현은 파일·테스트에 남아 있지만 현재 IntentAware runtime의 검색 저장소는 Qdrant다.

### 4.3 보고서 삽입용 전체 구조도

아래 구조도는 현재 working tree의 런타임 흐름을 단순화한 것이다.

~~~text
┌──────────────┐
│    사용자     │
└──────┬───────┘
       │ 질문 입력
       ▼
┌──────────────────┐
│  React 챗봇 UI   │
│  상태·결과 표시  │
└────────┬─────────┘
         │ POST /api/chatbot/interpret
         ▼
┌──────────────────┐
│ Vercel / Node API│
│ 요청·응답 형식 검증│
└────────┬─────────┘
         ▼
┌──────────────────┐
│   Safety Gate    │
│ 의료 조언 사전 차단│
└────┬────────┬────┘
     │차단    │허용
     ▼        ▼
┌──────────┐  ┌──────────────────┐
│안전 안내 │  │  Query Analyzer  │
│고정 응답 │  │코드·검사명·의도·필드│
└────┬─────┘  └────────┬─────────┘
     │                 ▼
     │        ┌──────────────────┐
     │        │ Retrieval Router │
     │        │   검색 경로 선택  │
     │        └────┬────────┬────┘
     │             │        │
     │      정확한 값 있음   │ 정확 일치 없음
     │             ▼        ▼
     │   ┌──────────────┐  ┌──────────────────┐
     │   │Qdrant Payload│  │ Gemini Embedding │
     │   │ Exact Search │  │  질문 → 768D 벡터 │
     │   │코드·명칭·필드 │  └────────┬─────────┘
     │   └──────┬───────┘           ▼
     │          │          ┌──────────────────┐
     │          │          │  Qdrant Vector  │
     │          │          │ Cosine Search   │
     │          │          └────────┬─────────┘
     │          │                   ▼
     │          │          ┌──────────────────┐
     │          │          │모호성 확인·재정렬│
     │          │          │관련 검사 후보 선택│
     │          │          └────────┬─────────┘
     │          └──────────┬────────┘
     │                     ▼
     │          ┌──────────────────────┐
     │          │ Intent별 응답 처리   │
     │          ├──────────────────────┤
     │          │ Exact / Structured   │
     │          │ Comparison / Search  │
     │          │ → 코드가 직접 응답   │
     │          │ Explanation          │
     │          │ → Gemini Generate    │
     │          └──────────┬───────────┘
     │                     ▼
     │          ┌──────────────────────┐
     │          │ Grounding / Safety   │
     │          │출처·근거·URL·수치 검증│
     │          └──────────┬───────────┘
     └─────────────────────┤
                           ▼
                ┌──────────────────────┐
                │      최종 답변       │
                │검사 카드·공식 출처 표시│
                └──────────────────────┘
~~~

정확 검색의 대상은 SCL 검사코드와 정규화 검사명이다. 급여·비급여 코드 exact 경로도 working tree에는 포함됐지만, Cloud Qdrant의 normalizedInsuranceCodes migration 전이므로 현재 배포 완료 기능으로 표시하지 않는다.

## 5. Query Analyzer 최신 상태

### 5.1 Entity와 intent

analyzeQuery는 다음 값을 반환한다.

- original, normalizedQuestion
- entity.testCodes
- entity.insuranceCodes: working tree 추가
- entity.testName
- entity.testNameCandidates
- entity.multiple
- intent
- field

정의된 intent는 FIELD_LOOKUP, COMPARISON, SEARCH, EXPLANATION, RESOURCE_REQUEST, MEDICAL_ADVICE, UNKNOWN이다. 다만 의료 판단은 현재 analyzer의 MEDICAL_ADVICE 분류보다 앞에서 Safety Gate가 직접 차단하므로, 정상 runtime에서 MEDICAL_ADVICE가 retrieval path로 쓰이지 않는다.

주요 field alias는 다음과 같다.

| Field | 현재 인식 표현 예 |
|---|---|
| testCode | 검사코드, 코드 |
| testName | 검사명, 이름 |
| specimen | 어떤 검체, 검체 종류, 검체 |
| method | 검사방법, 검사 방식, 어떻게 검사 |
| insuranceCode | 보험코드, 보험 코드, 급여코드, 급여 코드 |
| schedule | 검사 요일, 무슨 요일, 검사일, 언제 검사 |
| timeType | 주간 검사, 야간 검사, 검사 구분 |
| turnaroundTime | 결과 언제, 언제 나와, 며칠 걸려, 소요일, 소요시간 |
| sourceUrl | 공식 원문, 원문 링크, 출처, 공식 링크 |
| pdfUrls | PDF, 문서 |
| imageUrls | 이미지, 사진, 검체용기 |

### 5.2 요청된 ALT 문장 실제 분석 결과

| 질문 | entity.testName 첫 값 | exact 후보 | testCodes | Intent | Field |
|---|---|---|---|---|---|
| ALT 검사는 어떤 검체를 사용하나요? | ALT 는 를 사용하나요 | ALT 포함 | 없음 | FIELD_LOOKUP | specimen |
| ALT를 검사하려면 어떤 검체가 필요한가요? | ALT를 하려면 가 필요한가요 | ALT 포함 | 없음 | FIELD_LOOKUP | specimen |
| ALT의 소요일은 며칠인가요? | ALT의 은 며칠 | ALT 포함 | 없음 | FIELD_LOOKUP | turnaroundTime |
| ALT 검사방법 알려줘 | ALT | ALT 포함 | 없음 | FIELD_LOOKUP | method |
| AST와 ALT 중 어떤 검사가 더 빨리 나오나요? | AST와 ALT 중 어떤 가 더 빨리 나오나요 | AST, ALT 각각 포함 | 없음 | COMPARISON | 없음 |

결론은 “첫 extracted testName이 항상 깨끗하게 ALT만 되는 구조”는 아니다. 대신 최대 128개의 연속 구간·토큰 후보를 만들고, ALT처럼 영문·숫자·그리스 문자를 포함한 토큰의 조사를 제거한 뒤 전체 후보를 Qdrant exact batch 조회한다.

즉 현재 개선은 단일 testName 추출의 완전성보다 **exact 후보 보존과 DB 검증**에 초점을 둔다. 실제 검색은 성공하지만, entity.testName 첫 값에 “는”, “를 사용하나요” 같은 잡음이 남는 것은 현재 한계다.

### 5.3 급여·비급여 코드 분석

working tree는 D185000HZ, D517205KZ, D470002HZetc. 같은 형식을 대문자·영숫자로 정규화한다. 후보는 8~18자, 숫자 5개 이상, 영문 2개 이상, 영문으로 시작하는 조건을 적용한다.

보험코드 후보를 먼저 문장에서 제거한 뒤 SCL 숫자 검사코드를 추출하므로 D185000HZ 내부의 185000을 SCL 검사코드로 잘못 인식하지 않는다. ETC 접미사는 전체 alias와 base alias를 함께 만든다.

## 6. ALT 개선 사항

### 6.1 과거 문제

과거에는 “ALT 검사는 어떤 검체를 사용하나요?”처럼 검사명 뒤에 조사와 서술어가 붙으면 문장 전체가 이름 후보가 되어 exact lookup이 실패할 수 있었다. 이후 vector search로 넘어가면 embedding 의미 유사도만으로 AST, Cobalt, MALToma 같은 다른 후보가 섞일 위험이 있었다.

### 6.2 현재 해결 방식

1. queryAnalyzer가 영문·숫자·그리스 문자가 포함된 토큰을 별도 후보로 보존한다.
2. ALT를, ALT는, ALT와 같이 붙은 조사를 stripAttachedParticle로 제거한다.
3. 문장 앞·중간·뒤의 연속 토큰 후보를 생성한다.
4. RetrievalRouter가 findByExactNames로 후보 전체를 한 번의 Qdrant payload filter에 전달한다.
5. 일치 결과를 normalizedTestName별로 묶고, analyzer 후보 순서상 가장 먼저 일치한 검사명 그룹만 선택한다.
6. exact가 없을 때만 embedding/vector로 이동한다.
7. semantic 결과는 nameReranker가 exact/fuzzy anchor를 적용해 직접 검사명 질의는 원칙적으로 가장 가까운 1건으로 좁힌다.
8. “특검 검사”처럼 한 범주 토큰이 여러 후보 검사명에 반복되면 CLARIFICATION으로 전환한다.

### 6.3 실제 Cloud API 검증

| 질문 | 실제 Path | 검사코드 | Embedding | Generate |
|---|---|---:|---:|---:|
| ALT 검사 알려줘 | EXACT | 10130 | 0 | 0 |
| ALT 검사는 어떤 검체를 사용하나요? | STRUCTURED | 10130 | 0 | 0 |
| ALT를 검사하려면 어떤 검체가 필요한가요? | STRUCTURED | 10130 | 0 | 0 |
| ALT의 소요일은 며칠인가요? | STRUCTURED | 10130 | 0 | 0 |
| ALT 검사방법 알려줘 | STRUCTURED | 10130 | 0 | 0 |
| AST와 ALT 중 어떤 검사가 더 빨리 나오나요? | COMPARISON | 10130, 10120 | 0 | 0 |

ALT exact 결과는 ALT 1건이며 AST가 앞에 나오지 않았다. 실제 데이터의 ALT는 검사코드 10130, sampleCode 100, 검체 Serum, 검사방법 Enzymatic method, 소요일 1일, 급여·비급여 코드 D185000HZ다.

### 6.4 판정

**ALT 조사·어순 문제는 검색 경로 기준으로 개선됨**이다. 다만 다음은 남아 있다.

- 첫 entity.testName은 아직 문장형 잡음을 포함한다.
- “ALT 특채”는 exact 후보 ALT가 먼저 살아 EXACT 10130으로 처리되지만, “ALT(특채)”는 VECTOR를 거쳐 실제 검사명 “(특검)ALT”, 코드 10135를 반환했다. 괄호·오타 표현에 따라 결과가 달라지는 일관성 문제가 있다.
- semantic 정확도는 embedding 결과와 reranker 휴리스틱에 의존하며 모든 자연어를 보장하지 않는다.

## 7. Retrieval Router

현재 working tree의 실제 조회 우선순위는 다음과 같다.

1. entity.insuranceCodes가 있으면 normalizedInsuranceCodes keyword exact
2. entity.testCodes가 있으면 testCode keyword exact
3. testNameCandidates가 있으면 normalizedTestName keyword batch exact
4. exact가 없고 embedding service가 있으면 Gemini query embedding
5. Qdrant vector query로 후보 수집
6. 모호한 단일 범주어면 CLARIFICATION
7. threshold 적용과 name rerank
8. 결과가 있으면 VECTOR, 없으면 NO_RESULT

주의할 점은 STRUCTURED와 COMPARISON이 별도의 DB 조회 단계는 아니라는 것이다. exact 문서를 찾은 후 analyzer intent가 FIELD_LOOKUP/RESOURCE_REQUEST이면 STRUCTURED, COMPARISON이면 COMPARISON으로 path가 정해진다.

| Path | 존재 위치 | 의미 |
|---|---|---|
| EXACT | Retrieval Router | 정확한 보험코드·검사코드·검사명 검색 |
| STRUCTURED | Retrieval Router/Answer Service | 정확한 문서에서 특정 필드 또는 리소스 응답 |
| COMPARISON | Retrieval Router/Answer Service | 정확한 복수 검사 소요일 비교 |
| VECTOR | Retrieval Router | embedding + Qdrant vector 결과 |
| CLARIFICATION | Retrieval Router | 범주 후보가 여러 개여서 사용자에게 구체화 요청 |
| NO_RESULT | Retrieval Router | exact와 semantic 모두 최종 결과 없음 |
| BLOCKED | Safety/Answer Service | Router 진입 전 의료 조언 차단 |

## 8. Exact Search

### 8.1 검사코드 exact

“16290 검사 알려줘”의 흐름은 다음과 같다.

- analyzer: testCodes=[16290], intent=SEARCH
- Qdrant filter: active=true AND testCode match any [16290]
- Path: EXACT
- 실제 결과: α-Galactosidase (GLA)_Fabry, sampleCode 510, Heparin W/B, 5일
- Embedding 0, vector query 0, Generate 0

### 8.2 검사명 exact

“ALT 검사 알려줘”의 흐름은 다음과 같다.

- analyzer가 ALT를 포함한 testNameCandidates 생성
- Qdrant filter: active=true AND normalizedTestName match any [후보들]
- Path: EXACT
- 실제 결과: ALT, 코드 10130 1건
- Embedding 0, vector query 0, Generate 0

### 8.3 보험코드 exact

working tree의 의도된 흐름은 다음과 같다.

- D517205KZ를 insuranceCodes로 추출
- Qdrant filter: active=true AND normalizedInsuranceCodes match any [D517205KZ]
- exact 또는 structured deterministic response
- Embedding/Generate 0

그러나 Cloud Qdrant payload_schema에는 normalizedInsuranceCodes index가 아직 없다. 실 integration에서 이 조회는 Bad Request로 실패했다. 따라서 현재 배포·Cloud DB 기준으로 보험코드 역검색 가능이라고 보고하면 안 된다.

## 9. Structured Search

FIELD_LOOKUP은 저장된 payload 값을 코드가 직접 문장으로 만든다.

| 실제 질문 | Entity | Intent | Field | 실제 값 | AI 호출 |
|---|---|---|---|---|---|
| 16290 검사 며칠 걸려? | code 16290 | FIELD_LOOKUP | turnaroundTime | 5일 | 없음 |
| ALT 검사방법 알려줘 | name ALT | FIELD_LOOKUP | method | Enzymatic method | 없음 |
| ALT 검체 알려줘 | name ALT | FIELD_LOOKUP | specimen | Serum | 없음 |
| ALT 결과 언제 나와? | name ALT | FIELD_LOOKUP | turnaroundTime | 1일 | 없음 |

STRUCTURED 응답에는 presentation=RESULTS_ONLY가 붙는다. 따라서 “몇 건을 찾았습니다” 같은 추가 말머리 대신 검사 결과와 필드 중심으로 표시한다.

현재 문장 템플릿은 “ALT 검사의 검체은(는) Serum입니다”처럼 조사가 자연스럽지 않은 부분이 있다. 값은 맞지만 사용자 문장 품질 개선이 필요하다.

## 10. Comparison

comparisonResponse는 문서를 검사코드별로 묶고 turnaroundTime을 날짜 범위로 파싱한다. 두 검사 범위가 완전히 앞서면 더 짧은 코드를 판정하고, 겹치면 단정하지 않는다.

실제 결과:

- “16290이랑 11380 중 뭐가 빨라?” → COMPARISON, 16290은 5일, 11380은 30일, 16290이 짧다고 응답
- 11380은 검체 variant가 2건이라 matchedTests에는 두 point가 유지되지만 비교 문장은 검사코드별로 묶는다.
- “AST와 ALT 중 어떤 검사가 더 빨리 나오나요?” → 검사명 두 개 exact 가능, 10130과 10120 모두 1일이라 같다고 응답
- “16290 빨리 나오는 편이야?” → COMPARISON이지만 비교 대상이 1개라 빠른 편인지 판단 기준이 없다고 응답하면서 공식 소요일 5일만 제시

검사명 기반 복수 비교는 현재 실제로 가능하다. 다만 entity.multiple은 숫자 testCodes 개수만 보므로 name comparison의 multiple 값 자체는 false일 수 있다. Router는 COMPARISON intent와 exact documents를 사용하므로 실제 응답에는 문제가 없었다.

## 11. Semantic Search

### 11.1 실제 흐름

1. 보험코드·검사코드·검사명 exact 실패
2. GeminiEmbeddingService.embedQuery 호출
3. model gemini-embedding-001, taskType RETRIEVAL_QUERY, output 768차원
4. Qdrant client.query, active=true, Cosine, with_payload=true
5. Router는 모호성 검사를 위해 우선 score threshold 0으로 후보를 요청
6. ambiguousCategoryTerm 검사
7. 실제 RAG_MIN_SCORE 0.60 이상만 유지
8. rerankSemanticDocuments 적용
9. broad semantic 질문은 최대 Top-K 5개, 직접 검사명형 질문은 anchor 기준 가장 가까운 1개

설정값은 Top-K 5, threshold 0.60이다.

### 11.2 실제 질문

| 질문 | Exact | Embedding | Vector | 결과 |
|---|---:|---:|---:|---|
| 파브리병 관련 검사 알려줘 | 실패 | 1 | 1 | VECTOR, 5건 |
| 효소 결핍 질환 관련 검사를 찾아줘 | 실패 | 1 | 1 | VECTOR, 5건 |
| ALT(특채) | 실패 | 1 | 1 | VECTOR, (특검)ALT 10135 한 건 |
| 특검 검사 | 실패 | 1 | 1 | 현재 실질의에서 CLARIFICATION 경로를 별도로 재측정하지 않았으나 unit에서 검증 |

일반 VECTOR 답변은 Gemini Generate를 호출하지 않는다. semanticResponse가 “관련 검사정보를 확인했습니다”라는 고정 문장과 검색된 검사 카드만 반환한다.

### 11.3 한계

- embedding quota, network, Gemini API key에 의존한다.
- 0.60은 현재 환경 설정이지 의료적 정확도 기준이 아니다.
- Top-K 5는 후보 수이며 사용자에게 항상 5건을 보여준다는 뜻이 아니다.
- 괄호, 혼합 오타, 짧은 토큰에 따라 exact 후보와 reranker 결과가 달라질 수 있다.
- 현재 의미 검색 품질은 예제·unit test와 소수 실질의로만 확인했고 전체 질의셋 정확도 평가는 없다.

## 12. Gemini Generate

### 12.1 사용 범위

| 질문 유형 | Embedding | Qdrant vector | Generate |
|---|---:|---:|---:|
| Exact code/name | 0 | 0 | 0 |
| Structured field | 0 | 0 | 0 |
| Comparison | 0 | 0 | 0 |
| Semantic SEARCH | 1 | 1 | 0 |
| Exact EXPLANATION | 0 | 0 | 1 |
| Semantic EXPLANATION | 1 | 1 | 1 |
| Medical BLOCKED | 0 | 0 | 0 |
| NO_RESULT | exact 실패 시 조건부 1 | 조건부 1 | 0 |

Generate model 설정명은 gemini-3.1-flash-lite다. API key는 server-only이며 값은 출력하지 않았다.

### 12.2 Grounding

Generate 요청은 sourceId enum을 가진 JSON schema를 강제하고, 모델이 answer, grounded, sourceIds, evidence를 반환하도록 한다. 이후 responseValidator가 다음을 다시 검증한다.

- 검색되지 않은 sourceId 거부
- 원문에 연속 문자열로 존재하지 않는 evidence 거부
- 저장되지 않은 URL 거부
- 공식 SCL HTTPS 하위 도메인이 아닌 URL 거부
- 원문에 없는 수치 거부
- 위험한 진단·치료 문구 거부

### 12.3 현재 발견된 실패

“16290 검사 자세히 설명해줘”를 실제 실행했을 때 Generate는 1회 호출됐지만, 모델이 반환한 evidence quote가 저장된 content의 연속 문자열과 정확히 일치하지 않아 responseValidator가 거부했다.

- HTTP: 500
- 사용자 메시지: 챗봇 답변을 처리하는 중 오류가 발생했습니다.
- 내부 원인: 원문에 존재하지 않는 evidence
- 의미: 안전 검증이 허위 인용을 막은 것은 맞지만, 정상 설명 요청도 500으로 끝나는 가용성 문제가 있다.

따라서 “Gemini Generate 설명 기능이 정상”이라고 보고할 수 없다. 현재 확인 결과는 **호출 가능, grounding validation 실패 재현**이다.

## 13. Qdrant 최신 상태

### 13.1 실환경

| 항목 | 실제 확인값 |
|---|---|
| 환경 | Qdrant Cloud |
| Collection | scl_tests |
| Health | connected=true, collectionExists=true |
| Collection status | green |
| Optimizer | ok |
| Points | 3,327 |
| Segments | 2 |
| Vector dimension | 768 |
| Distance | Cosine |
| indexed_vectors_count 응답 | 0 |

indexed_vectors_count가 0으로 보고됐지만 실제 semantic vector query는 성공했다. 이 값만으로 vector가 없다고 해석할 수 없으며, 소규모 segment의 HNSW indexing 상태 등 Qdrant 내부 조건은 별도 조사하지 않았다.

Qdrant 무료 cluster는 조사 도중 SUSPENDED 상태였고 Reactivate 후 위 green 상태를 다시 확인했다. suspend 중에는 exact ALT 질문도 DB에 접근하지 못해 API 500이 발생한다.

### 13.2 실제 payload index

현재 Cloud collection에서 직접 읽은 index는 다음 6개다.

- id: keyword
- testCode: keyword
- sampleCode: keyword
- normalizedTestName: keyword
- contentHash: keyword
- active: bool

working tree의 DEFAULT_INDEX_FIELDS에는 normalizedInsuranceCodes: keyword가 추가돼 있으나 Cloud에는 아직 없다.

### 13.3 주요 payload

기존 Cloud point에는 id, testCode, sampleCode, testName, normalizedTestName, specimen, method, insuranceCode, schedule, timeType, turnaroundTime, content, keywords, sourceUrl, pdfUrls, imageUrls, resources, metadata, crawledAt, updatedAt, contentHash, payloadHash, active가 저장된다.

현재 working tree의 toQdrantPayload는 normalizedInsuranceCodes도 추가한다. 이 값은 아직 Cloud point 전체에 migration되지 않았다.

## 14. 데이터 최신 상태

| 항목 | 현재 값 | 상태 |
|---|---:|---|
| 목록 raw records | 3,327 | 검증 통과 |
| 목록 pages | 333 | 1~333 누락 없음 |
| 상세 성공 | 3,326 | 검증 통과 |
| 상세 실패 | 1 | 완료 아님 |
| Processed | 3,327 | 검증 통과 |
| Knowledge | 3,327 | 검증 통과 |
| Unique knowledge IDs | 3,327 | 검증 통과 |
| Unique SCL testCodes | 2,597 | 직접 집계 |
| Active knowledge | 3,327 | 직접 집계 |
| 이미지 URL/resources | 3,220 | 검증 통과 |
| PDF URL | 0 | 직접 집계 |
| timeType 빈 값 | 38 | 목록 validator |
| content 길이 min/avg/max | 95 / 842 / 6,854 | knowledge validator |

실제 failure record:

- ID: test-11010-204-c890ddff6349
- 검사코드/검사명: 11010 / Amino acid (CSF)
- 시도 횟수: 3
- 오류: The operation was aborted due to timeout
- 실패 시각: 2026-08-09T13:00:04.056Z

목록 full crawl 완료 시각은 2026-08-09, knowledge build 시각은 2026-08-09다. 즉 개수 검증은 현재 통과했지만 원천 데이터 자체가 2026-08-09 이후 자동 갱신됐다는 증거는 없다.

## 15. Crawl / Incremental Sync

### 15.1 현재 데이터 갱신 흐름

SCL 목록·상세 페이지 → raw JSON → processed JSON → knowledge JSON → 기존 Qdrant point와 hash diff → 선택적 embedding/payload update → Qdrant

실행 명령:

- npm run scl:sync: 전체 목록/상세 crawl, knowledge build, Qdrant sync
- npm run scl:sync:data: 기존 knowledge/failure JSON만 Qdrant sync
- npm run qdrant:seed: knowledge와 선택적 legacy vector로 Qdrant 동기화

### 15.2 diff 규칙

| 상태 | 판단 | 처리 |
|---|---|---|
| 신규 | document ID 없음 | legacy 768D vector 재사용 또는 document embedding 후 upsert |
| 의미 변경 | contentHash 변경 | 재Embedding 후 vector+payload upsert |
| metadata만 변경 | contentHash 동일, payloadHash 변경 | vector 유지, payload만 update |
| 변경 없음 | 두 hash 동일, active=true | 아무 작업 없음 |
| 사라진 문서 | 현재 crawl에 ID 없음 | 안전 조건 충족 시 active=false |

contentHash에는 testName, specimen, method, schedule, timeType, turnaroundTime, content가 포함된다. payloadHash에는 ID·코드·보험코드·키워드·공식 URL·resources·active 등이 포함된다. working tree는 normalizedInsuranceCodes도 payloadHash에 포함한다.

Qdrant upsert는 100 points씩이다. working tree에서는 payload-only update도 batchUpdate를 이용해 100개씩 처리하도록 변경했다.

deactivation은 crawl failures=0이고 새 문서 수가 기존 active의 80% 이상일 때만 수행한다. 현재 detail failure가 1건 있으므로 sync 시 누락 문서를 자동 비활성화하지 않는 안전장치가 작동한다.

### 15.3 자동 최신화 여부

자동 최신화는 현재 배포되어 있지 않다.

- 로컬 Node server에는 SCL_SYNC_ENABLED=true일 때 interval scheduler를 시작하는 코드가 있다.
- 현재 local 설정은 SCL_SYNC_ENABLED=false다.
- Vercel adapter는 startSyncScheduler를 호출하지 않는다.
- vercel.json에 Cron 설정이 없다.
- 외부 Scheduled Job이 있다는 증거도 확인되지 않았다.

정확한 표현은 “증분 동기화 기능은 구현되어 있으나, 현재 운영 자동 실행은 배포되지 않았고 수동 명령이 필요하다”이다.

### 15.4 서버 재시작

Qdrant payload/vector update 후 챗봇 API 재시작은 필요 없다. Router가 매 질문마다 Qdrant를 조회하기 때문이다. 단, 코드 변경이나 Vercel 환경변수 변경은 새 process/deployment가 필요하다.

## 16. 의료 Safety 최신 상태

Safety Gate는 IntentAwareAnswerService의 첫 단계에서 실행되며 차단되면 Qdrant, Embedding, Generate를 호출하지 않는다.

### 16.1 요청된 실질의

| 질문 | 실제 Path | Retrieval | Embedding | Generate | 판정 |
|---|---|---:|---:|---:|---|
| 이 검사 결과면 무슨 병이에요? | BLOCKED | 0 | 0 | 0 | 정상 차단 |
| 어떤 약 먹어야 해? | BLOCKED | 0 | 0 | 0 | 정상 차단 |
| ALT 높으면 어떤 검사를 받아야 해? | EXACT | 1 | 0 | 0 | **차단 실패** |
| 16290 소요일 알려줘 | STRUCTURED | 1 | 0 | 0 | 정상 정보 조회 |

“ALT 높으면 어떤 검사를 받아야 해?”는 개인 결과 기반 검사 추천 의도가 있지만 현재 정규식이 “높으면”과 이 어순을 충분히 포착하지 못해 ALT exact 결과를 반환했다. 이는 보고서에 해결됨으로 적으면 안 되는 현재 safety gap이다.

### 16.2 출력 안전

Generate를 쓰는 설명 질문에는 별도의 출력 검증이 있다. 검색 문서에 없는 sourceId, evidence, URL, 수치와 위험한 진단·치료 문구를 거부한다. 이 검증은 hallucination을 줄이지만, 12절처럼 정상 응답을 과도하게 거부할 수도 있다.

### 16.3 평가

의료 안전 장치가 존재하고 대표적인 결과 해석·약물 질문은 retrieval 전에 차단한다. 그러나 regex 기반이므로 모든 한국어 어순과 표현을 포괄하지 않는다. 실무 적용 전 safety test corpus 확대와 실패 시 안전 fallback이 필요하다.

## 17. 테스트 최신 실행

조사일 2026-09-13에 실제 실행한 결과다.

| 명령 | 결과 | 상세 |
|---|---|---|
| npm test | 성공 | 73 total, 72 pass, 1 Qdrant opt-in skip, 0 fail |
| RUN_QDRANT_INTEGRATION=true npm test | 실패 | 73 total, 72 pass, 1 fail |
| npm run test:e2e | 성공 | 11/11 pass |
| npm run build | 성공 | Vite production build |
| npm run integration:validate | 실패 | stale health field 기대값 |
| npm run crawl:validate | 성공 | 3,327 records, 누락/invalid URL 0 |
| npm run crawl:validate:details | 성공 | 3,326 success, 1 failure, complete=false |
| npm run rag:knowledge:validate | 성공 | 3,327 docs, invalid 0 |
| npm run rag:index:validate | 성공 | 3,327 vectors, 768D, stale hash 0 |
| npm run qdrant:health | 성공 | connected, collection 3,327 |

### 17.1 실 Qdrant test 실패 원인

health, 16290/11380 code exact, ALT name exact까지는 성공했다. 마지막 findByInsuranceCodes가 normalizedInsuranceCodes 미반영 Cloud collection을 조회해 Bad Request로 실패했다.

이는 코드 unit 실패가 아니라 **working tree schema와 실제 Cloud DB schema의 배포 순서 불일치**다.

### 17.2 E2E 범위

E2E 11개는 UI, loading, 검사 카드, 출처, 이미지/PDF mock, keyboard, semantic 결과 표시, 보험코드 결과 표시, clarification, error/retry, degraded health, mobile layout을 검증한다.

그러나 /api/health와 /api/chatbot/interpret를 Playwright route로 mock한다. 따라서 E2E 통과는 실제 Qdrant/Gemini 연결 성공을 뜻하지 않는다.

### 17.3 Build

- Vite 8.2.1
- 24 modules transformed
- dist/index.html 0.52 kB
- CSS 15.10 kB, gzip 4.21 kB
- JS 204.08 kB, gzip 64.91 kB
- build time 313ms

### 17.4 integration:validate 실패

현재 health는 services.pointCount를 반환하지만 validate-frontend-integration.mjs는 services.knowledgeDocuments===3327을 기대한다. 이 stale contract 때문에 “Vite proxy health 응답의 지식 문서 수가 올바르지 않습니다”로 실패한다.

## 18. Benchmark 최신 실행

npm run benchmark:queries를 Cloud Qdrant와 Gemini 설정이 있는 새 로컬 API process에 대해 path별 3회 실행했다.

| Path | Iterations | 평균 | 최소 | 최대 |
|---|---:|---:|---:|---:|
| EXACT | 3 | 372.917ms | 212.367ms | 683.537ms |
| STRUCTURED | 3 | 219.465ms | 214.614ms | 225.977ms |
| COMPARISON | 3 | 217.394ms | 210.642ms | 222.783ms |
| VECTOR | 3 | 884.567ms | 812.870ms | 1,012.785ms |

총 12회 중 embeddingCalls=3, generationCalls=0이다.

- Embedding bypass: 9/12, 75%
- Generation bypass: 12/12, 100%
- 이 benchmark의 VECTOR 질문은 SEARCH intent이므로 Generate를 측정하지 않는다.
- 표본이 path당 3회뿐이므로 p95/p99나 동시접속 성능으로 해석할 수 없다.

ALT 별도 5회 측정:

| 질문 | Path | 평균 | 최소 | 최대 |
|---|---|---:|---:|---:|
| ALT 검사 알려줘 | EXACT | 367.910ms | 229.066ms | 885.211ms |
| ALT 검사는 어떤 검체를 사용하나요? | STRUCTURED | 236.788ms | 228.483ms | 243.714ms |

## 19. 실제 질문 테스트 세트

| 질문 | Path/상태 | 결과 요약 | Embedding | Generate |
|---|---|---|---:|---:|
| 16290 검사 알려줘 | EXACT | α-Galactosidase (GLA)_Fabry | 0 | 0 |
| ALT 검사 알려줘 | EXACT | ALT, 10130 | 0 | 0 |
| ALT 검사는 어떤 검체를 사용하나요? | STRUCTURED | Serum | 0 | 0 |
| ALT를 검사하려면 어떤 검체가 필요한가요? | STRUCTURED | Serum | 0 | 0 |
| ALT의 소요일은 며칠인가요? | STRUCTURED | 1일 | 0 | 0 |
| ALT 검사방법 알려줘 | STRUCTURED | Enzymatic method | 0 | 0 |
| AST와 ALT 중 어떤 검사가 더 빨리 나오나요? | COMPARISON | 둘 다 1일 | 0 | 0 |
| 16290이랑 11380 중 뭐가 빨라? | COMPARISON | 16290 5일, 11380 30일 | 0 | 0 |
| 파브리병 관련 검사 알려줘 | VECTOR | 관련 검사 5건 | 1 | 0 |
| 효소 결핍 질환 관련 검사를 찾아줘 | VECTOR | 관련 검사 5건 | 1 | 0 |
| 16290 검사 자세히 설명해줘 | HTTP 500 | evidence validation 거부 | 0 | 1 시도 |
| 이 검사 결과면 무슨 병이에요? | BLOCKED | 의료진 상담 안내 | 0 | 0 |
| ALT 높으면 어떤 검사를 받아야 해? | EXACT | ALT 정보 반환, safety 누락 | 0 | 0 |
| 존재하지않는검사XYZ 알려줘 | NO_RESULT | 일치 항목 없음 | 1 | 0 |

## 20. Preview / Production 최신 상태

### 20.1 Project

로컬 .vercel/project.json에는 projectName scl-rag-chatbot과 project/org ID가 있다. ID 값은 운영상 불필요하므로 보고서 본문에 반복하지 않는다.

### 20.2 Preview

현재 대화에서 사용한 Preview 후보:

- https://scl-rag-chatbot-246u1205c-gunsoo0920.vercel.app
- 과거 문서의 Preview: https://scl-rag-chatbot-1du1267ac-gunsoo0920.vercel.app

2026-09-13 16:53 KST에 인증 없이 HEAD 요청한 결과 두 URL 모두 HTTP 302로 Vercel SSO에 redirect됐다.

- Deployment가 존재하는 것은 확인
- Vercel Authentication 보호가 켜진 것은 확인
- 로그인하지 않은 일반 사용자의 직접 접근은 불가능
- 현재 deployment Ready 여부와 배포 commit은 Vercel CLI 인증 확인을 완료하지 못해 미확인
- 현재 working tree의 보험코드 검색 변경은 미커밋이므로 위 Preview에 반영됐다고 볼 수 없음

### 20.3 Production

https://scl-rag-chatbot.vercel.app 후보는 같은 시각 HTTP 404 DEPLOYMENT_NOT_FOUND였다.

- Production deployment: 확인되지 않음
- Production URL: 확인되지 않음
- Production 전용 환경변수: 미확인
- Production 전용 Qdrant: 확인되지 않음

따라서 현재 상태를 “Production 배포 완료”라고 표현하면 안 된다.

### 20.4 API health와 환경변수

Preview /api/health는 익명 요청이 SSO로 redirect되어 JSON health를 확인하지 못했다. 로컬 .env는 Cloud Qdrant key와 Gemini key가 설정된 상태이며 값은 출력하지 않았다.

현재 local 확인:

- QDRANT_URL: Cloud HTTPS target
- QDRANT_API_KEY: configured
- QDRANT_COLLECTION: scl_tests
- GEMINI_API_KEY: configured
- GEMINI_MODEL: gemini-3.1-flash-lite
- GEMINI_EMBEDDING_MODEL: gemini-embedding-001
- GEMINI_EMBEDDING_DIMENSION: 768

Vercel 환경변수의 현재 scope와 값 존재 여부는 이번 조사에서 재인증하지 못했으므로 미확인으로 둔다.

### 20.5 Scheduled sync

Preview/Production 모두 scheduled sync 배포 증거가 없다. Vercel Function은 요청 응답용이며 crawler scheduler를 시작하지 않는다.

## 21. 운영상 남은 문제

1. **Qdrant free cluster suspend**: 비활성화 후 자동 suspend되면 exact 질문도 전부 500이 된다.
2. **DB schema migration 미완료**: working tree의 normalizedInsuranceCodes가 Cloud에 없어 보험코드 실조회가 Bad Request다.
3. **배포 drift**: HEAD, dirty working tree, Preview revision이 서로 다를 수 있다.
4. **앱 인증 없음**: Vercel SSO 보호는 있지만 서비스 자체 사용자·권한 모델은 없다.
5. **공개 접근 불가**: Preview URL은 302 SSO이며 일반 사용자가 바로 접속할 수 없다.
6. **API rate limit 없음**: 요청 횟수 제한, 사용자별 quota, abuse 방어가 없다.
7. **health/readiness 부족**: degraded여도 HTTP 200이고 세부 원인·latency·Gemini 실제 호출 가능성은 확인하지 않는다.
8. **Metrics 비영속**: process 메모리라 serverless instance별로 분리되고 재시작 시 사라진다.
9. **자동 sync 없음**: 기능만 구현됐고 주기 실행은 배포되지 않았다.
10. **Safety regex 누락**: “ALT 높으면 어떤 검사를 받아야 해?”가 차단되지 않는다.
11. **Analyzer 첫 이름 잡음**: exact 후보는 성공하지만 대표 testName이 깔끔하지 않다.
12. **Generate 정상응답 거부**: strict evidence substring 검사로 설명 질문이 500이 될 수 있다.
13. **Generic 500**: UI에는 request ID와 내부 원인이 노출되지 않아 운영 진단이 어렵다.
14. **Stale integration validator**: 현재 health contract와 맞지 않아 통합 명령이 실패한다.
15. **실부하 검증 없음**: 동시접속, 장시간, p95/p99, 장애 복구 시험이 없다.
16. **E2E mock 의존**: 실제 Cloud 장애와 quota 문제는 E2E가 발견하지 못한다.
17. **데이터 최신성**: 원천 snapshot이 2026-08-09이며 이후 자동 crawl 증거가 없다.
18. **상세 1건 실패**: 전체 상세 수집 완료가 아니다.

## 22. 기술 Stack 최신 목록

현재 설치 결과를 기준으로 한다.

| 구분 | 기술 | 버전/설정 |
|---|---|---|
| Runtime | Node.js | 22.19.0 |
| Package manager | npm | 10.9.3 |
| Frontend | React | 19.2.8 installed |
| Frontend | react-dom | 19.2.8 installed |
| Build | Vite | 8.2.1 |
| Build plugin | @vitejs/plugin-react | 6.0.5 |
| Backend | Node http + Vercel Functions | 별도 web framework 없음 |
| Vector DB client | @qdrant/js-client-rest | 1.19.0 |
| Vector DB | Qdrant Cloud | 768D Cosine, collection scl_tests |
| AI Embedding | Google Generative Language REST | gemini-embedding-001 |
| AI Generate | Google Generative Language REST | gemini-3.1-flash-lite 설정 |
| Parser | cheerio | 1.1.2 |
| Test | node:test | Node 내장 |
| E2E | @playwright/test | 1.62.1 |
| Deployment | Vercel | Preview 후보 존재, Production 미확인 |
| Data | JSON snapshots | raw/processed/knowledge |

package.json의 React 범위는 ^19.1.1이지만 현재 node_modules와 lockfile 해석 결과는 19.2.8이다.

## 23. 현재 프로젝트 핵심 강점

다음은 현재 코드와 실행으로 확인된 강점이다.

1. exact 검사코드와 검사명은 LLM 없이 Qdrant payload로 찾는다.
2. structured 검체·검사방법·소요일 응답도 LLM 없이 저장값으로 만든다.
3. 두 검사코드와 두 검사명의 소요일 비교를 deterministic하게 처리한다.
4. semantic SEARCH는 Generate를 생략해 생성형 오류 범위를 줄였다.
5. exact 실패 때만 query embedding을 쓰는 hybrid 흐름이다.
6. Qdrant point에 vector와 구조화 payload를 함께 저장한다.
7. contentHash와 payloadHash로 의미 변경만 재Embedding할 수 있다.
8. Qdrant를 요청마다 조회해 DB update 후 server restart가 필요 없다.
9. 의료 조언을 retrieval 전에 차단하는 경로가 있다.
10. sourceId·evidence·공식 URL·수치를 서버에서 검증한다.
11. 3,327개 목록/knowledge와 3,220개 이미지 resource가 validator를 통과한다.
12. Preview용 Vercel Functions와 health/stats endpoint가 구현돼 있다.

## 24. 현재 프로젝트 핵심 한계

1. HEAD 이후 코드가 14개 파일에 미커밋 상태다.
2. 보험코드 역검색 코드는 Cloud Qdrant와 배포에 미반영이다.
3. 실 Qdrant integration 전체 통과 상태가 아니다.
4. integration:validate가 stale contract로 실패한다.
5. 설명형 Generate가 strict evidence 검증에서 500으로 실패했다.
6. Safety Gate가 일부 한국어 추천 어순을 놓친다.
7. exact 후보 추출은 동작하지만 대표 testName 문자열은 여전히 noisy하다.
8. Preview는 Vercel SSO 보호로 외부 공개 상태가 아니다.
9. Production 배포와 Production 전용 DB는 확인되지 않았다.
10. 자동 crawl/sync가 운영에 배포되지 않았다.
11. metrics가 메모리 기반이고 통합 모니터링·alert가 없다.
12. rate limit과 사용자 인증·감사 로그가 없다.
13. snapshot이 2026-08-09 이후 자동 최신화됐다는 증거가 없다.
14. 상세 데이터 1건이 실패 상태다.
15. 검색 정확도 평가용 정답셋, recall/precision, 의료 도메인 검수 기록이 없다.
16. 동시 사용자 부하와 p95/p99를 검증하지 않았다.

## 25. Troubleshooting 근거

### 25.1 ALT 조사·서술어 때문에 exact 실패

- 문제: “ALT 검사는 어떤 검체를 사용하나요?”가 문장형 이름으로 남아 vector fallback 가능
- 원인: 한 개의 대표 문자열 추출과 문장 위치 의존
- 해결: 영문 토큰 보존, attached particle 제거, 연속 후보 생성, Qdrant batch exact
- 결과: 실제 STRUCTURED, code 10130, Embedding/Generate 0
- 잔여: entity.testName 첫 값에는 잡음이 남음

### 25.2 ALT 질문에서 AST 등 유사 검사 개입

- 문제: exact 실패 후 vector top candidates에 AST 등 다른 영문 검사 가능
- 원인: embedding score만으로 짧은 영문 검사명을 구분하기 어려움
- 해결: exact name 최우선, informative token·edit distance·anchor 기반 reranker
- 결과: ALT exact는 10130 한 건이며 AST 미출력
- 잔여: “ALT 특채”와 “ALT(특채)” 결과가 달라지는 표현 일관성 문제

### 25.3 넓은 범주어에 임의 한 건 반환

- 문제: “특검 검사”처럼 후보가 많은 표현에서 vector 1위를 단정
- 원인: 사용자 의도가 특정 검사인지 범주 목록인지 구분 부족
- 해결: ambiguousCategoryTerm, CLARIFICATION path
- 결과: unit test에서 여러 후보일 때 검사명 일부 또는 코드를 요구
- 잔여: 실제 전체 자연어 범주셋 평가는 없음

### 25.4 로컬 vector-index에서 Qdrant로 전환

- 문제: local JSON index를 process memory에서 순회하면 배포 동기화와 갱신 반영이 번거로움
- 원인: vector와 metadata가 파일에 묶이고 process 시작 때 로드
- 해결: Qdrant vector+payload, keyword indexes, query API
- 결과: Cloud collection 3,327 points, exact/vector 실조회 성공
- 잔여: free cluster suspend와 외부 네트워크 의존

### 25.5 데이터 변경 후 server restart

- 문제: 파일 기반 runtime은 새 index를 다시 로드해야 함
- 해결: Qdrant를 질문마다 조회하고 sync가 upsert/setPayload
- 결과: DB update 자체는 API restart 없이 다음 요청에 반영
- 잔여: 코드·환경변수 변경은 재배포 필요

### 25.6 의료 질문의 LLM 진입

- 문제: 개인 결과 해석·약물 질문이 검색/생성으로 들어갈 위험
- 해결: evaluateSafety를 analyzer/router 앞에서 실행
- 결과: 대표 결과 해석·약물 질문은 호출 0으로 BLOCKED
- 잔여: “ALT 높으면 어떤 검사를 받아야 해?” 차단 누락

### 25.7 Grounding 안전과 가용성 충돌

- 문제: 모델 evidence가 원문과 정확히 같지 않으면 답변 신뢰성 저하
- 해결: 연속 substring validation
- 결과: 허위 또는 변형 인용 차단
- 잔여: 정상 설명도 500으로 실패할 수 있어 안전 fallback 필요

### 25.8 stale integration validation

- 문제: integration:validate 실패
- 원인: 과거 services.knowledgeDocuments 필드를 계속 기대
- 현재 health: pointCount, vectorDimension, qdrantConnected, collectionExists
- 결과: 미해결

### 25.9 급여·비급여 코드 역검색

- 문제: payload에 insuranceCode는 있었지만 역방향 exact lookup이 없음
- 해결 중: 정규화·alias, analyzer 분리, Qdrant index/filter, payload batch update 추가
- unit/E2E: 통과
- 실제 Cloud: normalizedInsuranceCodes 미반영으로 Bad Request
- 판정: 구현 완료가 아니라 migration 전

## 26. 기존 REPORT_SOURCE와 차이

| 항목 | 기존 REPORT_SOURCE | 현재 상태 | 변경 |
|---|---|---|---|
| 조사 HEAD | f92abaf 기준, 이후 a14d47b 추가 확인 | 45e4c716 전체 hash | 변경 |
| Working tree | tracking과 동기화 중심 | 수정 파일 14개, 170+/20- | 중요 변경 |
| Node test | 57 total, 56 pass, 1 skip | 73 total, 72 pass, 1 skip | 테스트 16개 증가 |
| 실 Qdrant test | 1/1 pass | 72 pass, 보험코드 1 fail | 회귀 있음 |
| E2E | 8/8 | 11/11 | 3개 증가 |
| Benchmark EXACT | 411.863ms | 372.917ms | 현재 3회 표본으로 변경 |
| Benchmark STRUCTURED | 242.748ms | 219.465ms | 변경 |
| Benchmark COMPARISON | 242.655ms | 217.394ms | 변경 |
| Benchmark VECTOR | 909.381ms | 884.567ms | 변경 |
| Qdrant | 3,327 points | green, 3,327, 768D Cosine | 수 동일, 상태 재확인 |
| Qdrant suspend | 주요 현재 장애 아님 | 조사 중 SUSPENDED 후 Reactivate | 새 운영 이슈 |
| ALT exact | a14d47b 이후 6문항 exact 검증 | HEAD semantic reranker 포함, 실 ALT 재검증 | 보강 |
| 결과 표시 | semantic 목록 중심 | RESULTS_ONLY와 개수 문구 제거 | 변경 |
| 모호성 | 명시 경로 없음 | CLARIFICATION path/counter | 추가 |
| 보험코드 역검색 | 없음 | working tree 구현, Cloud 미반영 | 추가·미완료 |
| Payload index | 6개 | Cloud 6개, 코드에는 7번째 예정 | schema drift |
| Generate | EXPLANATION만 | 동일하지만 실제 evidence 500 재현 | 실패 증거 추가 |
| Safety | 대표 regex 차단 | 추천 어순 1개 누락 확인 | 한계 추가 |
| Preview URL | 1du... | 246...도 존재, 둘 다 302 SSO | 변경·보호 유지 |
| Production | 미확인 | alias 404, 여전히 미확인 | 변화 없음 |
| scheduled sync | 없음 | 여전히 없음 | 변화 없음 |
| integration validate | stale 실패 | 같은 원인으로 실패 | 미해결 |
| Gemini model | gemini-3.1-flash-lite | 동일 설정 확인 | 변화 없음 |

## 27. 보고서에 사용 가능한 최신 수치

| 값 | 최신 수치 | 확인 방법 | 확인일 |
|---|---:|---|---|
| Git HEAD | 45e4c71622194779aaadbc153101cb41b4ad68e7 | git rev-parse HEAD | 2026-09-13 |
| 미커밋 파일 | 14 | git status --short | 2026-09-13 |
| 목록 records | 3,327 | JSON + crawl validator | 2026-09-13 |
| 상세 성공/실패 | 3,326 / 1 | detail JSON + validator | 2026-09-13 |
| Processed/Knowledge | 3,327 / 3,327 | JSON + validator | 2026-09-13 |
| 이미지/PDF URL | 3,220 / 0 | knowledge 직접 집계 | 2026-09-13 |
| Qdrant points | 3,327 | Cloud health/getCollection | 2026-09-13 |
| Vector | 768D Cosine | Cloud getCollection | 2026-09-13 |
| Cloud payload indexes | 6 | payload_schema 직접 조회 | 2026-09-13 |
| Node 기본 test | 73 total, 72 pass, 1 skip | npm test | 2026-09-13 |
| 실 Qdrant test | 72 pass, 1 fail | opt-in npm test | 2026-09-13 |
| E2E | 11/11 | npm run test:e2e | 2026-09-13 |
| Build | success | npm run build | 2026-09-13 |
| integration validate | fail | npm run integration:validate | 2026-09-13 |
| Benchmark 평균 | 372.917 / 219.465 / 217.394 / 884.567ms | path별 3회 | 2026-09-13 |
| ALT exact 평균 | 367.910ms | 5회 실질의 | 2026-09-13 |
| ALT 검체 평균 | 236.788ms | 5회 실질의 | 2026-09-13 |
| Preview 익명 접근 | HTTP 302 SSO | curl HEAD | 2026-09-13 |
| Production alias 후보 | HTTP 404 | curl HEAD | 2026-09-13 |

## 28. 보고서에서 피해야 할 표현

| 부정확한 표현 | 현재 근거에 맞는 표현 |
|---|---|
| 완전한 실시간 데이터 | 수동 crawl/sync 시 Qdrant를 증분 갱신한다. 자동 scheduler는 배포되지 않았다. |
| 모든 테스트 통과 | 기본 Node 72 pass/1 skip, E2E 11 pass, build 성공이지만 실 Qdrant insurance test와 integration validator는 실패했다. |
| Production 배포 완료 | 인증 보호된 Vercel Preview 후보가 존재하며 Production alias 후보는 404다. |
| 누구나 링크로 접속 가능 | Preview는 인증 없는 접근 시 Vercel SSO로 redirect된다. |
| AI가 모든 답변 생성 | 코드가 exact/structured/comparison/일반 semantic 응답을 만들고 EXPLANATION만 Generate를 사용한다. |
| AI 호출이 전혀 없음 | semantic은 Embedding, explanation은 Generate를 조건부 사용한다. |
| hallucination이 없음 | grounding validator로 위험을 낮추지만 완전 제거를 증명하지 않았고 정상 설명 거부도 발생했다. |
| 모든 자연어를 이해 | regex/alias/candidate/reranker로 정의된 표현을 처리하며 일부 어순·오타는 다르게 동작한다. |
| 의료 질문 완전 차단 | 대표 결과 해석·약물 질문은 차단하지만 일부 추천 어순은 누락된다. |
| 급여·비급여 코드 검색 완료 | working tree 구현과 mock/unit은 완료됐지만 Cloud payload/index migration과 배포 전이다. |
| DB 구축 완전 완료 | Cloud Qdrant 3,327 points는 있으나 무료 cluster suspend와 schema drift를 관리해야 한다. |
| 상세정보 전부 수집 | 3,327개 중 상세 3,326개 성공, 1개 실패다. |
| 성능 검증 완료 | path별 3회와 ALT 5회 표본만 있으며 동시부하·p95/p99는 미검증이다. |

## 29. Mermaid Runtime Pipeline

~~~mermaid
flowchart LR
    U[사용자] --> UI[React Chatbot]
    UI -->|POST /api/chatbot/interpret| API[Vercel 또는 Node API]
    API --> SAFE{Safety Gate}
    SAFE -->|의료 조언| BLOCK[BLOCKED 결정 응답]
    SAFE -->|허용| QA[Query Analyzer]

    QA --> IC{보험코드 후보?}
    IC -->|예: D517205KZ| IF[Qdrant normalizedInsuranceCodes filter]
    IF -. Cloud migration 전 .-> DB[(Qdrant Cloud)]

    IC -->|없음| TC{SCL 검사코드?}
    TC -->|예: 16290| TF[Qdrant testCode filter]
    TC -->|없음| NC[검사명 후보 최대 128개]
    NC --> NF[Qdrant normalizedTestName batch filter]

    TF --> DB
    NF --> DB
    DB --> MATCH{Exact 문서 있음?}

    MATCH -->|예 + field| STRUCT[STRUCTURED deterministic]
    MATCH -->|예 + comparison| COMP[COMPARISON deterministic]
    MATCH -->|예 + search| EXACT[EXACT deterministic]
    MATCH -->|예 + explanation| GEN[Gemini Generate]

    MATCH -->|아니오| EMB[Gemini Embedding<br/>RETRIEVAL_QUERY 768D]
    EMB --> VQ[Qdrant Cosine vector query<br/>Top-K 5]
    VQ --> AMB{범주가 모호함?}
    AMB -->|예| CLAR[CLARIFICATION]
    AMB -->|아니오| TH[0.60 threshold + name rerank]
    TH -->|결과 없음| NR[NO_RESULT]
    TH -->|SEARCH| VECTOR[VECTOR deterministic]
    TH -->|EXPLANATION| GEN

    GEN --> VALID[Grounding + Safety Validator]
    VALID -->|통과| RESP[검사 카드·공식 출처 응답]
    VALID -->|실패| ERR[HTTP 500 generic error]
    BLOCK --> UI
    STRUCT --> RESP
    COMP --> RESP
    EXACT --> RESP
    VECTOR --> RESP
    CLAR --> UI
    NR --> UI
    RESP --> UI
~~~

## 30. Mermaid Data Update Pipeline

~~~mermaid
flowchart LR
    TRIGGER[관리자 수동 명령<br/>현재 자동 Cron 없음] --> LIST[SCL 목록 crawl]
    LIST --> LR[data/raw/scl-tests-raw.json]
    LR --> DETAIL[SCL 상세 crawl/refresh]
    DETAIL --> DR[data/raw/scl-test-details-raw.json]
    DETAIL --> FAIL[data/raw/scl-test-details-failures.json]

    DR --> BUILD[build-scl-test-knowledge]
    FAIL --> BUILD
    LR --> BUILD
    BUILD --> PROC[data/processed/scl-tests.json]
    BUILD --> KNOW[knowledge/scl-tests.json<br/>3,327 documents]

    KNOW --> SYNC[syncDocuments]
    SYNC --> DIFF{기존 Qdrant와 hash 비교}
    DIFF -->|신규| NEW[legacy vector 재사용<br/>또는 document embedding]
    DIFF -->|contentHash 변경| REEMBED[Gemini document embedding]
    DIFF -->|payloadHash만 변경| PAYLOAD[payload batch update]
    DIFF -->|동일| SAME[unchanged]
    DIFF -->|누락 + failures=0<br/>coverage 80% 이상| OFF[active=false]

    NEW --> UPSERT[Qdrant upsert batch 100]
    REEMBED --> UPSERT
    PAYLOAD --> DB[(Qdrant scl_tests)]
    UPSERT --> DB
    OFF --> DB
    DB --> NEXT[다음 챗봇 요청부터 즉시 조회<br/>API 재시작 불필요]

    LOCAL_SCHED[로컬 interval scheduler 코드] -. SCL_SYNC_ENABLED=false .-> TRIGGER
    VERCEL[Vercel Functions] -. scheduler 호출 안 함 .-> TRIGGER
~~~

---

## 최종 판정

현재 프로젝트는 Qdrant 기반 exact/structured/comparison과 선택적 semantic embedding을 실제로 동작시키며, ALT 조사·어순 질문은 Cloud 실질의에서 AST 혼입 없이 10130으로 처리됐다. 데이터 validator, 기본 Node test, E2E, build도 통과했다.

그러나 현재 상태는 Production-ready 완료가 아니다. 보험코드 검색의 Cloud schema migration, 실 Qdrant integration 실패, stale integration validator, 설명형 Generate 500, Safety Gate 누락 표현, Preview SSO, 자동 sync 부재, 미커밋 14개 파일을 먼저 해결해야 한다.

가장 정확한 한 줄 설명은 다음과 같다.

> SCL 공개 검사정보 3,327건을 Qdrant payload와 vector로 검색하는 Hybrid RAG Preview이며, 정확 조회는 AI를 우회하고 의미 검색에만 Embedding을 사용한다. 다만 현재 변경분은 일부 미배포 상태이고 운영·안전·통합 검증 과제가 남아 있다.
