'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Router Error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0c] text-white p-6">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl flex flex-col gap-4">
        <h2 className="text-lg font-bold text-red-400">Application Error</h2>
        <p className="text-xs text-slate-400 font-mono bg-slate-950 p-3 rounded border border-slate-800 break-words">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={() => reset()}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded transition"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
