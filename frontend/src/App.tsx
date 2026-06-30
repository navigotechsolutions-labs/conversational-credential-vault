import React, { useState, useEffect, useRef } from 'react';
import { Login } from './components/Login';
import { VaultDashboard } from './components/VaultDashboard';
import api, { setAccessToken, subscribeTokenRefresh } from './api';
import { ShieldAlert } from 'lucide-react';

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactiveLocked, setInactiveLocked] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 10 minutes in milliseconds
  const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

  useEffect(() => {
    // Attempt to refresh token on startup to resume active session
    attemptSessionResume();

    // Subscribe to automatic refreshes triggered by the API client
    subscribeTokenRefresh((newToken) => {
      setToken(newToken);
      resetIdleTimer();
    });

    return () => {
      clearIdleTimer();
      removeActivityListeners();
    };
  }, []);

  // Monitor token state to bind/unbind activity listeners
  useEffect(() => {
    if (token) {
      setInactiveLocked(false);
      resetIdleTimer();
      addActivityListeners();
    } else {
      clearIdleTimer();
      removeActivityListeners();
    }
  }, [token]);

  const attemptSessionResume = async () => {
    try {
      const response = await api.post('/auth/refresh');
      const accessToken = response.data.accessToken;
      setAccessToken(accessToken);
      setToken(accessToken);
    } catch (err) {
      // No valid refresh session, ignore and display login
    } finally {
      setLoading(false);
    }
  };

  // Idle timer logic
  const resetIdleTimer = () => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(lockVaultDueToInactivity, IDLE_TIMEOUT_MS);
  };

  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const lockVaultDueToInactivity = async () => {
    try {
      // Purge backend memory session
      await api.post('/auth/logout');
    } catch (err) {
      // Ignore network errors during timeout lock
    }
    
    setAccessToken(null);
    setToken(null);
    setInactiveLocked(true);
  };

  // Activity listeners to reset idle timer
  const handleUserActivity = () => {
    resetIdleTimer();
  };

  const addActivityListeners = () => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((event) => {
      window.addEventListener(event, handleUserActivity);
    });
  };

  const removeActivityListeners = () => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((event) => {
      window.removeEventListener(event, handleUserActivity);
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-navy-dark text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-blue"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-navy-dark text-white transition-colors duration-300">
      {inactiveLocked && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2 shadow-xl backdrop-blur-md animate-slideIn">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>Vault locked automatically due to 10 minutes of inactivity.</span>
          <button 
            onClick={() => setInactiveLocked(false)} 
            className="ml-2 text-zinc-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {token ? (
        <VaultDashboard onLogout={() => setToken(null)} />
      ) : (
        <Login onLoginSuccess={(newToken) => setToken(newToken)} />
      )}
    </div>
  );
};

export default App;
