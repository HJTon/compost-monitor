import { useNavigate } from 'react-router-dom';
import { Thermometer, Hammer, TrendingUp, Settings2, Settings } from 'lucide-react';

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return iso;
  }
}

const UPDATED_LABEL = `Updated ${formatUpdated(__BUILD_TIME__)}`;

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] bg-green-primary flex flex-col p-5 gap-5">

      {/* Settings — top-right */}
      <button
        onClick={() => navigate('/settings')}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white/80 hover:bg-white/20 transition"
        aria-label="Settings"
      >
        <Settings size={20} />
      </button>

      {/* Branding */}
      <div className="flex flex-col items-center pt-6 gap-3">
        <img
          src="/fuller-light-logo.jpg"
          alt="Fuller Light Ltd."
          className="w-28 h-28 rounded-3xl object-contain bg-white shadow-2xl p-2"
        />
        <div className="text-center">
          <div className="text-white font-bold text-xl tracking-tight">Compost Monitor</div>
          <div className="text-white/50 text-xs mt-0.5 tracking-wide">{UPDATED_LABEL}</div>
        </div>
      </div>

      {/* Measure — dominant primary action */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex-[5] bg-white rounded-3xl flex flex-col items-center justify-center shadow-2xl active:scale-[0.98] transition-transform gap-4"
      >
        <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center">
          <Thermometer size={44} className="text-green-primary" />
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-green-primary">Let's Measure</div>
          <div className="text-sm text-gray-400 mt-1">Record today's readings</div>
        </div>
      </button>

      {/* Build + Analyse + Manage — secondary actions */}
      <div className="flex gap-3 flex-[2]">
        <button
          onClick={() => navigate('/build')}
          className="flex-1 bg-white/10 border border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Hammer size={22} className="text-white" />
          </div>
          <div className="text-white font-semibold text-sm">Let's Build</div>
        </button>

        <button
          onClick={() => navigate('/analyse')}
          className="flex-1 bg-white/10 border border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <TrendingUp size={22} className="text-white" />
          </div>
          <div className="text-white font-semibold text-sm">Let's Analyse</div>
        </button>

        <button
          onClick={() => navigate('/manage')}
          className="flex-1 bg-white/10 border border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Settings2 size={22} className="text-white" />
          </div>
          <div className="text-white font-semibold text-sm">Let's Manage</div>
        </button>
      </div>

      {/* Partnership footer */}
      <div className="flex items-center justify-center gap-2 pb-2">
        <img
          src="/green-loop-logo.jpg"
          alt="Green Loop"
          className="w-7 h-7 rounded-lg object-contain bg-white/20 p-0.5"
        />
        <span className="text-white/40 text-xs">In partnership with Green Loop</span>
      </div>

    </div>
  );
}
