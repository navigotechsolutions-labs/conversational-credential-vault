import React, { useState, useEffect } from 'react';
import api, { setAccessToken } from '../api';
import { ShieldAlert, ShieldCheck, Lock, KeyRound, Smartphone } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Login fields
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);

  // Setup fields
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Fetch initial setup status of the vault
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await api.get('/auth/status');
      setIsSetup(response.data.isSetup);
    } catch (err) {
      setError('Could not connect to the backend server. Make sure it is running.');
      setIsSetup(true); // Set to true as fallback to render UI layout
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/auth/login', {
        masterPassword: password,
        totpCode: requires2FA ? totpCode : undefined,
      });

      if (response.data.requires2FA) {
        setRequires2FA(true);
        setLoading(false);
        return;
      }

      if (response.data.success) {
        setAccessToken(response.data.accessToken);
        onLoginSuccess(response.data.accessToken);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please verify your password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (newPassword.length < 8) {
      setError('Master password must be at least 8 characters long.');
      setLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      await api.post('/auth/setup', { masterPassword: newPassword });
      setIsSetup(true);
      setPassword('');
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to setup master account.');
    } finally {
      setLoading(false);
    }
  };

  if (isSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-navy-dark text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-blue"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-navy-dark px-4 font-sans relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-blue/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md bg-brand-navy-light/40 backdrop-blur-xl border border-white/5 rounded-2xl p-8 shadow-2xl relative">
        <div className="flex flex-col items-center justify-center mb-8">
          <div className="w-14 h-14 bg-brand-blue/10 border border-brand-blue/30 rounded-2xl flex items-center justify-center text-brand-blue mb-4 shadow-lg shadow-brand-blue/5 animate-pulse-slow">
            {isSetup ? <Lock className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
          </div>
          <h1 className="text-3xl font-extrabold text-white font-heading tracking-tight">
            CORE VAULT
          </h1>
          <p className="text-sm text-zinc-400 mt-1 font-medium">
            {isSetup ? 'NaviGo Secure Credential Store' : 'Initialize Master Account'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex gap-2 items-start">
            <span className="font-bold">Error:</span> {error}
          </div>
        )}

        {isSetup ? (
          /* Login Form */
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2" htmlFor="password">
                Master Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                  <KeyRound className="w-4 h-4" />
                </span>
                <input
                  id="password"
                  type="password"
                  className="w-full pl-10 pr-4 py-3 bg-brand-navy-dark/60 border border-white/10 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue text-white transition-all placeholder:text-zinc-600"
                  placeholder="Enter vault key..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {requires2FA && (
              <div className="animate-fadeIn">
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2" htmlFor="totpCode">
                  2FA Verification Code
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                    <Smartphone className="w-4 h-4" />
                  </span>
                  <input
                    id="totpCode"
                    type="text"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="w-full pl-10 pr-4 py-3 bg-brand-navy-dark/60 border border-white/10 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue text-white transition-all placeholder:text-zinc-600 font-mono tracking-[0.3em] text-center"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <p className="text-zinc-500 text-[10px] mt-2">Enter the 6-digit code from your authenticator app.</p>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 px-4 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 glow-button text-sm flex items-center justify-center gap-2 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-brand-navy"></div>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Unlock Vault
                </>
              )}
            </button>
          </form>
        ) : (
          /* First Run Setup Form */
          <form onSubmit={handleSetup} className="space-y-5">
            <div className="p-4 bg-brand-blue/5 border border-brand-blue/10 text-brand-blue text-xs rounded-xl mb-4">
              Welcome to <strong>Core Vault</strong>. Since this is your first time, set a master password below. This password will generate your secret key to encrypt all stored data at rest. <strong>Do not lose this password.</strong>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2" htmlFor="newPassword">
                Create Master Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                  <KeyRound className="w-4 h-4" />
                </span>
                <input
                  id="newPassword"
                  type="password"
                  minLength={8}
                  className="w-full pl-10 pr-4 py-3 bg-brand-navy-dark/60 border border-white/10 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue text-white transition-all placeholder:text-zinc-600"
                  placeholder="Min 8 characters..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2" htmlFor="confirmPassword">
                Confirm Master Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                  <KeyRound className="w-4 h-4" />
                </span>
                <input
                  id="confirmPassword"
                  type="password"
                  minLength={8}
                  className="w-full pl-10 pr-4 py-3 bg-brand-navy-dark/60 border border-white/10 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue text-white transition-all placeholder:text-zinc-600"
                  placeholder="Repeat master password..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 glow-button text-sm flex items-center justify-center gap-2 mt-4 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-brand-navy"></div>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Initialize Vault
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
