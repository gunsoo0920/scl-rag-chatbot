# SCL RAG 안내 챗봇

SCL 공개 검사항목 3,327개의 목록·상세 수집, RAG 지식 변환, Hybrid Retrieval, grounded 답변 검증, Node API와 React 챗봇 화면이 구현되어 있습니다. Gemini 벡터 인덱스 생성과 실제 답변 호출에는 API 키가 필요합니다.

## 실행

프로젝트를 처음 내려받은 뒤 패키지를 설치하면 `.env.example`을 사용해 로컬 `.env`가 자동 생성됩니다. 기존 `.env`는 덮어쓰지 않습니다.

```powershell
npm install
```

전체 AI 답변과 의미 기반 검색을 사용할 팀원은 생성된 `.env`에 본인의 서버 전용 Gemini API 키를 입력합니다. 실제 `.env`와 API 키는 Git에 올리지 않습니다. 키가 없어도 서버, 화면, 정확한 검사코드 검색과 테스트는 제한 모드로 실행됩니다.

```powershell
# 터미널 1
npm run chatbot:server

# 터미널 2
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. 환경 파일만 다시 준비하려면 `npm run setup:env`를 실행할 수 있습니다.

## 데이터 수집

```bash
npm run crawl:scl
npm run crawl:validate
```

`npm run crawl:scl`은 첫 페이지에서 현재 마지막 페이지와 총건수를 읽은 뒤 전체 검사항목을 순차적으로 요청합니다. 동시 요청 없이 페이지 사이에 기본 1초 간격을 두며, 전체 수집과 검증이 끝나기 전에는 기존 결과를 교체하지 않습니다.

1~3페이지만 다시 확인하려면 다음 명령을 사용합니다.

```bash
npm run crawl:scl:sample
```

대표 검사항목의 상세 페이지 파서와 이미지 추출을 확인하려면 다음 명령을 사용합니다.

```bash
npm run crawl:scl:details:sample
npm run crawl:validate:details:sample
```

전체 상세 페이지는 중단 후 재개 가능한 크롤러로 수집합니다.

```bash
npm run crawl:scl:details        # 남은 상세 페이지 전체 수집
npm run crawl:scl:details:batch  # 다음 20건만 수집
npm run crawl:validate:details   # 현재 체크포인트 검증
```

상세 크롤러는 기존 완료 레코드를 건너뛰고 10건마다 원자적 체크포인트를 저장합니다. 실패 항목은 별도 JSON에 기록하며 다음 실행에서 다시 시도합니다. 기본 요청 간격은 1초이고 기본 동시성은 1입니다. 동시 실행으로 체크포인트가 충돌하지 않도록 PID 기반 잠금 파일을 사용하며, 동시성 설정은 최대 2로 제한합니다.

결과는 `data/raw/scl-tests-raw.json`에 저장됩니다. 같은 검사코드라도 검체가 다를 수 있으므로 검사코드, 검사명, 검체 코드, 검체명, 검사방법의 조합으로 안정적인 ID를 생성합니다. 수집 범위와 사이트 총건수, 완료 시각은 `data/raw/scl-tests-crawl-report.json`에 별도로 저장됩니다.

상세 페이지 샘플은 `data/raw/scl-test-details-sample.json`에 저장되며 보존방법, 소요량, 참고치, 임상적 의의, 급여 관련 정보와 검체용기 이미지 URL을 포함합니다.

전체 상세 데이터와 진행 상태는 다음 파일에 저장됩니다.

- `data/raw/scl-test-details-raw.json`
- `data/raw/scl-test-details-failures.json`
- `data/raw/scl-test-details-crawl-report.json`

## RAG 지식 데이터 생성

전체 목록과 상세 데이터를 병합하고 검사항목별 독립 지식 문서를 생성합니다.

```bash
npm run rag:knowledge
npm run rag:knowledge:validate
```

정규화 데이터는 `data/processed/scl-tests.json`, 검색용 지식 문서는 `server/rag/knowledge/scl-tests.json`에 저장됩니다. 키워드는 공식 검사코드, 검사명, 검사방법, 검체명과 공개 코드만 사용하며 사이트에 없는 동의어나 설명을 추가하지 않습니다.

## Gemini 벡터 인덱스 생성

`.env.example`을 `.env`로 복사하고 서버 전용 Gemini API 키를 설정합니다. 키를 프런트엔드 코드에 넣지 마세요.

```bash
Copy-Item .env.example .env
# .env의 GEMINI_API_KEY 값을 설정
npm run rag:index
npm run rag:index:validate
```

기본 모델은 `gemini-embedding-001`, 출력 차원은 768입니다. 문서는 `RETRIEVAL_DOCUMENT`, 이후 검색 질의는 `RETRIEVAL_QUERY`로 임베딩합니다. 768차원 벡터는 L2 정규화한 뒤 `server/rag/index/vector-index.json`에 저장하며 검색에서는 cosine similarity를 사용합니다.

빌더는 무료 티어의 TPM 제한을 고려해 기본 5개 단위, 15초 간격으로 요청하고 각 성공 배치를 `server/rag/index/checkpoints/`에 저장합니다. 429 응답에 `RetryInfo`가 있으면 서버가 지정한 시간만큼 기다리고, 없으면 기본 60초 후 재시도합니다. 실행이 중단돼도 같은 모델·차원·원문이면 완료된 배치를 재사용하며, 지식 문서가 바뀌면 SHA-256 해시로 오래된 벡터를 감지합니다. 배치 크기, 요청 간격, timeout과 재시도 횟수는 `.env`에서 조절할 수 있습니다.

주요 환경변수:

- `GEMINI_API_KEY`: 필수 서버 전용 키
- `GEMINI_EMBEDDING_MODEL`: 기본 `gemini-embedding-001`
- `GEMINI_EMBEDDING_DIMENSION`: 기본 `768`
- `GEMINI_EMBEDDING_BATCH_SIZE`: 무료 티어 권장 `5`
- `GEMINI_EMBEDDING_REQUEST_DELAY_MS`: 무료 티어 권장 `15000`
- `GEMINI_EMBEDDING_BUILD_QUOTA_RETRY_DELAY_MS`: 429 응답의 최소 재시도 대기시간, 기본 `60000`
- `RAG_TOP_K`: 기본 `5`
- `RAG_MIN_SIMILARITY`: 현재 평가값 `0.60` (정상 질의 최저 `0.6643`, 범위 밖 질의 최고 `0.5366`, 평가 중간값 `0.6005`)

임베딩 요청 형식, 정규화, vector dimension, cosine similarity, threshold와 topK 단위 테스트는 다음 명령으로 실행합니다.

```bash
npm test
```

## Hybrid Retrieval

검색은 검사코드 exact match, 검사명 phrase/token match, 공식 keyword match, Gemini embedding cosine similarity를 결합합니다. 검사코드 exact match에는 semantic 점수보다 높은 우선순위를 주며, `ALT`가 `Cobalt`나 `MALToma`의 내부 문자열과 잘못 일치하지 않도록 영문·숫자 경계를 구분합니다.

현재 API 키와 vector index가 없더라도 실제 3,327개 지식 문서를 대상으로 lexical 검색을 확인할 수 있습니다.

```bash
npm run rag:search:smoke
npm run rag:search:smoke -- "10130 검사 알려줘"
npm run rag:search:evaluate
```

API 키와 vector index가 있으면 smoke 명령은 semantic 검색도 실행하고 각 결과의 cosine similarity를 출력합니다. `RAG_MIN_SIMILARITY`가 비어 있으면 평가를 위해 smoke에서만 similarity 필터를 해제하며, 운영 API의 semantic 검색은 평가값을 설정하기 전까지 활성화되지 않습니다.

Semantic 검색은 유효한 vector index와 embedding service가 모두 연결된 경우에만 활성화됩니다. `RAG_MIN_SIMILARITY`는 실제 인덱스로 검색 평가를 마친 뒤 설정해야 하며, 평가값 없이 semantic 검색을 활성화하면 서버가 명확한 오류로 중단합니다.

## Grounded Gemini 답변 생성

답변 생성 기본 모델은 구조화 출력을 지원하는 안정 버전 `gemini-3.1-flash-lite`이며 `GEMINI_MODEL`로 변경할 수 있습니다. 기존 `gemini-2.5-flash-lite`는 신규 사용자에게 제공되지 않으므로 사용하지 않습니다. Gemini에는 검색된 문서만 전달하고 다음 규칙을 적용합니다.

- SCL 참고자료에 없는 검사정보, 진단, 치료 및 복약 정보를 추측하지 않음
- 답변과 실제 사용한 `sourceId`, 원문의 연속된 evidence 구절만 구조화 JSON으로 생성
- evidence가 크롤링된 원문에 실제로 존재하는지 서버에서 검증
- 모델이 반환한 source ID가 검색 결과에 포함됐는지 검증
- 모델이 저장되지 않은 URL을 반환하면 응답 거부
- 출처·검사정보·PDF·이미지는 모델이 아닌 서버가 저장된 SCL 자료에서 조립
- 검색 결과가 없으면 Gemini를 호출하지 않고 범위 밖 응답 반환

실제 Gemini 호출에는 `.env`의 `GEMINI_API_KEY`가 필요하지만, 요청 구조·grounding·위조 URL·원문 evidence·범위 밖 응답은 모의 응답 테스트로 검증할 수 있습니다.

```bash
npm test
```

## Node chatbot API

상시 실행 서버는 별도 데이터베이스 없이 Node.js 서버 하나만 사용합니다.

```bash
npm run chatbot:server
```

기본 주소는 `http://127.0.0.1:3002`이며 다음 API를 제공합니다.

