'use client';
import { useAuthenticationStatus, useUserData, useSignInEmailPassword, useSignOut, useSignUpEmailPassword } from '@nhost/react';
import { useState, useEffect } from 'react';

export function Auth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const { signInEmailPassword, isLoading: isSigningIn } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: isSigningUp } = useSignUpEmailPassword();
  const { signOut } = useSignOut();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading) {
    return <div className="flex h-screen items-center justify-center bg-[#0a0a0c] text-white">Loading Nhost Session...</div>;
  }

  const handleClearSession = async () => {
    localStorage.removeItem('nhostRefreshToken');
    localStorage.clear();
    try { await signOut(); } catch (e) {}
    window.location.reload();
  };

  if (!isAuthenticated) {
    const isSubmitting = isSigningIn || isSigningUp;

    return (
      <div className="relative flex flex-col h-screen items-center justify-center bg-[#030305] text-slate-200 p-4 overflow-hidden">
        {/* Futuristic Background Patterns */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/20 via-[#030305] to-[#010102]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c0c16_1px,transparent_1px),linear-gradient(to_bottom,#0c0c16_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30" />
        
        {/* Subtle Ambient Glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative w-full max-w-md z-10">
          {/* Logo / Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-black text-white text-xl shadow-lg shadow-indigo-500/20 mb-3 select-none">
              Ω
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white font-sans">Aethera Orchestrator</h1>
            <p className="text-xs text-slate-400 mt-1">Enterprise AI & Hasura Workflow Engine</p>
          </div>

          <form 
            className="flex flex-col gap-5 p-8 bg-slate-900/40 backdrop-blur-md rounded-2xl border border-slate-800/80 shadow-2xl transition-all duration-300 hover:border-slate-700/50"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              setInfoMessage('');

              if (!email || !password) {
                setError('Please fill in both email and password.');
                return;
              }

              try {
                let res;
                if (isSignUp) {
                  res = await signUpEmailPassword(email, password);
                  if (res.error) {
                    setError(res.error.message || 'Sign up failed.');
                  } else if (res.needsEmailVerification) {
                    setInfoMessage('Account created! Please check your email inbox to verify your account, or disable "Require Email Verification" in your Nhost Dashboard (Settings -> Auth).');
                  } else if (res.isSuccess) {
                    setInfoMessage('Account created successfully! You are now logged in.');
                  } else {
                    setInfoMessage('Sign up request completed. If email verification is enabled on your Nhost project, check your inbox.');
                  }
                } else {
                  res = await signInEmailPassword(email, password);
                  if (res.error) {
                    const msg = res.error.message || 'Sign in failed.';
                    if (msg.toLowerCase().includes('already signed in')) {
                      handleClearSession();
                      return;
                    }
                    if (msg.toLowerCase().includes('unverified') || msg.toLowerCase().includes('not verified')) {
                      setError('Your account is not verified yet. Please check your email for the verification link, or turn off "Require Email Verification" in your Nhost Dashboard (Settings -> Auth).');
                    } else {
                      setError(msg);
                    }
                  }
                }
              } catch (err: any) {
                setError(err.message || 'An unexpected error occurred.');
              }
            }}
          >
            <div className="flex justify-between items-center border-b border-slate-800/80 pb-4">
              <h2 className="text-lg font-semibold text-white tracking-wide">{isSignUp ? 'Create Workspace Profile' : 'Enterprise Authentication'}</h2>
              <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-mono px-2 py-0.5 rounded-full">Nhost Security</span>
            </div>

            {error && (
              <div className="text-red-400 bg-red-950/20 border border-red-900/50 p-3.5 rounded-xl text-xs leading-relaxed flex items-start gap-2.5">
                <span className="text-sm select-none">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {infoMessage && (
              <div className="text-emerald-400 bg-emerald-950/20 border border-emerald-900/50 p-3.5 rounded-xl text-xs leading-relaxed flex items-start gap-2.5">
                <span className="text-sm select-none">✓</span>
                <span>{infoMessage}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Email Address</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500 text-xs">✉</span>
                  <input 
                    type="email" 
                    placeholder="user@company.com" 
                    className="w-full pl-9 pr-3 py-2 bg-slate-950/40 border border-slate-800 focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-white text-sm transition-all outline-none"
                    value={email}
                    onChange={e => {
                      setEmail(e.target.value);
                      setError('');
                      setInfoMessage('');
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔒</span>
                  <input 
                    type="password" 
                    placeholder="••••••••" 
                    className="w-full pl-9 pr-3 py-2 bg-slate-950/40 border border-slate-800 focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-white text-sm transition-all outline-none"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value);
                      setError('');
                      setInfoMessage('');
                    }}
                  />
                </div>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 transition-all duration-300 mt-2 cursor-pointer flex items-center justify-center gap-2"
            >
              {isSubmitting && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isSubmitting ? (isSignUp ? 'Deploying Account...' : 'Authenticating...') : (isSignUp ? 'Create Account' : 'Sign In')}
            </button>

            <div className="flex justify-between items-center text-xs text-slate-400 pt-4 border-t border-slate-800/80">
              <button 
                type="button" 
                className="hover:text-white transition-colors" 
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError('');
                  setInfoMessage('');
                }}
              >
                {isSignUp ? 'Already registered? Sign In' : "Register new profile"}
              </button>
              <button 
                type="button" 
                className="text-slate-500 hover:text-slate-300 transition-colors"
                onClick={handleClearSession}
              >
                Reset Session
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
    </>
  );
}

