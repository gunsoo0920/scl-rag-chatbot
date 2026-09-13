# SCL RAG 챗봇 트러블슈팅

이 문서는 현재 Qdrant Cloud, Gemini, Vercel Preview 구조를 기준으로 한다. 실제 API 키나 토큰은 문서, 이슈, 로그, 스크린샷에 기록하지 않는다.

## 1. 빠른 진단 순서

1. npm run qdrant:health
2. npm test
3. npm run build
4. 로컬이면 npm run chatbot:server 실행 여부 확인
5. Vercel이면 /api/health 응답 확인
6. Vercel Logs에서 request ID와 4xx/5xx 확인

정상 health 기준:

- status=ok
- qdrantConnected=true
- collectionExists=true
- collection=scl_tests
- pointCount=3327
- vectorDimension=768
- embeddingConfigured=true
- generationAvailable=true

## 2. .env 파일이 보이지 않음

실제 로컬 설정 파일 위치:

    C:\Users\User\Desktop\ai_chatbot\.env

PowerShell에서 다음처럼 연다.

    notepad "C:\Users\User\Desktop\ai_chatbot\.env"

.env는 Git에서 제외되어 있으므로 저장소에서 보이지 않는 것이 정상이다. 새 환경에서는 다음 명령으로 기본 파일을 준비할 수 있다.

    npm run setup:env

## 3. 필수 환경변수

로컬 .env와 Vercel Preview에 다음 항목이 필요하다.

- GEMINI_API_KEY
- GEMINI_MODEL=gemini-3.1-flash-lite
- GEMINI_EMBEDDING_MODEL=gemini-embedding-001
- GEMINI_EMBEDDING_DIMENSION=768
- QDRANT_URL
- QDRANT_API_KEY
- QDRANT_COLLECTION=scl_tests

실제 값은 .env.example에 넣지 않는다. Vercel에서는 GEMINI_API_KEY와 QDRANT_API_KEY를 Sensitive/Secret으로 등록한다.

## 4. Qdrant 연결 실패

증상:

- qdrantConnected=false
- fetch failed
- 챗봇 API INTERNAL_ERROR

확인:

1. QDRANT_URL이 Cluster ID가 아니라 전체 Cluster Endpoint인지 확인
2. 주소 앞에 https://가 포함됐는지 확인
3. QDRANT_API_KEY가 Feed token이나 Management key가 아니라 Cluster API Key인지 확인
4. 스크린샷에 노출된 키를 사용하지 않았는지 확인
5. Qdrant Console에서 cluster가 HEALTHY인지 확인

연결 검사:

    npm run qdrant:health

API 키가 노출됐거나 인증이 실패하면 Qdrant API Keys에서 새 Cluster API Key를 만들고 기존 키를 폐기한다.

## 5. collectionExists=false 또는 pointCount=0

새 Qdrant Cloud 클러스터에는 scl_tests collection이 없다. 아래 명령이 collection, payload index와 데이터를 생성한다.

    npm run qdrant:seed

정상 최초 적재 결과:

- scanned=3327
- created=3327
- failures=0

기존 legacy vector가 있으면 embeddingCalls=0으로 migration할 수 있다.

주의: QDRANT_URL이 Cloud를 가리키는 상태에서 seed를 실행하면 외부 DB를 변경한다.

## 6. 벡터 차원 불일치

증상:

- 기대값 768, 실제값이 다른 차원
- collection 차원이 다르다는 오류

현재 규격:

- GEMINI_EMBEDDING_MODEL=gemini-embedding-001
- GEMINI_EMBEDDING_DIMENSION=768
- Qdrant collection vector size=768
- distance=Cosine

빈 개발 collection이면 올바른 이름으로 다시 만들 수 있다. 운영 데이터가 있는 collection은 삭제하지 말고 새 collection으로 migration하거나 backup 후 처리한다.

## 7. Gemini API 오류

### API 키 누락 또는 인증 오류

- GEMINI_API_KEY가 비어 있지 않은지 확인
- Vercel 변수의 Environment가 Preview인지 확인
- 키가 Google AI Studio에서 활성 상태인지 확인
- 키를 변경한 뒤에는 새 Preview deployment를 생성

### HTTP 429 또는 quota 초과

무료 Tier는 RPM, TPM, RPD 제한을 가진다. 분당 제한은 잠시 후, 일일 제한은 미국 태평양 자정 이후 다시 사용할 수 있다.

대응:

- 반복 benchmark와 의미 검색 테스트 중단
- 정확한 검사코드·필드 질문으로 불필요한 Embedding 호출 방지
- AI Studio Usage에서 실제 사용량 확인
- 자동 retry가 과도하지 않은지 확인

## 8. Vercel Preview에서 로그인 화면이 나옴

현재 Preview에는 Vercel Authentication이 적용되어 있다. 인증 없는 요청은 앱 대신 Vercel 로그인으로 302 리디렉션된다.

외부 공유 방법:

1. Vercel Deployment 화면 열기
2. Share 선택
3. Anyone with the link 선택
4. Copy Link로 생성된 Shareable Link 전달

완전 공개가 필요하면 Project Settings의 Deployment Protection에서 Vercel Authentication을 비활성화한다. 이 변경은 기존 Preview도 외부에 노출할 수 있으므로 의도적으로 수행한다.