- `GET /api/health`: 지식 문서 수, vector index, semantic 검색, Gemini 생성 상태
- `POST /api/chatbot/interpret`: `{ "question": "ALT 검체는?" }` 요청

```bash
curl http://127.0.0.1:3002/api/health
curl -X POST http://127.0.0.1:3002/api/chatbot/interpret \
  -H "Content-Type: application/json" \
  -d '{"question":"ALT 검사 알려줘"}'
```

API 키가 없어도 서버는 `degraded` 상태로 시작합니다. 범위 밖 질문은 Gemini 호출 없이 응답하고, 검색 자료가 있어 Gemini 생성이 필요한 질문은 `503 GENERATION_UNAVAILABLE`을 반환합니다. API 경계에서는 32KB 본문 제한, 질문 길이 제한, JSON Content-Type, 허용 Origin, 구조화 응답 및 공식 SCL HTTPS URL을 다시 검증합니다.

관련 환경변수:

- `CHATBOT_HOST`: 기본 `127.0.0.1`
- `CHATBOT_PORT`: 기본 `3002`
- `CHATBOT_ALLOWED_ORIGINS`: 기본 Vite 개발 서버의 localhost/127.0.0.1 포트 5173

## React 챗봇 화면

두 개의 터미널에서 Node chatbot API와 Vite 프런트엔드를 실행합니다.

