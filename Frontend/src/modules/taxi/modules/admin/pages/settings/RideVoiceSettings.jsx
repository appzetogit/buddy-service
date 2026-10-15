import React, { useState, useEffect } from 'react';
import {
  ChevronRight,
  Save,
  Loader2,
  Volume2,
  Plus,
  X,
  Info,
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

/**
 * Wording and timing for the voice the rider hears during a trip.
 *
 * Stored as one JSON section (`ride_voice`) on the existing app-settings
 * document, so a new language is a new key here — never a schema change and
 * never a Flutter release.
 */

const LANGUAGE_LABELS = {
  en: 'English',
  hi: 'Hindi — हिन्दी',
  kn: 'Kannada — ಕನ್ನಡ',
  ta: 'Tamil — தமிழ்',
  te: 'Telugu — తెలుగు',
  mr: 'Marathi — मराठी',
  gu: 'Gujarati — ગુજરાતી',
  bn: 'Bengali — বাংলা',
};

const ADDABLE_LANGUAGES = ['ta', 'te', 'mr', 'gu', 'bn'];

const EMPTY = {
  enabled: true,
  fallback_language: 'en',
  welcome: { enabled: true, delay_minutes: 5, messages: {} },
  comfort: { enabled: true, delay_minutes: 10, messages: {} },
  arrival: { enabled: true, trigger_remaining_minutes: 10, messages: {} },
  speech: { rate: 0.5, pitch: 1, volume: 1 },
};

const Toggle = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-14 h-7 rounded-full relative transition-colors duration-300 shrink-0 focus:outline-none focus:ring-2 focus:ring-[#1BD961] focus:ring-offset-2 ${
      checked ? 'bg-[#1BD961]' : 'bg-gray-300'
    }`}
  >
    <div
      className={`w-5 h-5 bg-white rounded-full absolute top-1 shadow-sm transition-all duration-300 ${
        checked ? 'left-8' : 'left-1'
      }`}
    />
  </button>
);

const RideVoiceSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(EMPTY);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/general-settings/ride-voice');
      const loaded = res.data?.settings || res.settings;
      if (loaded) setSettings({ ...EMPTY, ...loaded });
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load voice announcement settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await api.patch('/admin/general-settings/ride-voice', { settings });
      const saved = res.data?.settings || res.settings;
      if (saved) setSettings({ ...EMPTY, ...saved });
      toast.success('Voice announcements updated. Riders pick this up on their next trip.', {
        style: { background: '#151515', color: '#fff' },
      });
    } catch (err) {
      console.error('Update settings failed:', err);
      toast.error('Failed to save voice announcement settings');
    } finally {
      setSaving(false);
    }
  };

  const setSection = (section, patch) =>
    setSettings((s) => ({ ...s, [section]: { ...s[section], ...patch } }));

  const setMessage = (section, code, text) =>
    setSettings((s) => ({
      ...s,
      [section]: { ...s[section], messages: { ...s[section].messages, [code]: text } },
    }));

  const removeMessage = (section, code) =>
    setSettings((s) => {
      const next = { ...s[section].messages };
      delete next[code];
      return { ...s, [section]: { ...s[section], messages: next } };
    });

  const addLanguage = (section, code) => {
    if (!code) return;
    setMessage(section, code, '');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">
        <Loader2 className="w-10 h-10 text-[#1BD961] animate-spin" />
      </div>
    );
  }

  const isEnabled = settings.enabled !== false;

  const renderSection = (key, title, blurb, triggerKey, triggerLabel, triggerHelp) => {
    const section = settings[key] || { messages: {} };
    const messages = section.messages || {};
    const codes = Object.keys(messages);
    const missing = ADDABLE_LANGUAGES.filter((c) => !codes.includes(c));

    return (
      <div className="bg-white rounded-[20px] shadow-sm border border-[#E5E7EB] border-l-4 border-l-[#1BD961] overflow-hidden">
        <div className="p-6">
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <h3 className="text-lg font-bold text-[#151515]">{title}</h3>
              <p className="text-sm text-gray-500 mt-1">{blurb}</p>
            </div>
            <Toggle
              checked={section.enabled !== false}
              onChange={() => setSection(key, { enabled: section.enabled === false })}
            />
          </div>

          <div className="space-y-2 mb-8 max-w-xs">
            <label className="text-sm font-semibold text-[#151515] block">{triggerLabel}</label>
            <div className="flex items-stretch group">
              <input
                type="number"
                min="0"
                value={section[triggerKey] ?? ''}
                onChange={(e) => setSection(key, { [triggerKey]: e.target.value })}
                className="flex-1 bg-white border border-[#E5E7EB] rounded-l-lg py-3 px-4 text-sm text-[#151515] font-medium focus:border-[#1BD961] focus:ring-1 focus:ring-[#1BD961] transition-all outline-none"
              />
              <div className="px-4 bg-[#F5F6F8] border border-[#E5E7EB] border-l-0 rounded-r-lg flex items-center text-gray-500 text-sm font-semibold">
                min
              </div>
            </div>
            <p className="text-xs text-gray-500">{triggerHelp}</p>
          </div>

          <div className="space-y-5 pt-6 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[#151515]">Announcement text</h4>
                <p className="text-xs text-gray-500 mt-1">
                  Written per language. Riders hear the language they picked in the app.
                </p>
              </div>
            </div>

            {codes.length === 0 && (
              <p className="text-sm text-gray-400 italic">No languages configured.</p>
            )}

            {codes.map((code) => (
              <div key={code} className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[#151515]">
                    {LANGUAGE_LABELS[code] || code.toUpperCase()}
                  </label>
                  <button
                    onClick={() => removeMessage(key, code)}
                    className="w-7 h-7 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove this language"
                  >
                    <X size={13} />
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={messages[code]}
                  onChange={(e) => setMessage(key, code, e.target.value)}
                  className="w-full bg-white border border-[#E5E7EB] rounded-lg py-3 px-4 text-sm text-[#151515] leading-relaxed focus:border-[#1BD961] focus:ring-1 focus:ring-[#1BD961] transition-all outline-none resize-y"
                />
              </div>
            ))}

            {missing.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs font-semibold text-gray-500">Add a language:</span>
                {missing.map((code) => (
                  <button
                    key={code}
                    onClick={() => addLanguage(key, code)}
                    className="flex items-center gap-1 bg-[#F5F6F8] border border-[#E5E7EB] rounded-full px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#1BD961] transition-colors"
                  >
                    <Plus size={12} /> {LANGUAGE_LABELS[code] || code}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F6F8] p-4 sm:p-6 lg:p-8 font-sans pb-32">
      <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
        <div className="mb-8">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-2">
            <span>App Settings</span>
            <ChevronRight size={14} />
            <span className="text-[#151515]">Ride Voice Announcements</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-1.5 h-8 bg-[#1BD961] rounded-full"></div>
            <div>
              <h1 className="text-2xl font-bold text-[#151515]">Ride Voice Announcements</h1>
              <p className="text-sm text-gray-500 mt-1">
                What the rider's phone says out loud during a trip, and when it says it.
              </p>
            </div>
          </div>
        </div>

        <div
          className={`bg-white rounded-2xl shadow-sm border-l-4 transition-all duration-300 ${
            isEnabled ? 'border-l-[#1BD961] border-t border-r border-b border-[#E5E7EB]' : 'border-[#E5E7EB]'
          }`}
        >
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <h3 className="text-lg font-bold text-[#151515] flex items-center gap-2">
                <Volume2 size={20} className="text-[#1BD961]" /> Voice announcements
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Master switch. Turning this off stops every announcement across all riders.
              </p>
            </div>
            <Toggle checked={isEnabled} onChange={() => setSettings((s) => ({ ...s, enabled: !isEnabled }))} />
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-[20px] p-5 flex gap-3">
          <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900 leading-relaxed">
            Write <code className="bg-white px-1.5 py-0.5 rounded font-mono text-xs">{'{minutes}'}</code> where
            the live estimate should be spoken — the rider's app replaces it with the real remaining travel
            time at the moment the announcement plays. Anything you leave out is simply not spoken.
          </div>
        </div>

        {renderSection(
          'welcome',
          'Welcome announcement',
          'Played once, a few minutes after the trip actually starts.',
          'delay_minutes',
          'Play after trip start',
          'Counted from the moment the driver starts the trip — not from booking or pickup.',
        )}

        {renderSection(
          'comfort',
          'Cabin comfort announcement',
          'Played once during the trip, telling the rider the air conditioning is on.',
          'delay_minutes',
          'Play after trip start',
          'Counted from the moment the driver starts the trip.',
        )}

        {renderSection(
          'arrival',
          'Arrival announcement',
          'Played once, when the remaining travel time drops to the threshold.',
          'trigger_remaining_minutes',
          'Remaining time threshold',
          'Plays the first time the estimate reaches this, and never repeats for that trip.',
        )}

        <div className="bg-white rounded-[20px] shadow-sm border border-[#E5E7EB] p-6">
          <h3 className="text-lg font-bold text-[#151515]">Voice</h3>
          <p className="text-sm text-gray-500 mt-1 mb-6">
            How the phone reads the text out. Lower the rate if riders report it sounds rushed.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { key: 'rate', label: 'Speed', min: 0.1, max: 1, step: 0.05 },
              { key: 'pitch', label: 'Pitch', min: 0.5, max: 2, step: 0.1 },
              { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05 },
            ].map((f) => (
              <div key={f.key} className="space-y-2">
                <label className="text-sm font-semibold text-[#151515] flex justify-between">
                  <span>{f.label}</span>
                  <span className="text-gray-400 font-mono text-xs">
                    {Number(settings.speech?.[f.key] ?? 0).toFixed(2)}
                  </span>
                </label>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={settings.speech?.[f.key] ?? f.min}
                  onChange={(e) => setSection('speech', { [f.key]: Number(e.target.value) })}
                  className="w-full accent-[#1BD961]"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white/80 backdrop-blur border-t border-gray-100 p-6 flex justify-end rounded-b-[20px]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#1BD961] text-[#151515] px-8 py-3 rounded-xl text-sm font-bold shadow-md flex items-center gap-2 hover:bg-[#19C759] hover:shadow-lg active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RideVoiceSettings;
