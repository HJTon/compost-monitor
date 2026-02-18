import { useNavigate } from 'react-router-dom';
import { Thermometer, Hammer, TrendingUp } from 'lucide-react';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] bg-green-primary flex flex-col p-5 gap-5">

      {/* Branding */}
      <div className="flex flex-col items-center pt-6 gap-3">
        <img
          src="/fuller-light-logo.jpg"
          alt="Fuller Light Ltd."
          className="w-28 h-28 rounded-3xl object-contain bg-white shadow-2xl p-2"
        />
        <div className="text-center">
          <div className="text-white font-bold text-xl tracking-tight">Compost Monitor</div>
          <div className="text-white/50 text-xs mt-0.5 tracking-wide">by Fuller Light Ltd.</div>
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

      {/* Build + Analyse — secondary actions */}
      <div className="flex gap-4 flex-[2]">
        <button
          onClick={() => navigate('/build')}
          className="flex-1 bg-white/10 border border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2.5 active:scale-[0.98] transition-transform"
        >
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
            <Hammer size={24} className="text-white" />
          </div>
          <div className="text-white font-semibold text-base">Let's Build</div>
        </button>

        <button
          onClick={() => navigate('/analyse')}
          className="flex-1 bg-white/10 border border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2.5 active:scale-[0.98] transition-transform"
        >
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
            <TrendingUp size={24} className="text-white" />
          </div>
          <div className="text-white font-semibold text-base">Let's Analyse</div>
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
