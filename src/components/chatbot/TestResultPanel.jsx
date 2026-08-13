import RelatedResource from './RelatedResource.jsx';
import SourceCard from './SourceCard.jsx';

const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

function activeScheduleDays(value) {
  const activeDays = new Set();
  const normalized = value.replaceAll('요일', '').replace(/\s+/g, '');

  if (normalized.includes('매일')) return new Set(WEEK_DAYS);

  for (const match of normalized.matchAll(/([월화수목금토일])[~\-–—]([월화수목금토일])/g)) {
    const start = WEEK_DAYS.indexOf(match[1]);
    const end = WEEK_DAYS.indexOf(match[2]);
    if (start <= end) WEEK_DAYS.slice(start, end + 1).forEach((day) => activeDays.add(day));
  }

  normalized.match(/[월화수목금토일]/g)?.forEach((day) => activeDays.add(day));
  return activeDays;
}

function ScheduleValue({ value }) {
  const activeDays = activeScheduleDays(value);
  if (activeDays.size === 0) return value;

  return (
    <span className="schedule-status" aria-label={`검사일: ${value}`}>
      <span className="schedule-legend" aria-hidden="true">
        <span><i className="schedule-legend__active">✓</i> 검사일</span>
        <span><i className="schedule-legend__inactive">–</i> 미검사</span>
      </span>
      <span className="schedule-days">
        {WEEK_DAYS.map((day) => {
          const isActive = activeDays.has(day);
          const dayType = day === '일' ? 'sunday' : day === '토' ? 'saturday' : 'weekday';
          return (
            <span
              key={day}
              className={`schedule-day schedule-day--${dayType}${isActive ? ' is-active' : ''}`}
              aria-label={`${day}요일 ${isActive ? '검사함' : '검사 없음'}`}
            >
              <span aria-hidden="true">{day}</span>
              {isActive && <i className="schedule-day__check" aria-hidden="true">✓</i>}
            </span>
          );
        })}
      </span>
    </span>
  );
}

function timeTypeClassName(timeType) {
  if (timeType?.includes('야간')) return 'night';
  if (timeType?.includes('주간')) return 'day';
  return 'neutral';
}

function TestCard({ test }) {
  const details = [
    { key: 'specimen', label: '검체', value: test.specimen },
    { key: 'turnaround', label: '소요일', value: test.turnaroundTime },
    { key: 'method', label: '검사방법', value: test.method },
    { key: 'schedule', label: '검사일', value: test.schedule },
  ].filter(({ value }) => value);

  return (
    <article className="test-card">
      <div className="test-card__heading">
        <div className="test-card__title">
          <span>검사명</span>
          <strong>{test.testName}</strong>
        </div>
        <div className="test-card__badges">
          {test.timeType && (
            <span className={`test-card__time-type test-card__time-type--${timeTypeClassName(test.timeType)}`}>
              <span aria-hidden="true" />
              {test.timeType}
            </span>
          )}
          {test.testCode && <span className="test-card__code">검사코드 {test.testCode}</span>}
        </div>
      </div>
      <dl>
        {details.map(({ key, label, value }) => (
          <div key={key} className={`test-card__field test-card__field--${key}`}>
            <dt>{label}</dt>
            <dd>{key === 'schedule' ? <ScheduleValue value={value} /> : value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function SupportSection({ id, title, items, children }) {
  if (!items?.length) return null;
  return (
    <section className="result-support" aria-labelledby={id}>
      <h4 id={id}>{title} <span>{items.length}</span></h4>
      {children}
    </section>
  );
}

export default function TestResultPanel({ response, messageId }) {
  return (
    <section className="message-section" aria-labelledby={`results-${messageId}`}>
      <h3 id={`results-${messageId}`}>검사 결과</h3>
      <div className="result-panel">
        <div className="test-grid">
          {response.matchedTests.map((test) => <TestCard key={test.id} test={test} />)}
        </div>

        <SupportSection id={`sources-${messageId}`} title="공식 출처" items={response.sources}>
          <div className="source-grid">
            {response.sources?.map((source) => (
              <SourceCard key={`${source.id}-${source.url}`} source={source} />
            ))}
          </div>
        </SupportSection>

        <SupportSection id={`resources-${messageId}`} title="관련 자료" items={response.resources}>
          <div className="resource-grid">
            {response.resources?.map((resource) => (
              <RelatedResource key={`${resource.type}-${resource.url}`} resource={resource} />
            ))}
          </div>
        </SupportSection>
      </div>
    </section>
  );
}
