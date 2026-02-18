import { useNavigate } from 'react-router-dom';
import { Thermometer, Hammer, TrendingUp } from 'lucide-react';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] bg-green-primary flex flex-col p-5 gap-4">

      {/* Logos */}
      <div className="flex justify-center items-center gap-5 py-3">
        <img
          src="/green-loop-logo.jpg"
          alt="Green Loop logo"
          className="w-20 h-20 rounded-xl object-contain bg-white p-1.5 shadow-lg"
        />
        <img
          src="/fuller-light-logo.jpg"
          alt="Fuller Light Ltd. logo"
          className="w-20 h-20 rounded-xl object-contain bg-white p-1.5 shadow-lg"
        />
      </div>

      {/* Let's Measure — big tile */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex-[3] bg-white rounded-2xl flex flex-col items-center justify-center shadow-lg active:scale-[0.98] transition-transform gap-3"
      >
        <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
          <Thermometer size={36} className="text-green-primary" />
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-primary">Let's Measure</div>
          <div className="text-sm text-gray-400 mt-0.5">Record today's readings</div>
        </div>
      </button>

      {/* Two smaller tiles */}
      <div className="flex gap-4 flex-[2]">
        <button
          onClick={() => navigate('/build')}
          className="flex-1 bg-white/15 border-2 border-white/30 rounded-2xl flex flex-col items-center justify-center active:scale-[0.98] transition-transform gap-2"
        >
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <Hammer size={28} className="text-white" />
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">Let's Build</div>
          </div>
        </button>

        <button
          onClick={() => navigate('/analyse')}
          className="flex-1 bg-white/15 border-2 border-white/30 rounded-2xl flex flex-col items-center justify-center active:scale-[0.98] transition-transform gap-2"
        >
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <TrendingUp size={28} className="text-white" />
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">Let's Analyse</div>
          </div>
        </button>
      </div>

    </div>
  );
}
