#!/usr/bin/env node
//
// One-shot import of Caroline's 19 July 2026 mustard germination trial.
//
// Source: Green_Loop_Mustard_Trial_ALIGNED.xlsm — Pivot 1–4, three replicate
// pots each, cumulative germination counts across five observation dates. The
// spreadsheet's Batch Summary figures (78.7 / 29.3 / 61.3 / 100 % overall
// germination) are reproduced exactly by the app's rollups, so this is a
// straight transcription, not a re-interpretation.
//
// Talks to the DEPLOYED Netlify functions — they hold the service-account
// credentials, so nothing secret is needed here. Run it only AFTER deploying
// the `Settings` column support in compost-trial-runs.ts, or the run's protocol
// settings (pots per treatment, size bands, threshold) will be dropped.
//
//   node scripts/import-mustard-19jul.mjs --dry-run
//   node scripts/import-mustard-19jul.mjs
//
// Safe to re-run: it skips any build that already carries a trial for this run,
// and it merges into each build's existing grow record rather than replacing it.

const BASE = process.env.COMPOST_BASE_URL || 'https://compostmonitor.netlify.app';
const DRY = process.argv.includes('--dry-run');

const RUN_ID = 'mustard-2026-07-19';
const SOW_DATE = '2026-07-19';
const OBS_DATES = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-08-02', '2026-08-10'];
const SEEDS_PER_POT = 25;

/** Sheet name → cumulative counts per pot, in OBS_DATES order. */
const COUNTS = {
  'Pivot #1': [[8, 14, 16, 18, 18], [13, 17, 19, 18, 23], [5, 12, 15, 18, 18]],
  'Pivot #2': [[8, 13, 17, 20, 20], [1, 2, 2, 2, 2], [0, 0, 0, 0, 0]],
  'Pivot #3': [[7, 17, 19, 21, 21], [0, 0, 0, 0, 0], [8, 14, 24, 25, 25]],
  'Pivot #4': [[9, 14, 18, 25, 25], [10, 12, 20, 25, 25], [1, 18, 19, 25, 25]],
};

const SIZE_BANDS = [
  { cls: 1, minCm: null, maxCm: 5 },
  { cls: 2, minCm: 5, maxCm: 10 },
  { cls: 3, minCm: 10, maxCm: 15 },
  { cls: 4, minCm: 15, maxCm: null },
];

const potsFrom = rows => rows.map((counts, i) => ({
  pot: i + 1,
  seedsSown: SEEDS_PER_POT,
  counts: counts.map((count, j) => ({ date: OBS_DATES[j], count })),
  measurements: {},
}));

/**
 * One call, retried on failure.
 *
 * The Sheets API behind these functions throws the occasional 500 under a burst
 * of writes — one did on the first run of this import. Since each POST is a
 * read-modify-write of a single row, retrying is safe, and stopping halfway
 * through would leave the builds inconsistent with the run.
 */
async function api(path, init, attempt = 1) {
  const res = await fetch(`${BASE}/.netlify/functions/${path}`, init);
  if (res.ok) return res.json();

  const detail = await res.text().catch(() => '');
  if (attempt < 3) {
    console.log(`  ${path} → HTTP ${res.status}, retrying (${attempt}/2)…`);
    await new Promise(r => setTimeout(r, 1500 * attempt));
    return api(path, init, attempt + 1);
  }
  throw new Error(`${path} → HTTP ${res.status} ${detail.slice(0, 200)}`);
}

async function main() {
  console.log(`Target: ${BASE}${DRY ? '  (dry run — nothing will be written)' : ''}\n`);

  // ── 1. The run itself, with its controls and protocol settings ────────────
  const { runs = [] } = await api('compost-trial-runs');
  const existing = runs.find(r => r.runId === RUN_ID);
  console.log(existing ? `Run ${RUN_ID} already exists — settings will be merged.` : `Run ${RUN_ID} is new.`);

  const run = {
    runId: RUN_ID,
    type: 'germination',
    startDate: SOW_DATE,
    plannedDays: 5,
    seedsSown: SEEDS_PER_POT,
    notes: 'Imported from Green_Loop_Mustard_Trial_ALIGNED.xlsm (Caroline, 30 Aug 2026). '
      + 'Three pots per compost in this run; the protocol calls for five.',
    // Controls: the protocol runs seed raising mix alongside. No control data
    // came with the ALIGNED sheet, so the row is created empty rather than
    // invented — until it is filled in, no treatment gets a verdict.
    controls: existing?.controls?.length
      ? existing.controls
      : [{ id: 'seed-raising-mix', label: 'Seed raising mix', measurements: {}, pots: [] }],
    settings: {
      potsPerTreatment: 3,
      observationDates: OBS_DATES,
      sizeBands: SIZE_BANDS,
      passThresholdPct: 80,
    },
  };

  if (DRY) {
    console.log('  would POST run:', JSON.stringify({ ...run, controls: `${run.controls.length} control(s)` }));
  } else {
    await api('compost-trial-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    console.log('  run written.');
  }

  // ── 2. One trial per build, carrying that build's pots ────────────────────
  const { phases = [] } = await api('compost-build-phase');
  // First row wins, matching how the function's POST resolves a system.
  const byName = new Map();
  for (const p of phases) if (!byName.has(p.system)) byName.set(p.system, p);

  for (const [system, rows] of Object.entries(COUNTS)) {
    const current = byName.get(system);
    const grow = current?.grow && typeof current.grow === 'object'
      ? current.grow
      : { startedAt: SOW_DATE, trials: [] };
    const trials = Array.isArray(grow.trials) ? grow.trials : [];

    if (trials.some(t => t.runId === RUN_ID)) {
      console.log(`${system}: already in this run — skipped.`);
      continue;
    }

    const trial = {
      id: `mustard-19jul-${system.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      method: 'Pot trial',
      crop: 'Mustard',
      createdAt: `${SOW_DATE}T00:00:00`,
      trialType: 'germination',
      startedAt: SOW_DATE,
      plannedDays: 5,
      runId: RUN_ID,
      replicates: 3,
      pots: potsFrom(rows),
    };

    const payload = {
      system,
      sheetTab: system,
      // Keep whatever phase the build is actually in. All four Pivots are in
      // `maturation`, and moving them to `grow` would hide them from the
      // Dashboard — the trial reads off `grow.trials` regardless of phase, so
      // there is nothing to gain by touching it.
      phase: current?.phase || 'grow',
      // Only `grow` is being changed. Sending maturation as undefined leaves
      // the sheet's value alone — never send null here, that clears it.
      grow: { ...grow, startedAt: grow.startedAt || SOW_DATE, trials: [...trials, trial] },
      transitionNote: `+ Germination test (${SOW_DATE}): imported from the ALIGNED spreadsheet`,
    };

    if (DRY) {
      console.log(`${system}: would add trial with ${trial.pots.length} pots, `
        + `phase stays '${payload.phase}' (keeping ${trials.length} existing trial(s)).`);
    } else {
      await api('compost-build-phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log(`${system}: trial added (${trial.pots.length} pots).`);
    }
  }

  console.log('\nDone.');
  if (!DRY) console.log('Open /trials in the app to check the numbers against the spreadsheet.');
}

main().catch(err => {
  console.error('\nImport failed:', err.message);
  process.exit(1);
});