```bash
# 터미널 1
npm run chatbot:server

# 터미널 2
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. Vite 개발 서버는 `/api` 요청을 `127.0.0.1:3002`로 전달합니다. 다른 API 주소를 사용할 때만 `VITE_CHATBOT_API_URL`을 설정합니다. `VITE_` 환경변수는 브라우저 번들에 포함되므로 API 키를 넣으면 안 됩니다.

화면은 Enter 전송, Shift+Enter 줄바꿈, loading, 오류와 재시도, 자동 스크롤, 관련 검사 카드, 공식 출처 링크, PDF와 이미지 미리보기, 모바일 레이아웃을 지원합니다.

```bash
npm run build
npm run preview
```

프런트엔드 진입 페이지, Vite API proxy, Node health, 키 없는 범위 밖 응답과 생성 서비스 503 경로를 한 번에 검증하려면 다음 명령을 사용합니다. 검증기는 사용 가능한 임시 포트에서 두 서버를 실행하고 완료 후 종료합니다.

```bash
npm run integration:validate
```

## Playwright E2E

E2E 테스트는 실제 Vite 화면을 열고 API 요청을 브라우저에서 모의하여 API 키 없이 재현 가능하게 실행합니다. Windows에서는 설치된 Microsoft Edge를 사용하고, 그 외 환경에서는 Playwright Chromium을 사용합니다.

```bash
npm run test:e2e
```

검증 범위:

- 초기 화면과 서버 상태
- 질문 입력, Enter 전송, Shift+Enter 줄바꿈
- loading과 자동 스크롤
- 답변, 관련 검사, 공식 출처, 이미지와 PDF
- 범위 밖 질문
- API 오류와 다시 시도
- 모바일 레이아웃과 가로 스크롤 방지

Edge 대신 다른 Playwright 채널을 사용하려면 `PLAYWRIGHT_BROWSER_CHANNEL`을 설정합니다. Chromium이 설치되지 않은 환경에서는 먼저 `npx playwright install chromium`을 실행합니다.

네트워크 없이 실제 DOM 구조의 회귀 픽스처로 파서와 저장 경로만 확인하려면 다음 명령을 사용할 수 있습니다.

```bash
npm run test:parser
```

온라인 수집 레코드는 `captureMode: "live"`, 회귀 픽스처 검증 결과는 `captureMode: "fixture"`로 구분됩니다.

## 데이터 출처

- 목록: <https://www.scllab.co.kr/front/check/check_item_list.do>
- 상세: `https://www.scllab.co.kr/front/check/check_item_detail.do?itemcode={검사코드}&sampcode={검체코드}`

공개 HTML의 `tr[onclick*="fnActExamView"]` 행과 실제 `fnActExamView(itemcode, sampcode)` 호출값을 사용합니다.
