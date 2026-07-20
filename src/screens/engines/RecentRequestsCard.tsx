import { useNavigate } from 'react-router'
import { useRecordedCalls, type RecordedCall } from '../../api'
import { StatusCode } from '../../lib'
import { DOCS_FOR_CONTEXT, openDocs } from '../docs/openDocs'

const MAX_VISIBLE = 20

function docsTargetFor(status: number): string {
  return status === 409 ? DOCS_FOR_CONTEXT.conflict : 'errors-status-codes'
}

function RequestRow({ call, onWhy }: { call: RecordedCall; onWhy: (status: number) => void }) {
  const { status, method, path, ms } = call

  return (
    <div className="engines__request-row">
      <span className="engines__request-status">
        {typeof status === 'number' ? (
          <StatusCode status={status} ms={ms} />
        ) : (
          <span className="mono-path">
            <span className="engines__stream-tag">stream</span> · {ms.toFixed(1)} ms
          </span>
        )}
      </span>
      <span className="engines__request-method">{method}</span>
      <span className="engines__request-path">{path}</span>
      {typeof status === 'number' && status >= 400 && (
        <button type="button" className="engines__why-link" onClick={() => onWhy(status)}>
          why?
        </button>
      )}
    </div>
  )
}

/** RECENT REQUESTS-Karte (spec engines/001 §5): Recorder-Liste, neueste zuerst, 4xx mit why?-Docs-Link. */
export function RecentRequestsCard() {
  const navigate = useNavigate()
  const calls = useRecordedCalls()
  const recent = [...calls].reverse().slice(0, MAX_VISIBLE)

  function handleWhy(status: number): void {
    openDocs(docsTargetFor(status))
    void navigate('/docs')
  }

  return (
    <div className="engines__card engines__requests">
      <div className="engines__card-title mono-label">RECENT REQUESTS</div>
      {recent.length === 0 ? (
        <div className="engines__empty">requests made by this client appear here</div>
      ) : (
        recent.map((call) => <RequestRow key={call.id} call={call} onWhy={handleWhy} />)
      )}
    </div>
  )
}
