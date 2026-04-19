import { useState, type ReactNode } from 'react';

// Simple client-side password gate. Not high-security — just prevents
// accidental edits by casual visitors. The data itself is public via
// the Google Sheets API anyway.

const STORAGE_KEY = 'compost_auth';

// SHA-256 hash of the password, computed once and hardcoded.
// To change the password, update this hash.
const PASSWORD_HASH = 'ec407bb3b370f28fe7f90a00bc3ab642e0434bae596019039e29aee8bb005d33';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function isAuthed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(isAuthed);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  if (authed) return <>{children}</>;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(false);
    const hash = await sha256(input.trim());
    if (hash === PASSWORD_HASH) {
      localStorage.setItem(STORAGE_KEY, 'true');
      setAuthed(true);
    } else {
      setError(true);
    }
    setChecking(false);
  }

  return (
    <div className="h-[100dvh] bg-green-primary flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex flex-col items-center gap-3 mb-6">
          <img
            src="/fuller-light-logo.jpg"
            alt="Fuller Light Ltd."
            className="w-16 h-16 rounded-xl object-contain bg-white shadow-md p-1"
          />
          <h1 className="text-xl font-bold text-green-primary">Compost Monitor</h1>
          <p className="text-sm text-gray-500 text-center">Enter password to access the full app</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
            className={`w-full px-4 py-3 border rounded-xl text-lg outline-none transition-colors ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-green-primary'
            }`}
          />
          {error && (
            <p className="text-sm text-red-500 text-center">Incorrect password</p>
          )}
          <button
            type="submit"
            disabled={checking || !input.trim()}
            className="w-full py-3 bg-green-primary text-white font-semibold rounded-xl disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {checking ? 'Checking...' : 'Enter'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Just want to view data?{' '}
          <a href="/view" className="text-green-primary underline">Open read-only view</a>
        </p>
      </div>
    </div>
  );
}
