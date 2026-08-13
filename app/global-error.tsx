'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0c] text-white flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl flex flex-col gap-4">
          <h2 className="text-lg font-bold text-red-400">Global Error</h2>
          <p className="text-xs text-slate-400 font-mono bg-slate-950 p-3 rounded border border-slate-800 break-words">
            {error.message || 'An unexpected system error occurred.'}
          </p>
          <button
            onClick={() => reset()}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded transition"
          >
            Reset Application
          </button>
        </div>
      </body>
    </html>
  );
}
