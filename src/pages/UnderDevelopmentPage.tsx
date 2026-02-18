import { useNavigate } from 'react-router-dom';
import { Hammer, ArrowLeft } from 'lucide-react';

export function UnderDevelopmentPage() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] bg-green-primary flex flex-col">
      <div className="p-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back</span>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-24 h-24 rounded-3xl bg-white/15 flex items-center justify-center mb-6">
          <Hammer size={48} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">Let's Build</h1>
        <p className="text-white/70 text-lg leading-relaxed">
          This section is under development.
        </p>
        <p className="text-white/50 text-sm mt-3">
          Check back soon.
        </p>
      </div>
    </div>
  );
}
