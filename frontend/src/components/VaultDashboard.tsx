import React, { useState, useEffect, useRef } from 'react';
import api from '../api';
import { ItemForm } from './ItemForm';
import { SettingsPanel } from './SettingsPanel';
import { 
  Search, 
  Sparkles, 
  Plus, 
  Settings, 
  LogOut, 
  Key, 
  Lock, 
  Globe, 
  BookOpen, 
  FileText,
  Copy,
  Eye,
  EyeOff,
  Clock,
  Edit2,
  Trash2,
  Send,
  Check,
  FolderOpen,
  Pin
} from 'lucide-react';

interface VaultItem {
  id: string;
  type: 'api_key' | 'password' | 'repo_link' | 'note' | 'snippet';
  title: string;
  service?: string;
  project?: string;
  username?: string;
  url?: string;
  used_in?: string;
  notes?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  intent?: 'save' | 'retrieve' | 'greet';
  type?: 'confident' | 'ambiguous' | 'none';
  item?: VaultItem;
  matches?: VaultItem[];
}

interface VaultDashboardProps {
  onLogout: () => void;
}

export const VaultDashboard: React.FC<VaultDashboardProps> = ({ onLogout }) => {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter sidebar state
  const [sidebarSearch, setSidebarSearch] = useState('');

  // Conversational Chat state (starts empty like ChatGPT)
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  // Reveal / Copy states (Supports active countdowns per item)
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealCountdown, setRevealCountdown] = useState<number | null>(null);

  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copyCountdown, setCopyCountdown] = useState<number | null>(null);

  // Re-authentication states (for stale sessions)
  const [reauthPrompt, setReauthPrompt] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthItemId, setReauthItemId] = useState<string | null>(null);
  const [reauthAction, setReauthAction] = useState<'reveal' | 'copy' | null>(null);

  // Settings & Edit modals
  const [showSettings, setShowSettings] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load item index for sidebar on mount
  useEffect(() => {
    fetchItems();
  }, []);

  // Scroll to bottom on chat updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Timers for reveal and copy countdowns
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (revealCountdown !== null && revealCountdown > 0) {
      timer = setTimeout(() => setRevealCountdown(revealCountdown - 1), 1000);
    } else if (revealCountdown === 0) {
      setRevealedSecret(null);
      setRevealedItemId(null);
      setRevealCountdown(null);
    }
    return () => clearTimeout(timer);
  }, [revealCountdown, revealedItemId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (copyCountdown !== null && copyCountdown > 0) {
      timer = setTimeout(() => setCopyCountdown(copyCountdown - 1), 1000);
    } else if (copyCountdown === 0) {
      navigator.clipboard.writeText('');
      setCopiedItemId(null);
      setCopyCountdown(null);
    }
    return () => clearTimeout(timer);
  }, [copyCountdown, copiedItemId]);

  const fetchItems = async () => {
    try {
      setError(null);
      const response = await api.get('/items');
      setItems(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch items list');
    }
  };

  const handleSendChat = async (textToSend?: string) => {
    const input = textToSend || chatInput;
    if (!input.trim()) return;

    setSendingChat(true);
    setError(null);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: input
    };
    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setChatInput('');

    try {
      const response = await api.post('/chat', { message: input });
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: response.data.text,
        intent: response.data.intent,
        type: response.data.type,
        item: response.data.item,
        matches: response.data.matches
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (response.data.intent === 'save') {
        fetchItems();
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to connect to the assistant.';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: `⚠️ **Error:** ${errorMsg}`
      }]);
    } finally {
      setSendingChat(false);
    }
  };

  const handleReveal = async (itemId: string, passwordForReauth?: string) => {
    setError(null);
    try {
      const response = await api.post(`/items/${itemId}/reveal`, {
        masterPassword: passwordForReauth
      });

      setRevealedSecret(response.data.secret_value);
      setRevealedItemId(itemId);
      setRevealCountdown(20);
      setReauthPrompt(false);
      setReauthPassword('');
      setReauthItemId(null);
      setReauthAction(null);
    } catch (err: any) {
      if (err.response?.data?.code === 'REAUTH_REQUIRED') {
        setReauthItemId(itemId);
        setReauthAction('reveal');
        setReauthPrompt(true);
      } else {
        setError(err.response?.data?.error || 'Failed to reveal credential.');
      }
    }
  };

  const handleCopy = async (itemId: string, passwordForReauth?: string) => {
    setError(null);
    try {
      const response = await api.post(`/items/${itemId}/reveal`, {
        masterPassword: passwordForReauth
      });

      await navigator.clipboard.writeText(response.data.secret_value);
      setCopiedItemId(itemId);
      setCopyCountdown(20);
      setReauthPrompt(false);
      setReauthPassword('');
      setReauthItemId(null);
      setReauthAction(null);
    } catch (err: any) {
      if (err.response?.data?.code === 'REAUTH_REQUIRED') {
        setReauthItemId(itemId);
        setReauthAction('copy');
        setReauthPrompt(true);
      } else {
        setError(err.response?.data?.error || 'Failed to copy credential.');
      }
    }
  };

  const handleReauthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthItemId) return;
    if (reauthAction === 'reveal') {
      handleReveal(reauthItemId, reauthPassword);
    } else if (reauthAction === 'copy') {
      handleCopy(reauthItemId, reauthPassword);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this item? This action is irreversible.')) {
      return;
    }
    try {
      await api.delete(`/items/${id}`);
      fetchItems();
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: '🗑️ Item was successfully deleted from the database.'
      }]);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete item.');
    }
  };

  const handleLogoutClick = async () => {
    try {
      await api.post('/auth/logout');
      onLogout();
    } catch (err) {
      onLogout();
    }
  };

  const handleSidebarItemClick = (item: VaultItem) => {
    handleSendChat(`Retrieve details for: "${item.title}"`);
  };

  const startNewChat = () => {
    setMessages([]);
    setChatInput('');
    setError(null);
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(sidebarSearch.toLowerCase()) || 
                          (item.service && item.service.toLowerCase().includes(sidebarSearch.toLowerCase())) ||
                          (item.project && item.project.toLowerCase().includes(sidebarSearch.toLowerCase()));
    return matchesSearch;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'api_key': return <Key className="w-4 h-4 text-brand-blue" />;
      case 'password': return <Lock className="w-4 h-4 text-emerald-400" />;
      case 'repo_link': return <Globe className="w-4 h-4 text-purple-400" />;
      case 'note': return <BookOpen className="w-4 h-4 text-amber-400" />;
      case 'snippet': return <FileText className="w-4 h-4 text-zinc-400" />;
      default: return <FileText className="w-4 h-4 text-zinc-400" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'api_key': return 'API Key';
      case 'password': return 'Password';
      case 'repo_link': return 'GitHub Repo';
      case 'note': return 'Skills Note';
      case 'snippet': return 'Text Snippet';
      default: return 'Snippet';
    }
  };

  // Extract distinct projects and pinned items (items tagged 'pinned')
  const allProjects = Array.from(new Set(items.map(item => item.project).filter(Boolean))) as string[];
  const pinnedItems = items.filter(item => item.tags.includes('pinned'));

  return (
    <div className="min-h-screen bg-brand-navy-dark text-white grid grid-cols-1 md:grid-cols-4 overflow-hidden h-screen font-sans">
      
      {/* 1. Sidebar Index Panel (Col 1) - Replicating ChatGPT Sidebar */}
      <aside className="col-span-1 border-r border-white/5 bg-brand-navy-light/30 flex flex-col h-full overflow-hidden">
        
        {/* Sidebar Header: New Chat Button */}
        <div className="p-3.5 flex gap-2">
          <button 
            onClick={startNewChat}
            className="flex-1 flex items-center justify-between px-3.5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-semibold text-zinc-200 transition-all font-heading"
          >
            <span>New chat</span>
            <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
          </button>
          <button 
            onClick={() => { setEditingItemId(null); setShowItemForm(true); }}
            className="p-2.5 bg-brand-blue hover:bg-brand-blue-hover text-brand-navy rounded-xl transition-all shadow-md shadow-brand-blue/10 flex items-center justify-center"
            title="Create New Item Manually"
          >
            <Plus className="w-4 h-4 font-bold" />
          </button>
        </div>

        {/* Index Search */}
        <div className="px-3.5 pb-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search chats & index..." 
              className="w-full bg-brand-navy-dark/60 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-brand-blue transition-all"
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Scrollable Sidebar Categories */}
        <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-5 custom-scrollbar">
          
          {/* Pinned Section */}
          {pinnedItems.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block px-1 flex items-center gap-1.5">
                <Pin className="w-2.5 h-2.5 rotate-45" /> Pinned
              </span>
              {pinnedItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleSidebarItemClick(item)}
                  className="w-full text-left py-2 px-2 hover:bg-white/5 rounded-lg text-xs text-zinc-300 hover:text-white truncate transition-all block"
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}

          {/* Projects Folder List */}
          {allProjects.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block px-1 flex items-center gap-1.5">
                <FolderOpen className="w-2.5 h-2.5" /> Projects
              </span>
              {allProjects.map(project => (
                <button
                  key={project}
                  onClick={() => handleSendChat(`List all items for project: "${project}"`)}
                  className="w-full text-left py-2 px-2 hover:bg-white/5 rounded-lg text-xs text-zinc-300 hover:text-white truncate transition-all block"
                >
                  {project}
                </button>
              ))}
            </div>
          )}

          {/* Recent Chats / Items List */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block px-1 flex items-center gap-1.5">
              <Clock className="w-2.5 h-2.5" /> Chats & Vault Index
            </span>
            {filteredItems.map(item => (
              <button
                key={item.id}
                onClick={() => handleSidebarItemClick(item)}
                className="w-full text-left py-2 px-2 hover:bg-white/5 rounded-lg text-xs text-zinc-300 hover:text-white truncate transition-all flex items-center gap-2"
              >
                {getTypeIcon(item.type)}
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>

        </div>

        {/* Sidebar Footer Controls */}
        <div className="p-3 border-t border-white/5 bg-brand-navy-dark/40 flex items-center justify-between">
          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-all py-1.5 px-3 hover:bg-white/5 rounded-lg"
          >
            <Settings className="w-3.5 h-3.5" /> Settings
          </button>
          
          {/* User profile identifier block matching 'Navigo' */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-brand-blue/20 border border-brand-blue/40 flex items-center justify-center text-[10px] font-bold text-brand-blue font-heading">
              N
            </div>
            <span className="text-xs text-zinc-300 font-semibold">Navigo</span>
          </div>

          <button 
            onClick={handleLogoutClick}
            className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/5 rounded-lg transition-all"
            title="Lock Vault"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* 2. Main Workspace: ChatGPT-Style Interface (Col 3) */}
      <main className="col-span-1 md:col-span-3 flex flex-col h-full overflow-hidden bg-brand-navy-dark">
        
        {/* Header toolbar */}
        <div className="h-14 border-b border-white/5 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold font-heading text-zinc-400">Vault Brain</span>
            <span className="text-xs text-brand-blue bg-brand-blue/10 border border-brand-blue/20 px-2 py-0.5 rounded-full font-bold">Gemini Active</span>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex justify-between items-center animate-fadeIn flex-shrink-0">
            <span><strong>Error:</strong> {error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-white font-bold ml-2">✕</button>
          </div>
        )}

        {/* Message Thread vs Landing Panel */}
        {messages.length === 0 ? (
          /* Empty Chat Landing Screen: Center layout matching screenshot */
          <div className="flex-1 overflow-y-auto px-4 py-8 flex flex-col justify-center items-center max-w-2xl mx-auto w-full space-y-8 select-none">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 bg-brand-blue/10 border border-brand-blue/20 rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-brand-blue/5">
                <Sparkles className="w-8 h-8 text-brand-blue animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold font-heading text-white">Where should we begin?</h2>
            </div>
            
            {/* Landing Input Box */}
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSendChat(); }} 
              className="w-full bg-brand-navy-light/60 border border-white/10 rounded-[32px] p-3 flex flex-col gap-2 focus-within:ring-1 focus-within:ring-brand-blue focus-within:border-brand-blue transition-all shadow-xl"
            >
              <textarea
                placeholder="Ask anything or paste credentials..."
                className="w-full bg-transparent border-none text-sm text-white focus:outline-none resize-none px-3 pt-2 pb-1 min-h-[56px] custom-scrollbar"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                disabled={sendingChat}
                rows={2}
              />
              <div className="flex justify-between items-center px-2">
                <button 
                  type="button" 
                  onClick={() => { setEditingItemId(null); setShowItemForm(true); }} 
                  className="text-zinc-500 hover:text-zinc-300 text-xs flex items-center gap-1.5 py-1 px-2.5 hover:bg-white/5 rounded-lg transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add manual item
                </button>
                <button 
                  type="submit" 
                  disabled={sendingChat || !chatInput.trim()} 
                  className="p-2 bg-brand-blue disabled:bg-brand-blue/30 text-brand-navy rounded-full hover:bg-brand-blue-hover transition-all flex items-center justify-center"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {/* Quick Actions / Helpers */}
            <div className="flex flex-wrap gap-2 justify-center w-full max-w-lg">
              <button 
                onClick={() => handleSendChat("What did I save today?")}
                className="px-4 py-2.5 bg-brand-navy-light/35 hover:bg-white/5 border border-white/5 hover:border-white/10 rounded-2xl text-[11px] text-zinc-300 font-semibold transition-all"
              >
                📅 What did I save today?
              </button>
              <button 
                onClick={() => handleSendChat("Show credentials saved last week")}
                className="px-4 py-2.5 bg-brand-navy-light/35 hover:bg-white/5 border border-white/5 hover:border-white/10 rounded-2xl text-[11px] text-zinc-300 font-semibold transition-all"
              >
                🕒 Saved last week
              </button>
              <button 
                onClick={() => handleSendChat("List all my API keys")}
                className="px-4 py-2.5 bg-brand-navy-light/35 hover:bg-white/5 border border-white/5 hover:border-white/10 rounded-2xl text-[11px] text-zinc-300 font-semibold transition-all"
              >
                🔑 List API Keys
              </button>
            </div>
          </div>
        ) : (
          /* Active Chat Thread */
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map(msg => (
                <div 
                  key={msg.id} 
                  className={`flex gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'assistant' && (
                    <div className="w-8 h-8 rounded-xl bg-brand-navy-light border border-white/5 flex items-center justify-center flex-shrink-0 text-zinc-400">
                      <Sparkles className="w-4 h-4 text-brand-blue animate-pulse" />
                    </div>
                  )}

                  <div className="space-y-3 max-w-[85%]">
                    <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.sender === 'user'
                        ? 'bg-brand-navy-light text-zinc-100 border border-white/5 rounded-tr-none'
                        : 'bg-brand-navy-light/40 text-zinc-200 border border-transparent rounded-tl-none'
                    }`}>
                      {msg.text}
                    </div>

                    {/* interactive matches & confident items */}
                    {msg.item && (
                      <div className="bg-gradient-to-r from-brand-navy-light/60 to-brand-navy-dark/40 border border-brand-blue/20 rounded-2xl p-4 shadow-xl space-y-4 max-w-lg animate-fadeIn">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                          <div className="flex items-center gap-2">
                            {getTypeIcon(msg.item.type)}
                            <div>
                              <h4 className="text-xs font-bold text-white leading-tight">{msg.item.title}</h4>
                              <span className="text-[10px] text-zinc-400">{getTypeLabel(msg.item.type)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => { setEditingItemId(msg.item!.id); setShowItemForm(true); }}
                              className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => handleDeleteItem(msg.item!.id)}
                              className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/5 rounded-lg transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-[11px] border-b border-white/5 pb-3">
                          <div>
                            <span className="text-zinc-500 block">Service</span>
                            <span className="text-zinc-300 font-semibold">{msg.item.service || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Project Context</span>
                            <span className="text-zinc-300 font-semibold">{msg.item.project || 'General'}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Saved On</span>
                            <span className="text-zinc-300 font-semibold">
                              {new Date(msg.item.created_at).toLocaleDateString(undefined, { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                          {msg.item.username && (
                            <div>
                              <span className="text-zinc-500 block">Username</span>
                              <span className="text-zinc-300 font-semibold truncate">{msg.item.username}</span>
                            </div>
                          )}
                          {msg.item.url && (
                            <div>
                              <span className="text-zinc-500 block">URL</span>
                              <a href={msg.item.url} target="_blank" rel="noreferrer" className="text-brand-blue hover:underline font-semibold flex items-center gap-0.5 truncate">
                                Link <Clock className="w-2.5 h-2.5 inline" />
                              </a>
                            </div>
                          )}
                        </div>

                        {msg.item.notes && (
                          <div className="text-[11px] text-zinc-400 bg-black/10 p-2.5 rounded-xl border border-white/5">
                            <span className="text-zinc-500 block mb-1">Notes / Context</span>
                            {msg.item.notes}
                          </div>
                        )}

                        <div className="bg-brand-navy-dark/80 border border-white/10 rounded-xl p-3 flex items-center justify-between">
                          <div className="flex-1 min-w-0 mr-4">
                            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider block">Secret Value</span>
                            <span className="text-xs font-mono block select-all break-all text-brand-blue">
                              {revealedItemId === msg.item.id && revealedSecret 
                                ? revealedSecret 
                                : '••••••••••••••••••••'}
                            </span>
                          </div>
                          
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                if (revealedItemId === msg.item!.id) {
                                  setRevealedSecret(null);
                                  setRevealedItemId(null);
                                  setRevealCountdown(null);
                                } else {
                                  handleReveal(msg.item!.id);
                                }
                              }}
                              className={`p-2 rounded-lg border transition-all text-xs font-bold flex items-center gap-1.5 ${
                                revealedItemId === msg.item.id
                                  ? 'bg-brand-blue/10 border-brand-blue/30 text-brand-blue'
                                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {revealedItemId === msg.item.id ? (
                                <>
                                  <EyeOff className="w-3.5 h-3.5" />
                                  <span>{revealCountdown}s</span>
                                </>
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              onClick={() => handleCopy(msg.item!.id)}
                              className={`p-2 rounded-lg border transition-all text-xs font-bold flex items-center gap-1.5 ${
                                copiedItemId === msg.item.id
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {copiedItemId === msg.item.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{copyCountdown}s</span>
                                </>
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {msg.matches && (
                      <div className="space-y-2.5 max-w-lg w-full">
                        {msg.matches.map(item => (
                          <div 
                            key={item.id}
                            className="bg-brand-navy-light/45 border border-white/5 rounded-2xl p-3.5 shadow-md flex items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {getTypeIcon(item.type)}
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-white truncate">{item.title}</h4>
                                <span className="text-[10px] text-zinc-500 truncate block">
                                  {item.project || 'General'} {item.service ? `• ${item.service}` : ''}
                                </span>
                              </div>
                            </div>
                            <button 
                              onClick={() => handleSendChat(`Retrieve details for: "${item.title}"`)}
                              className="px-3 py-1.5 bg-brand-blue/10 hover:bg-brand-blue text-brand-blue hover:text-brand-navy text-[10px] font-bold rounded-xl transition-all border border-brand-blue/20 hover:border-transparent"
                            >
                              Select
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sendingChat && (
                <div className="flex gap-4 max-w-4xl mr-auto">
                  <div className="w-8 h-8 rounded-xl bg-brand-navy-light border border-white/5 flex items-center justify-center text-zinc-400">
                    <Sparkles className="w-4 h-4 text-brand-blue animate-spin" />
                  </div>
                  <div className="p-4 bg-brand-navy-light/30 border border-white/5 rounded-2xl rounded-tl-none text-xs text-zinc-400 italic">
                    Analyzing request...
                  </div>
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Bottom Input Area when Thread is active */}
        {messages.length > 0 && (
          <div className="p-4 border-t border-white/5 bg-brand-navy-dark/90 backdrop-blur-md flex-shrink-0">
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSendChat(); }}
              className="max-w-3xl mx-auto flex gap-3 items-end"
            >
              <textarea
                placeholder="Type a search question OR paste credentials here..."
                className="flex-1 bg-brand-navy-light/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-blue focus:border-brand-blue transition-all resize-none max-h-32 min-h-[56px] custom-scrollbar"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                disabled={sendingChat}
                rows={1}
              />
              <button
                type="submit"
                className="p-3 bg-brand-blue hover:bg-brand-blue-hover disabled:bg-brand-blue/40 text-brand-navy rounded-xl transition-all shadow-md shadow-brand-blue/10 flex-shrink-0 flex items-center justify-center"
                disabled={sendingChat || !chatInput.trim()}
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

      </main>

      {/* 3. Re-Authentication Backdrop Modal */}
      {reauthPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <form 
            onSubmit={handleReauthSubmit}
            className="w-full max-w-sm bg-brand-navy-light border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4"
          >
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-md font-bold text-white font-heading">Re-Authentication Required</h3>
              <p className="text-xs text-zinc-400">
                Your session is stale (older than 5 minutes). Enter your master password to reveal or copy this secret.
              </p>
            </div>
            
            <input 
              type="password"
              placeholder="Enter Master Password..."
              className="w-full bg-brand-navy-dark border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 transition-all text-center"
              value={reauthPassword}
              onChange={e => setReauthPassword(e.target.value)}
              required
              autoFocus
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setReauthPrompt(false);
                  setReauthPassword('');
                  setReauthItemId(null);
                  setReauthAction(null);
                }}
                className="flex-1 py-2 border border-white/10 hover:bg-white/5 rounded-xl text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-xl transition-all"
              >
                Unlock
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. Settings Panel Modal Overlay */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* 5. Manual Item Form Modal Overlay */}
      {showItemForm && (
        <ItemForm 
          itemId={editingItemId}
          onClose={() => { setShowItemForm(false); setEditingItemId(null); }}
          onSaveSuccess={() => {
            setShowItemForm(false);
            setEditingItemId(null);
            fetchItems();
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              sender: 'assistant',
              text: '💾 Vault item saved successfully.'
            }]);
          }}
        />
      )}

    </div>
  );
};
