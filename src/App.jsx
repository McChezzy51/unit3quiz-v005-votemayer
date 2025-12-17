import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore'
import './App.css'
import { db, firebaseConfigMissing } from './firebase.js'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MONTH_TO_NUM = new Map(MONTHS.map((m, i) => [m, i + 1]))

function monthKeyToLabel(monthKey) {
  const [y, mm] = String(monthKey).split('-')
  const monthNum = Number(mm)
  const monthName = MONTHS[monthNum - 1] ?? mm
  return `${monthName} ${y}`
}

function LineChart({ rows, valueFormatter, ariaLabel }) {
  // rows: [{ monthKey, total }]
  const w = 1000
  const h = 360
  const margin = { top: 20, right: 20, bottom: 88, left: 84 }
  const iw = w - margin.left - margin.right
  const ih = h - margin.top - margin.bottom

  const points = rows
    .filter((r) => Number.isFinite(r.total))
    .map((r) => ({
      key: r.monthKey,
      label: monthKeyToLabel(r.monthKey),
      value: r.total,
    }))

  const max = points.reduce((m, p) => Math.max(m, p.value), 0)
  const yMax = max <= 0 ? 1 : max * 1.05
  const yMin = 0

  const xForIndex = (i) => (points.length <= 1 ? margin.left : margin.left + (i / (points.length - 1)) * iw)
  const yForValue = (v) => {
    const t = (v - yMin) / (yMax - yMin)
    return margin.top + (1 - t) * ih
  }

  const d =
    points.length === 0
      ? ''
      : points
          .map((p, i) => {
            const x = xForIndex(i)
            const y = yForValue(p.value)
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
          })
          .join(' ')

  const ticks = 5
  // Avoid overlapping x labels: estimate how many can fit, then label every N points.
  // Labels are like "YYYY-MM" (~7 chars). With rotation, we can fit a bit more.
  const approxLabelPx = 44
  const maxLabels = Math.max(2, Math.floor(iw / approxLabelPx))
  const xLabelEvery = Math.max(1, Math.ceil(points.length / maxLabels))

  return (
    <div className="chartWrap" role="region" aria-label={ariaLabel}>
      {points.length === 0 ? (
        <p className="muted">No chart data available for this selection.</p>
      ) : (
        <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          {/* grid + y labels */}
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const v = yMin + ((ticks - i) / ticks) * (yMax - yMin)
            const y = yForValue(v)
            return (
              <g key={i}>
                <line className="chartGrid" x1={margin.left} y1={y} x2={w - margin.right} y2={y} />
                <text className="chartAxisLabel" x={margin.left - 10} y={y + 4} textAnchor="end">
                  {valueFormatter.format(v)}
                </text>
              </g>
            )
          })}

          {/* axis titles */}
          <text
            className="chartAxisTitle"
            x={margin.left + iw / 2}
            y={h - 10}
            textAnchor="middle"
          >
            Month (YYYY-MM)
          </text>
          <text
            className="chartAxisTitle"
            x={18}
            y={margin.top + ih / 2}
            textAnchor="middle"
            transform={`rotate(-90 18 ${margin.top + ih / 2})`}
          >
            Total overdose deaths
          </text>

          {/* axes */}
          <line
            className="chartAxis"
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={h - margin.bottom}
          />
          <line
            className="chartAxis"
            x1={margin.left}
            y1={h - margin.bottom}
            x2={w - margin.right}
            y2={h - margin.bottom}
          />

          {/* line */}
          <path className="chartLine" d={d} fill="none" />

          {/* points + tooltips */}
          {points.map((p, i) => {
            const x = xForIndex(i)
            const y = yForValue(p.value)
            return (
              <circle key={p.key} className="chartPoint" cx={x} cy={y} r={3.5}>
                <title>
                  {p.label}: {valueFormatter.format(p.value)}
                </title>
              </circle>
            )
          })}

          {/* x labels */}
          {points.map((p, i) => {
            if (i % xLabelEvery !== 0 && i !== points.length - 1) return null
            const x = xForIndex(i)
            const short = p.key // YYYY-MM
            const y = h - margin.bottom + 30
            return (
              <text
                key={`x-${p.key}`}
                className="chartAxisLabel chartXLabel"
                transform={`translate(${x} ${y}) rotate(-45)`}
                textAnchor="end"
              >
                {short}
              </text>
            )
          })}
        </svg>
      )}
    </div>
  )
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]

    if (c === '"') {
      // Escaped quote inside quoted field: "" -> "
      if (inQuotes && text[i + 1] === '"') {
        field += '"'
        i += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (c === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if (c === '\n' && !inQuotes) {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      continue
    }

    // Ignore CR (Windows line endings)
    if (c === '\r') continue

    field += c
  }

  // Flush last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop trailing empty rows (common in CSV exports)
  while (rows.length > 0 && rows[rows.length - 1].every((v) => v === '')) {
    rows.pop()
  }

  return rows
}

function App() {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [indicators, setIndicators] = useState([])
  const [selectedIndicator, setSelectedIndicator] = useState('')
  const [totalsByIndicator, setTotalsByIndicator] = useState(null)
  const [countsByIndicator, setCountsByIndicator] = useState(null)

  const [voteStatus, setVoteStatus] = useState(db ? 'loading' : 'disabled') // loading | ready | error | disabled
  const [voteError, setVoteError] = useState('')
  const [voteCounts, setVoteCounts] = useState({ forCount: 0, againstCount: 0 })
  const [isVoting, setIsVoting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setStatus('loading')
        setError('')

        const res = await fetch('/data/overdoseRates.csv', { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to load CSV: ${res.status} ${res.statusText}`)
        }

        const text = await res.text()
        const parsed = parseCsv(text)
        const [headerRow, ...dataRows] = parsed

        if (!headerRow || headerRow.length === 0) {
          throw new Error('CSV appears to be empty (missing header row).')
        }

        const colIndex = Object.fromEntries(headerRow.map((h, idx) => [h, idx]))
        const yearIdx = colIndex['Year']
        const monthIdx = colIndex['Month']
        const indicatorIdx = colIndex['Indicator']
        const dataValueIdx = colIndex['Data Value']
        const predictedIdx = colIndex['Predicted Value']

        if (
          yearIdx === undefined ||
          monthIdx === undefined ||
          indicatorIdx === undefined ||
          dataValueIdx === undefined
        ) {
          throw new Error(
            `CSV missing required columns. Found headers: ${headerRow.join(', ')}`,
          )
        }

        const totals = Object.create(null)
        const counts = Object.create(null)
        const indicatorSet = new Set()

        for (const r of dataRows) {
          // Normalize to header length so missing trailing fields don't shift indices.
          const row = r.slice(0, headerRow.length)
          while (row.length < headerRow.length) row.push('')

          const indicator = row[indicatorIdx] || ''
          const year = Number(row[yearIdx])
          const monthName = row[monthIdx] || ''
          const monthNum = MONTH_TO_NUM.get(monthName)

          if (!indicator || !Number.isFinite(year) || !monthNum) continue

          const raw = row[dataValueIdx]
          const rawPredicted = predictedIdx !== undefined ? row[predictedIdx] : ''
          const value = Number(raw !== '' ? raw : rawPredicted)
          if (!Number.isFinite(value)) continue

          const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`

          indicatorSet.add(indicator)
          if (!totals[indicator]) totals[indicator] = Object.create(null)
          if (!counts[indicator]) counts[indicator] = Object.create(null)

          totals[indicator][monthKey] = (totals[indicator][monthKey] ?? 0) + value
          counts[indicator][monthKey] = (counts[indicator][monthKey] ?? 0) + 1
        }

        if (cancelled) return

        const indicatorList = Array.from(indicatorSet).sort((a, b) => a.localeCompare(b))
        const defaultIndicator =
          indicatorList.find((v) => v.toLowerCase().includes('all')) ?? indicatorList[0] ?? ''

        setIndicators(indicatorList)
        setSelectedIndicator(defaultIndicator)
        setTotalsByIndicator(totals)
        setCountsByIndicator(counts)
        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const monthlyRows = useMemo(() => {
    if (!totalsByIndicator || !selectedIndicator) return []
    const totals = totalsByIndicator[selectedIndicator] ?? {}
    const counts = countsByIndicator?.[selectedIndicator] ?? {}

    return Object.entries(totals)
      .map(([monthKey, total]) => {
        const [y, mm] = monthKey.split('-')
        const monthNum = Number(mm)
        const year = Number(y)
        return {
          monthKey,
          year,
          monthNum,
          monthName: MONTHS[monthNum - 1] ?? mm,
          total,
          count: counts[monthKey] ?? 0,
        }
      })
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
  }, [totalsByIndicator, countsByIndicator, selectedIndicator])

  const grandTotal = useMemo(() => monthlyRows.reduce((sum, r) => sum + r.total, 0), [monthlyRows])
  const numberFormatter = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }), [])

  const voteDocRef = useMemo(() => {
    if (!db) return null
    return doc(db, 'votes', 'position')
  }, [])

  useEffect(() => {
    if (!voteDocRef) return undefined

    setVoteStatus('loading')
    setVoteError('')

    const unsub = onSnapshot(
      voteDocRef,
      (snap) => {
        if (!snap.exists()) {
          setVoteCounts({ forCount: 0, againstCount: 0 })
          setVoteStatus('ready')
          return
        }

        const data = snap.data() ?? {}
        const forCount = Number(data.forCount ?? 0)
        const againstCount = Number(data.againstCount ?? 0)

        setVoteCounts({
          forCount: Number.isFinite(forCount) ? forCount : 0,
          againstCount: Number.isFinite(againstCount) ? againstCount : 0,
        })
        setVoteStatus('ready')
      },
      (err) => {
        setVoteStatus('error')
        setVoteError(err instanceof Error ? err.message : String(err))
      },
    )

    return () => unsub()
  }, [voteDocRef])

  const totalVotes = voteCounts.forCount + voteCounts.againstCount
  const percentFor = totalVotes === 0 ? 0 : (voteCounts.forCount / totalVotes) * 100
  const percentAgainst = totalVotes === 0 ? 0 : (voteCounts.againstCount / totalVotes) * 100

  const castVote = useCallback(
    async (direction) => {
      if (!db || !voteDocRef) return

      setIsVoting(true)
      setVoteError('')

      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(voteDocRef)
          const data = snap.exists() ? snap.data() ?? {} : {}

          const currentFor = Number(data.forCount ?? 0)
          const currentAgainst = Number(data.againstCount ?? 0)

          const safeFor = Number.isFinite(currentFor) ? currentFor : 0
          const safeAgainst = Number.isFinite(currentAgainst) ? currentAgainst : 0

          const nextFor = direction === 'for' ? safeFor + 1 : safeFor
          const nextAgainst = direction === 'against' ? safeAgainst + 1 : safeAgainst

          tx.set(
            voteDocRef,
            {
              forCount: nextFor,
              againstCount: nextAgainst,
              createdAt: snap.exists() ? data.createdAt ?? serverTimestamp() : serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )
        })
      } catch (e) {
        setVoteStatus('error')
        setVoteError(e instanceof Error ? e.message : String(e))
      } finally {
        setIsVoting(false)
      }
    },
    [voteDocRef],
  )

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">Why You Should Vote Mayer for Mayor</h1>
        <p className="subtitle">
          Source:{' '}
          <a
            href="https://catalog.data.gov/dataset/provisional-drug-overdose-death-counts-for-specific-drugs"
            target="_blank"
            rel="noreferrer"
          >
            Provisional drug overdose death counts for specific drugs (Data.gov)
          </a>{' '}
        </p>
      </header>

      {status === 'loading' ? (
        <div className="card">
          <p className="muted">Loading CSV…</p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="card error">
          <p className="errorTitle">Couldn’t load the CSV</p>
          <pre className="errorText">{error}</pre>
          <p className="muted">
            Make sure the file exists at <code>public/data/overdoseRates.csv</code>.
          </p>
        </div>
      ) : null}

      {status === 'ready' ? (
        <>
          <div className="controls">
            <div className="controlGroup">
              <label className="label">
                Drug
                <select
                  className="select"
                  value={selectedIndicator}
                  onChange={(e) => setSelectedIndicator(e.target.value)}
                >
                  {indicators.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="controlGroup">
              <span className="muted">
                Months: <strong>{monthlyRows.length}</strong> · Total: <strong>{numberFormatter.format(grandTotal)}</strong>
              </span>
            </div>
          </div>

          <LineChart
            rows={monthlyRows}
            valueFormatter={numberFormatter}
            ariaLabel="Monthly overdose totals line chart"
          />
        </>
      ) : null}

      <footer className="card voteCard" aria-label="Voting">
        <div className="voteHeader">
          <h2 className="voteTitle">Statement of Intent</h2>
          <div className="muted">
            Total votes ever cast: <strong>{totalVotes}</strong>
          </div>
        </div>

        <p className="muted">
          This data shows overdose deaths. Drugs are bad — that’s why you should vote Mayer for Mayor. We're gonna get rid of all drugs.
          Do you agree with me?
        </p>

        {voteStatus === 'disabled' ? (
          <p className="muted">
            Voting isn’t configured yet. Add your Firebase config as Vite environment variables (missing:{' '}
            <code>{firebaseConfigMissing.join(', ')}</code>).
          </p>
        ) : null}

        {voteStatus === 'loading' ? <p className="muted">Loading votes…</p> : null}

        {voteStatus === 'error' && voteError ? (
          <div className="errorNote">
            <p className="errorTitle">Voting error</p>
            <pre className="errorText">{voteError}</pre>
          </div>
        ) : null}

        <div className="voteStats">
          <div className="voteStat">
            <div className="voteStatLabel">In favor</div>
            <div className="voteStatValue">{percentFor.toFixed(1)}%</div>
            <div className="muted">{voteCounts.forCount} votes</div>
          </div>
          <div className="voteStat">
            <div className="voteStatLabel">Against</div>
            <div className="voteStatValue">{percentAgainst.toFixed(1)}%</div>
            <div className="muted">{voteCounts.againstCount} votes</div>
          </div>
        </div>

        <div className="voteButtons">
          <button
            className="button voteButton voteFor"
            onClick={() => castVote('for')}
            disabled={!db || isVoting || voteStatus === 'disabled'}
          >
            {isVoting ? 'Voting…' : 'Vote in favor'}
          </button>
          <button
            className="button voteButton voteAgainst"
            onClick={() => castVote('against')}
            disabled={!db || isVoting || voteStatus === 'disabled'}
          >
            {isVoting ? 'Voting…' : 'Vote against'}
          </button>
        </div>
      </footer>

      <footer className="siteFooter" aria-label="Project link">
        <a href="https://github.com/McChezzy51/unit3quiz-v005-votemayer" target="_blank" rel="noreferrer">
          View this project on GitHub
        </a>
      </footer>
    </div>
  )
}

export default App
