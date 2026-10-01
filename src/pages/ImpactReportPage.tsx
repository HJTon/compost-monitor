import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, FileText, Loader2, Table2, X } from 'lucide-react';
import {
  type ImpactReport, DEFAULT_COMPOSTING_FACTOR, DIVERSION_NOTE, MONTH_LONG, SCOPE3_NOTE, SDG_TAGS, SDG_TITLE,
  compostDestinationLine, defaultStatementYear, downloadImpactCsv, fetchImpact, fmt1, fmtDate, fmtInt, fmtKg, fmtMass, fmtMonth,
  groupByYear, isToDate, ourCo2e, pileContainers, pileLitres, readStoredYearStart, scope3Of, storeYearStart,
} from '@/utils/impactReport';

// Public, unlisted page. The unguessable code in the URL is the access control.
// Not linked from any nav; data is fetched live from the collector app.

type State =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'error' }
  | { status: 'ok'; report: ImpactReport };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-green-50/50 pb-10">
      <div className="bg-green-primary text-white px-4 py-4">
        <div className="max-w-3xl mx-auto"><Brand /></div>
        {children}
      </div>
    </div>
  );
}

function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-full bg-white overflow-hidden shrink-0 ${className}`}>
      <img src="/green-loop-logo.jpg" alt="Green Loop" className="w-full h-full object-cover scale-[1.24]" />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
      <Logo className="w-7 h-7" /> Green Loop &middot; Sustainable Taranaki
    </div>
  );
}

/** The "*" next to the headline CO2e figure: opens a small card with the conservative official figure. */
function ConservativeNote({ official, ours }: { official: number; ours: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <span ref={ref} className="inline-block align-top">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="About this figure"
        className="ml-0.5 text-green-primary text-xl font-bold leading-none hover:text-green-dark"
      >*</button>
      {open && (
        <span role="dialog" className="absolute z-20 left-3 right-3 sm:right-auto sm:w-96 top-[4.75rem] rounded-xl border border-gray-200 bg-white shadow-lg p-3 text-left text-xs font-normal text-gray-600 leading-snug">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
          <span className="block font-semibold text-gray-800 pr-5">Conservative figure: {fmtMass(official)}</span>
          <span className="block mt-1">
            Our {fmtMass(ours)} reflects Green Loop&apos;s four-week bokashi pre-fermentation, which leaves very little methane when the waste is composted.
            Using the NZ Ministry for the Environment&apos;s standard composting factor instead, which assumes ordinary composting methane, the saving is {fmtMass(official)}.
            Use the conservative figure if your reporting requires official factors.
          </span>
        </span>
      )}
    </span>
  );
}

function Tile({ label, value, sub, accent, note }: { label: string; value: string; sub?: string; accent?: boolean; note?: React.ReactNode }) {
  return (
    <div className={`relative rounded-2xl border p-4 ${accent ? 'bg-white border-green-primary/30' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-green-primary mt-1 leading-tight">{value}{note}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function BarChart({ months }: { months: ImpactReport['months'] }) {
  const max = Math.max(1, ...months.map((m) => m.kg));
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 h-36 min-w-max pt-2">
        {months.map((m) => (
          <div key={m.month} className="flex flex-col items-center justify-end h-full w-8" title={`${fmtMonth(m.month)}: ${fmtKg(m.kg)}`}>
            <span className="text-[9px] text-gray-500 leading-none mb-0.5">{m.kg > 0 ? fmtInt(m.kg) : ''}</span>
            <div className="w-5 bg-green-primary rounded-t" style={{ height: `${Math.max(m.kg > 0 ? 2 : 0, (m.kg / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 min-w-max border-t border-gray-200 pt-1">
        {months.map((m) => (
          <span key={m.month} className="w-8 text-center text-[9px] text-gray-500 leading-tight">
            {fmtMonth(m.month).replace(' ', '\n').split('\n').map((p, i) => <span key={i} className="block">{i === 1 ? `'${p.slice(2)}` : p}</span>)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ImpactReportPage() {
  const { code = '' } = useParams<{ code: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [startMonth, setStartMonth] = useState<number | null>(() => readStoredYearStart(code));
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [stmtYear, setStmtYear] = useState<number | null>(null);
  const [stmtBusy, setStmtBusy] = useState(false);
  const [stmtError, setStmtError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    fetchImpact(code, ac.signal).then((r) => {
      if (!ac.signal.aborted) setState(r);
    });
    return () => ac.abort();
  }, [code]);

  const report = state.status === 'ok' ? state.report : null;
  const effectiveStart = startMonth ?? report?.settings.yearStartMonth ?? 1;
  const factor = report?.methodology.factors.compostingKgCo2ePerKg ?? DEFAULT_COMPOSTING_FACTOR;
  const years = useMemo(() => (report ? groupByYear(report.months, effectiveStart, factor) : []), [report, effectiveStart, factor]);
  const stmt = years.find((g) => g.startYear === stmtYear) ?? defaultStatementYear(years);
  const monthsNewest = useMemo(() => (report ? [...report.months].reverse() : []), [report]);

  if (state.status === 'loading') {
    return (
      <>
        <Shell><h1 className="max-w-3xl mx-auto font-bold text-xl mt-2">Loading impact report&hellip;</h1></Shell>
        <div className="flex justify-center py-16 text-green-primary"><Loader2 className="animate-spin" size={28} /></div>
      </>
    );
  }
  if (state.status === 'notfound') {
    return (
      <Shell>
        <div className="max-w-3xl mx-auto py-8">
          <h1 className="font-bold text-xl">Report not found</h1>
          <p className="text-white/80 text-sm mt-2">This link isn&apos;t valid. Please check you have the full link from Green Loop.</p>
        </div>
      </Shell>
    );
  }
  if (state.status === 'error' || !report) {
    return (
      <Shell>
        <div className="max-w-3xl mx-auto py-8">
          <h1 className="font-bold text-xl">Couldn&apos;t load the report</h1>
          <p className="text-white/80 text-sm mt-2">Something went wrong reaching the server. Please try again in a minute.</p>
          <button onClick={() => location.reload()} className="mt-4 bg-white text-green-primary font-semibold rounded-lg px-4 py-2 text-sm">Retry</button>
        </div>
      </Shell>
    );
  }

  const t = report.totals;
  const s = report.settings;
  const mt = report.methodology;
  const f = mt.factors;
  const range = report.firstCollection && report.latestCollection
    ? `${fmtDate(report.firstCollection)} – ${fmtDate(report.latestCollection)}` : 'No collections recorded yet';

  async function onDownload() {
    if (!report) return;
    setPdfBusy(true); setPdfError(false);
    try {
      const { downloadImpactPdf } = await import('@/utils/impactPdf');
      await downloadImpactPdf(report, effectiveStart);
    } catch (e) {
      console.error('PDF generation failed', e);
      setPdfError(true);
    } finally {
      setPdfBusy(false);
    }
  }

  async function onStatement() {
    if (!report || !stmt) return;
    setStmtBusy(true); setStmtError(false);
    try {
      const { downloadStatementPdf } = await import('@/utils/impactStatementPdf');
      await downloadStatementPdf(report, stmt, window.location.href);
    } catch (e) {
      console.error('Statement generation failed', e);
      setStmtError(true);
    } finally {
      setStmtBusy(false);
    }
  }

  const dest = compostDestinationLine(report);
  const th = 'px-2 py-2 text-right font-medium first:text-left whitespace-nowrap';
  const td = 'px-2 py-1.5 text-right first:text-left tabular-nums whitespace-nowrap';

  return (
    <div className="min-h-screen bg-green-50/50 pb-10">
      <div className="bg-green-primary text-white px-4 pt-4 pb-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-4">
            <Logo className="w-16 h-16 sm:w-20 sm:h-20 ring-2 ring-white/40" />
            <div className="min-w-0">
              <p className="text-white/80 text-xs font-medium">Green Loop &middot; Sustainable Taranaki</p>
              <h1 className="font-bold text-2xl leading-tight">{report.business}</h1>
              <p className="text-white/90 text-sm mt-0.5">Food waste diverted from landfill</p>
              <p className="text-white/60 text-xs mt-1">{range}</p>
            </div>
          </div>
          <button
            onClick={onDownload}
            disabled={pdfBusy}
            className="mt-4 inline-flex items-center gap-2 bg-white text-green-primary font-semibold rounded-lg px-4 py-2 text-sm disabled:opacity-60"
          >
            {pdfBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download PDF
          </button>
          {pdfError && <p className="text-xs text-white mt-2">Sorry, the PDF couldn&apos;t be created. Please try again.</p>}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-3 space-y-5">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Organic waste diverted from landfill" value={fmtMass(t.kg)} sub={t.kg >= 1000 ? fmtKg(t.kg) : undefined} />
          <Tile label="Volume" value={`${fmtInt(t.litres)} L`} sub={`${fmtInt(t.pickups)} collections`} />
          <div className="col-span-2">
            <Tile
              accent
              label="Emissions avoided (CO₂e) compared with the red bin"
              value={fmtMass(ourCo2e(t))}
              note={t.co2eVsLandfillBokashiKg != null && <ConservativeNote official={t.co2eVsLandfillKg} ours={t.co2eVsLandfillBokashiKg} />}
              sub={`${fmtMass(ourCo2e(t) - t.co2eTransportKg)} landfill methane avoided, ${fmtMass(t.co2eTransportKg)} trucking to landfill avoided`}
            />
          </div>
        </div>

        <p className="text-[11px] text-gray-500 px-1 -mt-2">{DIVERSION_NOTE}</p>

        {/* Scope 3 */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800">For your carbon footprint</h2>
          <p className="text-xs text-gray-500 mt-1">Your emissions from food waste (Scope 3, Category 5: waste generated in operations)</p>
          <p className="text-2xl font-bold text-gray-800 mt-1 leading-tight">{fmtInt(scope3Of(t.kg, factor))} <span className="text-base font-semibold">kg CO&#8322;e</span> <span className="text-xs font-normal text-gray-500">all time</span></p>
          {years.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">
              {years.map((g, i) => <span key={g.startYear}>{i > 0 && ' · '}{g.label}: <b>{fmtInt(g.scope3Kg)} kg</b></span>)}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-2">{SCOPE3_NOTE}</p>

          <div className="mt-3 pt-3 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">For your reporting</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={() => downloadImpactCsv(report)} className="inline-flex items-center gap-1.5 border border-green-primary text-green-primary font-semibold rounded-lg px-3 py-1.5 text-xs">
                <Table2 size={14} /> Download data (CSV)
              </button>
            </div>
            {stmt && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Reporting year for the statement"
                  value={stmt.startYear}
                  onChange={(e) => setStmtYear(Number(e.target.value))}
                  className="border border-gray-300 rounded-md px-1.5 py-1.5 text-xs text-gray-800 bg-white max-w-full"
                >
                  {years.map((g) => <option key={g.startYear} value={g.startYear}>{g.label}{isToDate(g) ? ' (to date)' : ''}</option>)}
                </select>
                <button onClick={onStatement} disabled={stmtBusy} className="inline-flex items-center gap-1.5 bg-green-primary text-white font-semibold rounded-lg px-3 py-1.5 text-xs disabled:opacity-60">
                  {stmtBusy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Download statement
                </button>
              </div>
            )}
            {stmtError && <p className="text-xs text-red-600 mt-2">Sorry, the statement could not be created. Please try again.</p>}
            <p className="text-[11px] text-gray-500 mt-2">The statement is a one-page Food Waste Diversion Statement for the reporting year you pick, for sustainability certifications and annual reports.</p>
          </div>
        </section>

        {/* Yearly */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <h2 className="font-semibold text-gray-800">By year</h2>
            <label className="text-xs text-gray-500 flex items-center gap-1.5">
              Year starts in
              <select
                value={effectiveStart}
                onChange={(e) => { const m = Number(e.target.value); setStartMonth(m); storeYearStart(code, m); }}
                className="border border-gray-300 rounded-md px-1.5 py-1 text-xs text-gray-800 bg-white"
              >
                {MONTH_LONG.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b border-gray-200">
                <th className={th}>Year</th><th className={th}>Pickups</th><th className={th}>Litres</th><th className={th}>Kg diverted</th><th className={th}>Scope 3 (kg CO&#8322;e)</th><th className={th}>CO&#8322;e avoided (kg)*</th>
              </tr></thead>
              <tbody>
                {years.map((g) => (
                  <tr key={g.startYear} className="border-b border-gray-100 last:border-0">
                    <td className={`${td} font-medium text-gray-800`}>{g.label}</td><td className={td}>{fmtInt(g.pickups)}</td><td className={td}>{fmtInt(g.litres)}</td><td className={td}>{fmtInt(g.kg)}</td><td className={td}>{fmtInt(g.scope3Kg)}</td><td className={td}>{fmtInt(g.co2eOurKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Monthly */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800 mb-2">By month</h2>
          {report.months.length > 0 && <div className="mb-3"><p className="text-xs text-gray-500 mb-1">Kg per month</p><BarChart months={report.months} /></div>}
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b border-gray-200">
                <th className={th}>Month</th><th className={th}>Pickups</th><th className={th}>Litres</th><th className={th}>Kg</th><th className={th}>CO&#8322;e avoided (kg)*</th>
              </tr></thead>
              <tbody>
                {monthsNewest.map((m) => (
                  <tr key={m.month} className="border-b border-gray-100 last:border-0">
                    <td className={`${td} font-medium text-gray-800`}>{fmtMonth(m.month)}{mt.invoicingStart && m.month < mt.invoicingStart.slice(0, 7) ? ' ~' : ''}</td><td className={td}>{fmtInt(m.pickups)}</td><td className={td}>{fmtInt(m.litres)}</td><td className={td}>{fmtInt(m.kg)}</td><td className={td}>{fmtInt(ourCo2e(m))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mt.invoicingStart && report.months.some((m) => m.month < mt.invoicingStart!.slice(0, 7)) && (
            <p className="text-[11px] text-gray-500 mt-2">~ Estimated from farm bin records.</p>
          )}
          <p className="text-[11px] text-gray-500 mt-1">* CO&#8322;e avoided includes our bokashi pre-fermentation; see the conservative figure under &ldquo;How these numbers are worked out&rdquo;.</p>
        </section>

        {/* Piles */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Compost piles your waste went into</h2>
          {report.piles.length === 0 ? (
            <p className="text-sm text-gray-500">Your waste hasn&apos;t been built into a pile yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-200"><th className={th}>Pile</th><th className={th}>Built</th><th className={th}>Stage</th><th className={th}>Your bins</th><th className={th}>Your litres</th></tr></thead>
                <tbody>
                  {report.piles.map((p) => (
                    <tr key={p.pile} className="border-b border-gray-100 last:border-0">
                      <td className={`${td} font-medium text-gray-800`}>{p.pile}</td>
                      <td className={td}>{p.batchingDate ? fmtDate(p.batchingDate) : 'Date not recorded'}</td>
                      <td className={td}>{p.stage ?? ''}</td>
                      <td className={td}>{pileContainers(p)}</td>
                      <td className={td}>{pileLitres(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {dest && <p className="text-sm text-gray-700 mt-3">{dest}</p>}
          <div className="mt-3">
            <p className="text-[11px] text-gray-500 mb-1">{SDG_TITLE}</p>
            <div className="flex flex-wrap gap-1.5">
              {SDG_TAGS.map((tag) => <span key={tag} className="text-[11px] bg-green-50 text-green-dark border border-green-primary/20 rounded-full px-2 py-0.5">{tag}</span>)}
            </div>
          </div>
          {report.stillMaturing > 0 && (
            <p className="text-xs text-gray-500 mt-2">{report.stillMaturing} container{report.stillMaturing === 1 ? '' : 's'} maturing or not yet recorded in a pile.</p>
          )}
          {report.piles.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-1">Your bins and litres are what you put into each pile. ~ = estimated from older farm records, before each bin's volume was measured; — = not recorded.</p>
          )}
        </section>

        {/* Methodology */}
        <section className="text-xs text-gray-500 space-y-2 px-1">
          <h2 className="font-semibold text-gray-700 text-sm">How these numbers are worked out</h2>
          <p>Weight is estimated at {fmt1(mt.kgPerFullBin)} kg per full {mt.litresPerBin} L bin{s.kgPerFullBinIsDefault ? ' (a standard estimate, not weighed)' : ''}.</p>
          <p>
            Average fullness is {fmt1(s.avgFullnessPct)}%, based on {fmtInt(s.fullnessMeasuredContainers)} measured container{s.fullnessMeasuredContainers === 1 ? '' : 's'}
            {s.fullnessSource === 'fleet' ? ' across all Green Loop customers (none measured for your business yet)' : ''}.{' '}
            {fmt1(t.measuredSharePct)}% of your litres come from measured collections; the rest are estimated from the number of containers collected.
            {mt.invoicingStart ? ` Figures before ${fmtDate(mt.invoicingStart)} are estimated from farm bin records.` : ''}
          </p>
          <p>
            <b>Emissions avoided compared with the red bin:</b> what this waste would have emitted in landfill (with gas recovery, {f.foodWasteLandfillGasRecoveryKgCo2ePerKg} kg CO&#8322;e/kg; garden waste {f.gardenWasteLandfillGasRecoveryKgCo2ePerKg}),
            plus {f.redBinLandfillKm} km of trucking to Bonny Glen landfill near Marton at {f.truckKgCo2ePerTonneKm} kg CO&#8322;e per tonne-km ({f.redBinTransportKgCo2ePerKg} kg CO&#8322;e/kg),
            minus the emissions from our composting. We use &ldquo;with gas recovery&rdquo; because Bonny Glen captures landfill gas, which gives the lower, more conservative landfill figure.
          </p>
          {f.bokashiCompostingKgCo2ePerKg != null && (
            <p>
              <b>* Our composting and bokashi:</b> our food waste ferments in bokashi for four weeks before it is composted, which leaves very little methane. So for our composting we count only the nitrous oxide part of the
              standard factor ({f.bokashiCompostingKgCo2ePerKg} kg CO&#8322;e/kg) and not its methane part (0.112 kg CO&#8322;e/kg). This is Green Loop&apos;s own estimate and hasn&apos;t yet been confirmed by measurement.
              Using the standard composting factor ({f.compostingKgCo2ePerKg} kg CO&#8322;e/kg) instead, the conservative figure is <b>{fmtMass(t.co2eVsLandfillKg)}</b>; use that if your reporting requires official factors.
            </p>
          )}
          <p><b>Your emissions from food waste (Scope 3, Category 5):</b> weight diverted x the official MfE composting factor ({f.compostingKgCo2ePerKg} kg CO&#8322;e/kg), with transport counted as zero. It uses the official factor only, so it is suitable for a carbon inventory; the bokashi estimate is never used for it.</p>
          <p>Green Loop collects with an electric van charged from solar panels, so our own transport emissions are counted as zero.</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {mt.sources.filter((src) => !src.url.includes('food-scraps-bin')).map((src) => (
              <li key={src.url}><a href={src.url} target="_blank" rel="noopener noreferrer" className="underline text-green-dark">{src.label}</a></li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400">Figures update automatically as new collections are recorded.</p>
        </section>
      </div>
    </div>
  );
}
