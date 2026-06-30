import React, { useState, useEffect } from 'react';
import api from '../api';
import { AlertTriangle, Save, X } from 'lucide-react';

interface ItemFormProps {
  itemId?: string | null; // If provided, we are in Edit Mode
  onClose: () => void;
  onSaveSuccess: () => void;
}

// Browser helper to hash a string to SHA-256 hex
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const ItemForm: React.FC<ItemFormProps> = ({ itemId, onClose, onSaveSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [type, setType] = useState<'api_key' | 'password' | 'repo' | 'skill' | 'note'>('api_key');
  const [title, setTitle] = useState('');
  const [service, setService] = useState('');
  const [project, setProject] = useState('');
  const [username, setUsername] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [usedInInput, setUsedInInput] = useState('');

  // Live duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState<{
    id: string;
    title: string;
    project: string;
    type: string;
  } | null>(null);

  // Fetch item details if editing
  useEffect(() => {
    if (itemId) {
      fetchItemDetails();
    }
  }, [itemId]);

  // Trigger live duplicate check when secret value changes
  useEffect(() => {
    if (type !== 'api_key' && type !== 'password') {
      setDuplicateWarning(null);
      return;
    }

    if (!secretValue || secretValue === '••••••••') {
      setDuplicateWarning(null);
      return;
    }

    const delayDebounce = setTimeout(() => {
      checkDuplicateHash();
    }, 500); // 500ms debounce

    return () => clearTimeout(delayDebounce);
  }, [secretValue, type]);

  const fetchItemDetails = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/items/${itemId}`);
      const item = response.data;
      
      setType(item.type);
      setTitle(item.title);
      setService(item.service || '');
      setProject(item.project || '');
      setUsername(item.username || '');
      setSecretValue('••••••••'); // Hidden by default, only overwrite on submit if user changed it
      setUrl(item.url || '');
      setNotes(item.notes || '');
      setTagsInput(item.tags ? item.tags.join(', ') : '');
      setUsedInInput(item.used_in ? item.used_in.join(', ') : '');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load item details');
    } finally {
      setLoading(false);
    }
  };

  const checkDuplicateHash = async () => {
    try {
      const hash = await sha256(secretValue);
      const response = await api.post('/items/check-hash', { hash });
      
      // If a duplicate item exists and it's not the one we are editing
      if (response.data.exists && response.data.item.id !== itemId) {
        setDuplicateWarning(response.data.item);
      } else {
        setDuplicateWarning(null);
      }
    } catch (err) {
      // Ignore hash check errors
      setDuplicateWarning(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Parse list arrays
    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const used_in = usedInInput
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const payload = {
      type,
      title,
      service: service || null,
      project: project || null,
      username: username || null,
      secret_value: secretValue === '••••••••' ? undefined : secretValue, // Only send if edited
      url: url || null,
      used_in,
      notes: notes || null,
      tags,
    };

    try {
      if (itemId) {
        await api.put(`/items/${itemId}`, payload);
      } else {
        await api.post('/items', payload);
      }
      onSaveSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-brand-navy-light/95 dark:bg-brand-navy-light/95 border border-white/10 rounded-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
          <h2 className="text-xl font-bold font-heading text-white">
            {itemId ? 'Edit Vault Item' : 'Add New Vault Item'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl">
            <strong>Error:</strong> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Main Item Types */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Item Type
            </label>
            <div className="grid grid-cols-5 gap-2 bg-brand-navy-dark/60 p-1 rounded-xl border border-white/5">
              {(['api_key', 'password', 'repo', 'skill', 'note'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`py-2 px-1 text-center text-xs font-bold rounded-lg uppercase tracking-wide transition-all ${
                    type === t
                      ? 'bg-brand-blue text-brand-navy'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Title *
              </label>
              <input
                type="text"
                className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                placeholder="e.g. Kite Connect API Key"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Service */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Service / Brand
              </label>
              <input
                type="text"
                className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                placeholder="e.g. Zerodha Kite, Claude API, Hostinger"
                value={service}
                onChange={e => setService(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Primary Project */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Primary Project Group
              </label>
              <input
                type="text"
                className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                placeholder="e.g. Stock Signal Bot, NaviGo Web"
                value={project}
                onChange={e => setProject(e.target.value)}
              />
            </div>

            {/* Username */}
            {['api_key', 'password'].includes(type) && (
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Username / Identity Email
                </label>
                <input
                  type="text"
                  className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                  placeholder="e.g. user@email.com or api_client_id"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Secret Value field (Only for api_key and password) */}
          {['api_key', 'password'].includes(type) && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Secret Value * {itemId && '(Type new password to overwrite)'}
              </label>
              <input
                type="password"
                className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all font-mono"
                placeholder={itemId ? '••••••••' : 'Paste API Key or Password...'}
                value={secretValue}
                onChange={e => setSecretValue(e.target.value)}
                required={!itemId}
              />

              {/* Live duplicate warning */}
              {duplicateWarning && (
                <div className="mt-3 p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-xl flex items-start gap-2.5 animate-pulse-slow">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Duplicate Warning:</span> This credential already exists as{' '}
                    <strong className="text-white">'{duplicateWarning.title}'</strong> in project{' '}
                    <strong className="text-white">'{duplicateWarning.project || 'None'}'</strong>.
                    You should update that item instead of saving duplicates!
                  </div>
                </div>
              )}
            </div>
          )}

          {/* URL */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              URL / Link
            </label>
            <input
              type="url"
              className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
              placeholder="e.g. https://github.com/org/repo, login panel, webhook link"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Search Tags (comma-separated)
              </label>
              <input
                type="text"
                className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                placeholder="e.g. prod, webhook, telegram, zerodha"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
              />
            </div>

            {/* Used In List */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                All Projects/Workflows Used In (comma-separated)
              </label>
              <input
                type="text"
                className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all"
                placeholder="e.g. Stock Signals, n8n Ingest Workflow"
                value={usedInInput}
                onChange={e => setUsedInInput(e.target.value)}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Notes (Setup guides, server configuration details, webhook templates, etc.)
            </label>
            <textarea
              className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-all font-sans min-h-[120px]"
              placeholder="Provide configuration info..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/5 pt-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 bg-transparent hover:bg-white/5 border border-white/10 text-zinc-300 hover:text-white text-xs font-bold rounded-xl transition-all"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-2.5 px-5 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy text-xs font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/10 flex items-center gap-1.5 disabled:opacity-50"
              disabled={loading}
            >
              <Save className="w-3.5 h-3.5" />
              Save Item
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
