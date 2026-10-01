import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Leaf, Loader2 } from 'lucide-react';
import {
  type ImpactReport, MONTH_LONG, fetchImpact, fmt1, fmtDate, fmtInt, fmtKg, fmtMass, fmtMonth,
  groupByYear, readStoredYearStart, storeYearStart,
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
        <div className="max-w-3xl mx-auto flex items-center gap-2 text-white/80 text-xs font-medium">
          <Leaf size={14} /> Green Loop &middot; Sustainable Taranaki
        </div>
        {children}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'bg-white border-green-primary/30' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-green-primary mt-1 leading-tight">{value}</p>
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
  const years = useMemo(() => (report ? groupByYear(report.months, effectiveStart) : []), [report, effectiveStart]);
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

  const th = 'px-2 py-2 text-right font-medium first:text-left whitespace-nowrap';
  const td = 'px-2 py-1.5 text-right first:text-left tabular-nums whitespace-nowrap';

  return (
    <div className="min-h-screen bg-green-50/50 pb-10">
      <div className="bg-green-primary text-white px-4 pt-4 pb-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 text-white/80 text-xs font-medium"><Leaf size={14} /> Green Loop &middot; Sustainable Taranaki</div>
          <h1 className="font-bold text-2xl mt-2 leading-tight">{report.business}</h1>
          <p className="text-white/90 text-sm mt-0.5">Food waste diverted from landfill</p>
          <p className="text-white/60 text-xs mt-1">{range}</p>
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
          <Tile label="Food waste diverted" value={fmtMass(t.kg)} sub={t.kg >= 1000 ? fmtKg(t.kg) : undefined} />
          <Tile label="Volume" value={`${fmtInt(t.litres)} L`} sub={`${fmtInt(t.pickups)} collections`} />
          <div className="col-span-2 sm:col-span-1">
            <Tile
              accent
              label="CO₂e avoided vs the red bin"
              value={fmtMass(t.co2eVsLandfillKg)}
              sub={`${fmtMass(t.co2eLandfillKg)} from landfill methane, ${fmtMass(t.co2eTransportKg)} from trucking`}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Tile
              label="With our bokashi pre-fermentation (Green Loop estimate)"
              value={fmtMass(t.co2eVsLandfillBokashiKg ?? t.co2eVsLandfillKg)}
              sub="CO₂e avoided vs the red bin, if four weeks of bokashi first leaves almost no composting methane"
            />
          </div>
          <div className="col-span-2">
            <Tile
              label="CO₂e avoided vs the council food-scraps bin"
              value={fmtMass(t.co2eVsGreenBinKg)}
              sub="from shorter trucking (council scraps go to Hampton Downs)"
            />
          </div>
        </div>

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
                <th className={th}>Year</th><th className={th}>Pickups</th><th className={th}>Litres</th><th className={th}>Kg</th><th className={th}>CO&#8322;e (red bin)</th><th className={th}>CO&#8322;e (council bin)</th>
              </tr></thead>
              <tbody>
                {years.map((g) => (
                  <tr key={g.startYear} className="border-b border-gray-100 last:border-0">
                    <td className={`${td} font-medium text-gray-800`}>{g.label}</td><td className={td}>{fmtInt(g.pickups)}</td><td className={td}>{fmtInt(g.litres)}</td><td className={td}>{fmtInt(g.kg)}</td><td className={td}>{fmtInt(g.co2eVsLandfillKg)}</td><td className={td}>{fmtInt(g.co2eVsGreenBinKg)}</td>
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
                <th className={th}>Month</th><th className={th}>Pickups</th><th className={th}>Litres</th><th className={th}>Kg</th><th className={th}>CO&#8322;e (red bin)</th><th className={th}>CO&#8322;e (council bin)</th>
              </tr></thead>
              <tbody>
                {monthsNewest.map((m) => (
                  <tr key={m.month} className="border-b border-gray-100 last:border-0">
                    <td className={`${td} font-medium text-gray-800`}>{fmtMonth(m.month)}{mt.invoicingStart && m.month < mt.invoicingStart.slice(0, 7) ? ' *' : ''}</td><td className={td}>{fmtInt(m.pickups)}</td><td className={td}>{fmtInt(m.litres)}</td><td className={td}>{fmtInt(m.kg)}</td><td className={td}>{fmtInt(m.co2eVsLandfillKg)}</td><td className={td}>{fmtInt(m.co2eVsGreenBinKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mt.invoicingStart && report.months.some((m) => m.month < mt.invoicingStart!.slice(0, 7)) && (
            <p className="text-[11px] text-gray-500 mt-2">* Estimated from farm bin records.</p>
          )}
        </section>

        {/* Piles */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Compost piles your waste went into</h2>
          {report.piles.length === 0 ? (
            <p className="text-sm text-gray-500">Your waste hasn&apos;t been built into a pile yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-200"><th className={th}>Pile</th><th className={th}>Built</th><th className={th}>Your containers</th></tr></thead>
                <tbody>
                  {report.piles.map((p) => (
                    <tr key={p.pile} className="border-b border-gray-100 last:border-0">
                      <td className={`${td} font-medium text-gray-800`}>{p.pile}</td>
                      <td className={td}>{p.batchingDate ? fmtDate(p.batchingDate) : 'Not yet built'}</td>
                      <td className={td}>{fmt1(p.containers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.stillMaturing > 0 && (
            <p className="text-xs text-gray-500 mt-2">{report.stillMaturing} container{report.stillMaturing === 1 ? '' : 's'} maturing or not yet recorded in a pile.</p>
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
            <b>Avoided vs the red bin:</b> landfill with gas recovery {f.foodWasteLandfillGasRecoveryKgCo2ePerKg} kg CO&#8322;e/kg (garden waste {f.gardenWasteLandfillGasRecoveryKgCo2ePerKg}),
            plus {f.redBinLandfillKm} km of trucking to Bonny Glen landfill near Marton at {f.truckKgCo2ePerTonneKm} kg CO&#8322;e per tonne-km ({f.redBinTransportKgCo2ePerKg} kg CO&#8322;e/kg),
            minus our composting at {f.compostingKgCo2ePerKg} kg CO&#8322;e/kg. We use &ldquo;with gas recovery&rdquo; because Bonny Glen captures landfill gas, the conservative choice.
          </p>
          <p>
            <b>Avoided vs the council food-scraps bin:</b> the council trucks scraps about {f.councilFoodScrapsKm} km to a composting facility at Hampton Downs, so composting emissions cancel out and only that trucking
            ({f.councilTransportKgCo2ePerKg} kg CO&#8322;e/kg) is avoided. The council&apos;s local collection leg is ignored (electric trucks), which is conservative.
          </p>
          <p>Green Loop collects with an electric van charged from solar panels, so our own transport emissions are counted as zero.</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {mt.sources.map((src) => (
              <li key={src.url}><a href={src.url} target="_blank" rel="noopener noreferrer" className="underline text-green-dark">{src.label}</a></li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400">Figures update automatically as new collections are recorded.</p>
        </section>
      </div>
    </div>
  );
}