## 9. Vercel health가 degraded

서비스별 필드를 확인한다.

- qdrantConnected=false: QDRANT_URL/API key 문제
- collectionExists=false: seed 또는 collection name 문제
- pointCount=0: 데이터 적재 필요
- embeddingConfigured=false: Gemini embedding model/dimension 변수 누락
- generationAvailable=false: GEMINI_API_KEY 누락

환경변수를 변경하면 기존 deployment에는 자동 적용되지 않는다. 새 Preview를 배포한다.

    npx vercel deploy --target=preview --yes

## 10. 챗봇 API가 500을 반환함

응답의 requestId를 기록하고 Vercel Logs에서 확인한다.

    npx vercel logs --environment preview --status-code 500 --since 30m --expand

대표 원인:

- Qdrant fetch failed
- Gemini API 인증/quota 오류
- 환경변수의 Preview 대상 누락
- 응답 grounding 검증 실패

서버는 500 응답에서 내부 오류와 비밀값을 사용자에게 노출하지 않는다.

## 11. ORIGIN_NOT_ALLOWED 또는 CORS 오류

Vercel 같은 호스트의 UI와 API는 forwarded host/protocol로 허용된다. 로컬 분리 실행은 CHATBOT_ALLOWED_ORIGINS에 Vite origin이 있어야 한다.

기본 로컬 origin:

- http://localhost:5173
- http://127.0.0.1:5173

외부 도메인을 추가할 때는 쉼표로 구분하고 와일드카드보다 정확한 origin을 사용한다.

## 12. 로컬 UI에서 API 연결 실패

터미널 1:

    npm run chatbot:server

터미널 2:

    npm run dev

확인:

- CHATBOT_PORT와 CHATBOT_PROXY_TARGET가 일치하는지 확인
- 이미 사용 중인 포트인지 확인
- /api/health가 직접 응답하는지 확인
- Vite proxy 재시작 여부 확인

## 13. 데이터 동기화 문제

현재 Knowledge JSON만 Qdrant와 비교:

    npm run scl:sync:data

SCL 목록과 상세를 다시 수집하고 동기화:

    npm run scl:sync

안전장치:

- 상세 수집 failures가 있으면 누락 point 비활성화 생략
- 새 snapshot coverage가 기존 active 데이터의 80% 미만이면 비활성화 생략
- 사라진 검사는 삭제 대신 active=false
- contentHash가 바뀐 문서만 재embedding

SCL 사이트에 과도한 요청을 보내지 않도록 crawl delay와 상세 refresh 주기를 유지한다.

## 13.1 급여·비급여 코드 검색이 되지 않음

급여·비급여 코드 역검색은 `normalizedInsuranceCodes` keyword payload index를 사용한다.

확인:

1. `npm run scl:sync:data`로 기존 point에 정규화 코드를 반영했는지 확인
2. Qdrant collection에 `normalizedInsuranceCodes` index가 있는지 확인
3. 질문의 코드가 최소 5개 숫자와 2개 영문자를 포함하는지 확인
4. 코드 내부 숫자가 SCL 검사코드로 잘못 추출되지 않는지 unit test 확인

이 조회는 Vector Search나 Gemini를 사용하지 않는다. `etc.`, 대소문자 차이는 정규화하고 동일 코드가 여러 검사에 사용되면 복수 검사 결과를 반환한다.

## 14. 테스트 또는 빌드 실패

권장 순서:

    npm install
    npm test
    npm run test:e2e
    npm run build

Vercel build에서 engines 경고가 나와도 build가 성공하면 즉시 장애는 아니다. Node major 자동 업그레이드를 원하지 않으면 package.json의 Node 범위를 명확한 major로 제한한다.

E2E가 실패하면 기존 dev server가 남아 있는지, Playwright가 다른 포트의 서버를 재사용하는지 확인한다.

## 15. GitLab push 인증 실패

Feed token은 RSS/Calendar 전용이며 Git push에 사용할 수 없다. HTTPS push의 Password에는 Personal Access Token을 사용한다.

필요 scope:

- write_repository
- 필요 시 api

토큰 값은 생성 직후 한 번만 보인다. 기존 VS Code용 토큰 값을 모르면 별도 push용 토큰을 생성한다.

Windows에 잘못된 자격증명이 저장되어 있으면 dev.mediack.co.kr 항목만 Git Credential Manager에서 제거한 뒤 다시 push한다.

## 16. 비밀정보 사고 대응

다음 값이 화면, 채팅, 로그 또는 Git에 노출되면 즉시 교체한다.

- GEMINI_API_KEY
- QDRANT_API_KEY
- GitLab Personal Access Token
- Vercel token 또는 protection bypass token

처리 순서:

1. 서비스 콘솔에서 노출된 키 폐기
2. 새 키 생성
3. 로컬 .env 갱신
4. Vercel Preview 환경변수 갱신
5. 새 Preview 배포
6. health와 실제 질문 검증
7. 노출된 Git history가 있다면 별도 이력 정리 계획 수립

비밀값을 채팅으로 전달하거나 remote URL에 포함하지 않는다.
