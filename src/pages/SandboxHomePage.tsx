import { useNavigate } from 'react-router-dom';
import { ArrowRight, FlaskConical, RotateCcw, ShieldCheck } from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import { useSandboxReset } from '@/contexts/SandboxProvider';
import { SANDBOX_RUN_ID } from '@/utils/sandboxTrial';
import { controlBaseline, treatmentSummary, treatmentVerdict } from '@/utils/trialPots';
import { runTreatments } from '@/utils/trialTreatments';

/**
 * The way in to the practice space.
 *
 * Everything past this page is the real germination screens running on made-up
 * data — so this page's only jobs are to say plainly that nothing is saved, and
 * to give someone learning the app a few concrete things to try. An empty
 * sandbox teaches nothing; a list of tasks with an expected outcome does.
 */
export function SandboxHomePage() {
  const navigate = useNavigate();
  const { allSystems, getTrialRun } = useCompost();
  const reset = useSandboxReset();

  const run = getTrialRun(SANDBOX_RUN_ID);
  const treatments = run ? runTreatments(allSystems, run) : [];
  const control = run ? controlBaseline(run) : null;

  const open = () => navigate(`/sandbox/trials/${SANDBOX_RUN_ID}`);

  return (
    <div className="min-h-screen bg-green-50/50 pb-10">
      <Header title="Practice space" showBack onBack={() => navigate('/settings')} />

      <div className="p-4 space-y-4">

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-start gap-2">
            <ShieldCheck size={18} className="text-green-primary shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-gray-900 text-sm">Nothing here is real</h2>
              <p className="text-sm text-gray-600 mt-1 leading-snug">
                This is the mustard germination test with made-up numbers in it. The screens
                are exactly the ones you'll use on the bench, but the piles are invented and
                nothing you type is saved, shared or sent to the spreadsheet. Change whatever
                you like — you can put it all back with one tap.
              </p>
            </div>
          </div>

          <button
            onClick={open}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-primary text-white text-sm font-medium"
          >
            <FlaskConical size={16} />
            Open the practice run
            <ArrowRight size={15} />
          </button>
        </div>

        {/* What's in the run, and why each pile looks different */}
        {run && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">What's set up for you</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Four demo piles and a seed raising mix control, each left in a different state
                so you can see what every result looks like.
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {treatments.map(t => {
                const summary = treatmentSummary({ pots: t.pots }, run);
                const verdict = treatmentVerdict(summary, control, run, t.kind === 'control');
                return (
                  <div key={t.key} className="px-4 py-2.5 flex items-center gap-2">
                    <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{t.label}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${verdict.chipClass}`}>
                      {verdict.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Concrete tasks — the actual teaching */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Five things worth trying</h3>
          <ol className="space-y-3 text-sm text-gray-600">
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">1</span>
              <span>
                <strong className="text-gray-800">Record a counting day.</strong> Tap
                "Record a counting day", pick today, and put a number in every pot. Remember it's the
                <em> total</em> up so far, not just the new ones. Leave a pot blank if you didn't look at it,
                and type <strong>0</strong> if you looked and nothing had come up — the app treats those
                two very differently.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">2</span>
              <span>
                <strong className="text-gray-800">Sort a pot's seedlings.</strong> Open
                <em> Demo pile C</em> — it's been counted but not pulled apart yet. Open Pot 1 and put its
                seedlings into the size classes. Watch the bar underneath tell you whether your classes
                add up to the number that germinated.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">3</span>
              <span>
                <strong className="text-gray-800">Break it on purpose.</strong> In that same pot, make the
                classes add up to the wrong total. The pot turns orange and says "Check counts", and the
                pile stops short of a result until it's fixed. That's the safety net.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">4</span>
              <span>
                <strong className="text-gray-800">See why a pile gets flagged.</strong> Open
                <em> Demo pile B</em>. It germinated far below the control, so it reads
                "Germination inhibition". The card tells you what that means and — importantly — that it
                points at a problem, not at its cause.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">5</span>
              <span>
                <strong className="text-gray-800">Change the settings.</strong> Under "Run settings",
                try moving the alert threshold or the size band boundaries and watch the verdicts move
                with them. This is where we'd set the real band sizes once you've measured a batch.
              </span>
            </li>
          </ol>
        </div>

        <button
          onClick={reset}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-600"
        >
          <RotateCcw size={15} />
          Reset the practice data
        </button>

        <p className="text-[11px] text-gray-400 px-1 text-center">
          Leaving this page and coming back also starts you fresh.
        </p>
      </div>
    </div>
  );
}
