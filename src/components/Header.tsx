import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';

interface HeaderProps {
  title: string;
  showBack?: boolean;
}

export function Header({ title, showBack = false }: HeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isDashboard = location.pathname === '/';

  return (
    <header className="bg-green-primary text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-md">
      <div className="flex items-center gap-3">
        {showBack && !isDashboard && (
          <button
            onClick={() => navigate(-1)}
            className="p-1 -ml-1 hover:bg-green-dark rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
        )}
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>

      {isDashboard && (
        <button
          onClick={() => navigate('/settings')}
          className="p-1 hover:bg-green-dark rounded-lg transition-colors"
        >
          <Settings size={22} />
        </button>
      )}
    </header>
  );
}
