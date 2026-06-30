import React, { useState, useEffect } from 'react';
import api from '../api';
import { KeyRound, Smartphone, ShieldCheck, Download, Upload, Eye, EyeOff, CheckCircle } from 'lucide-react';

interface SettingsPanelProps {
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Master password change states
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // 2FA states
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [setup2FAData, setSetup2FAData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disable2FAPrompt, setDisable2FAPrompt] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  // Backup states
  const [importing, setImporting] = useState(false);

  // API settings states
  const [geminiKey, setGeminiKey] = useState('');
  const [hostingerToken, setHostingerToken] = useState('');
  const [corsOrigin, setCorsOrigin] = useState('');
  const [geminiKeyConfigured, setGeminiKeyConfigured] = useState(false);
  const [hostingerTokenConfigured, setHostingerTokenConfigured] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showHostingerToken, setShowHostingerToken] = useState(false);

  useEffect(() => {
    fetch2FAStatus();
    fetchSystemSettings();
  }, []);

  const fetchSystemSettings = async () => {
    try {
      const response = await api.get('/settings');
      setCorsOrigin(response.data.corsOrigin || '');
      setGeminiKeyConfigured(response.data.geminiApiKeyConfigured);
      setHostingerTokenConfigured(response.data.hostingerApiTokenConfigured);
      
      if (response.data.geminiApiKeyConfigured) {
        setGeminiKey('••••••••••••••••');
      } else {
        setGeminiKey('');
      }
      if (response.data.hostingerApiTokenConfigured) {
        setHostingerToken('••••••••••••••••');
      } else {
        setHostingerToken('');
      }
    } catch (err) {
      console.error('Failed to load system settings:', err);
    }
  };

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post('/settings', {
        geminiApiKey: geminiKey,
        hostingerApiToken: hostingerToken,
        corsOrigin: corsOrigin
      });
      setSuccess('API integrations saved successfully!');
      fetchSystemSettings(); // refresh status
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setLoading(false);
    }
  };

  const fetch2FAStatus = async () => {
    try {
      const response = await api.get('/auth/status');
      setTotpEnabled(response.data.totpEnabled || false);
    } catch (err) {
      console.error('Failed to fetch 2FA status:', err);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/change-password', {
        oldPassword,
        newPassword
      });
      setSuccess(response.data.message || 'Password changed successfully!');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  const start2FASetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post('/auth/setup-2fa');
      setSetup2FAData({
        secret: response.data.secret,
        qrCodeUrl: response.data.qrCodeUrl
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to initiate 2FA setup.');
    } finally {
      setLoading(false);
    }
  };

  const verifyAndEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/verify-2fa', {
        secret: setup2FAData?.secret,
        code: totpCode
      });
      setTotpEnabled(true);
      setSetup2FAData(null);
      setTotpCode('');
      setSuccess('2FA enabled successfully!');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/disable-2fa', {
        masterPassword: disablePassword
      });
      setTotpEnabled(false);
      setDisable2FAPrompt(false);
      setDisablePassword('');
      setSuccess('2FA disabled successfully.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to disable 2FA.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      setError(null);
      setSuccess(null);
      const response = await api.get('/export', { responseType: 'blob' });
      
      const blob = new Blob([response.data], { type: 'application/octet-stream' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `core-vault-backup-${new Date().toISOString().split('T')[0]}.json.enc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      setSuccess('Encrypted backup downloaded successfully.');
    } catch (err: any) {
      setError('Backup export failed. Make sure the vault is unlocked.');
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const binaryData = event.target?.result;
          if (!binaryData) {
            throw new Error('Could not read file binary data');
          }

          const response = await api.post('/import', binaryData, {
            headers: {
              'Content-Type': 'application/octet-stream'
            }
          });

          setSuccess(response.data.message || 'Backup imported successfully!');
        } catch (err: any) {
          setError(err.response?.data?.error || 'Backup import failed. Ensure file password is correct.');
        } finally {
          setImporting(false);
          // Reset file input
          e.target.value = '';
        }
      };

      reader.readAsArrayBuffer(file);
    } catch (err) {
      setError('Failed to read backup file.');
      setImporting(false);
    }
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-brand-navy-light/95 border border-white/10 rounded-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
          <h2 className="text-xl font-bold font-heading text-white">Vault Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors py-1 px-3 bg-white/5 hover:bg-white/10 rounded-lg text-xs"
          >
            Close Settings
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl">
            <strong>Error:</strong> {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <div>{success}</div>
          </div>
        )}

        <div className="space-y-8">
          {/* Section 1: Change Master Password */}
          <div className="bg-brand-navy-dark/40 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-blue mb-4 flex items-center gap-2 font-heading">
              <KeyRound className="w-4 h-4" /> Change Master Password
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              Updating your master password will decrypt all current credentials and re-encrypt them with a newly derived key. This might take a few moments if you have many items.
            </p>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Current Master Password</label>
                <div className="relative">
                  <input
                    type={showOldPass ? 'text' : 'password'}
                    className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                    value={oldPassword}
                    onChange={e => setOldPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowOldPass(!showOldPass)}
                    className="absolute right-3 top-2.5 text-zinc-500 hover:text-white"
                  >
                    {showOldPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5">New Master Password</label>
                  <div className="relative">
                    <input
                      type={showNewPass ? 'text' : 'password'}
                      className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPass(!showNewPass)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-white"
                    >
                      {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Confirm New Password</label>
                  <input
                    type="password"
                    className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="py-2 px-4 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy text-xs font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/10 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Processing Re-encryption...' : 'Update & Re-key Vault'}
              </button>
            </form>
          </div>

          {/* Section 2: Two-Factor Authentication (2FA) */}
          <div className="bg-brand-navy-dark/40 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-blue mb-4 flex items-center gap-2 font-heading">
              <Smartphone className="w-4 h-4" /> Two-Factor Authentication (2FA)
            </h3>

            {!totpEnabled && !setup2FAData && (
              <div>
                <p className="text-xs text-zinc-400 mb-4">
                  Add an extra layer of security to your vault. When enabled, logging in will require entering a 6-digit verification code from Google Authenticator, Authy, or another TOTP authenticator app.
                </p>
                <button
                  type="button"
                  onClick={start2FASetup}
                  className="py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-xl transition-all"
                  disabled={loading}
                >
                  Setup 2FA TOTP
                </button>
              </div>
            )}

            {setup2FAData && (
              <form onSubmit={verifyAndEnable2FA} className="space-y-4">
                <p className="text-xs text-zinc-300 font-medium">
                  Scan the QR code below using your authenticator app (e.g. Google Authenticator), then enter the 6-digit verification code to confirm:
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-6 py-4">
                  <div className="p-3 bg-white rounded-xl shadow-lg">
                    <img src={setup2FAData.qrCodeUrl} alt="2FA QR Code" className="w-40 h-40" />
                  </div>
                  <div className="space-y-3 flex-1 w-full">
                    <div>
                      <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Secret Key (Manual Entry)</span>
                      <code className="text-xs font-mono bg-brand-navy-dark/80 text-white rounded px-2 py-1.5 block select-all border border-white/5">
                        {setup2FAData.secret}
                      </code>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1">Verification Code</label>
                      <input
                        type="text"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all font-mono tracking-[0.2em] text-center"
                        placeholder="000000"
                        value={totpCode}
                        onChange={e => setTotpCode(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="py-2 px-4 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy text-xs font-bold rounded-xl transition-all"
                    disabled={loading}
                  >
                    Verify and Enable
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetup2FAData(null)}
                    className="py-2 px-4 bg-transparent hover:bg-white/5 border border-white/10 text-zinc-400 text-xs rounded-xl"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {totpEnabled && !disable2FAPrompt && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                  <ShieldCheck className="w-4 h-4" /> Two-Factor Authentication is Active
                </div>
                <p className="text-xs text-zinc-400">
                  Your account is secured with a TOTP verification code challenge on login.
                </p>
                <button
                  type="button"
                  onClick={() => setDisable2FAPrompt(true)}
                  className="py-2 px-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs font-bold rounded-xl transition-all"
                >
                  Disable 2FA
                </button>
              </div>
            )}

            {disable2FAPrompt && (
              <form onSubmit={handleDisable2FA} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Enter Master Password to confirm disabling 2FA</label>
                  <input
                    type="password"
                    className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                    value={disablePassword}
                    onChange={e => setDisablePassword(e.target.value)}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="py-2 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all"
                    disabled={loading}
                  >
                    Confirm Disable
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDisable2FAPrompt(false);
                      setDisablePassword('');
                    }}
                    className="py-2 px-4 bg-transparent hover:bg-white/5 border border-white/10 text-zinc-400 text-xs rounded-xl"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Section 3: Backup Operations */}
          <div className="bg-brand-navy-dark/40 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-blue mb-4 flex items-center gap-2 font-heading">
              <Download className="w-4 h-4" /> Backup & Recovery
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              Download your vault items as a binary-encrypted file (`.json.enc`). The backup is encrypted using your active master password derived key, meaning it cannot be opened without your password.
            </p>

            <div className="flex flex-wrap gap-3">
              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportBackup}
                className="py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
                disabled={loading}
              >
                <Download className="w-3.5 h-3.5" /> Export Encrypted Backup
              </button>

              {/* Import Button */}
              <label className="py-2 px-4 bg-brand-blue/10 hover:bg-brand-blue/20 border border-brand-blue/20 text-brand-blue text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer">
                {importing ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-brand-blue"></div>
                    Importing Backup...
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" /> Import Encrypted Backup
                  </>
                )}
                <input
                  type="file"
                  accept=".enc"
                  onChange={handleImportBackup}
                  className="hidden"
                  disabled={importing}
                />
              </label>
            </div>
          </div>

          {/* Section 4: API Integrations & System Keys */}
          <div className="bg-brand-navy-dark/40 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-blue mb-4 flex items-center gap-2 font-heading">
              <KeyRound className="w-4 h-4" /> API Integrations & System Keys
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              Configure your global API tokens to enable conversational Gemini features, Hostinger domain management, and Nginx CORS routing.
            </p>

            <form onSubmit={handleSaveIntegrations} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5 flex items-center gap-1.5">
                    Gemini API Key 
                    {geminiKeyConfigured && <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">Active</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showGeminiKey ? 'text' : 'password'}
                      placeholder={geminiKeyConfigured ? '••••••••••••••••' : 'AIzaSy...'}
                      className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                      value={geminiKey}
                      onChange={e => setGeminiKey(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-white"
                    >
                      {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5 flex items-center gap-1.5">
                    Hostinger API Token
                    {hostingerTokenConfigured && <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">Active</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showHostingerToken ? 'text' : 'password'}
                      placeholder={hostingerTokenConfigured ? '••••••••••••••••' : 'Enter Hostinger API Token...'}
                      className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                      value={hostingerToken}
                      onChange={e => setHostingerToken(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowHostingerToken(!showHostingerToken)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-white"
                    >
                      {showHostingerToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">CORS Origin URL</label>
                <input
                  type="text"
                  placeholder="https://core.navigotechsolutions.com"
                  className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                  value={corsOrigin}
                  onChange={e => setCorsOrigin(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="py-2 px-4 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy text-xs font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/10 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save API Integrations'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
