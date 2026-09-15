import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Settings as SettingsIcon, Plus, Trash2, Users, Mail,
  Building2, Target, Save, UserPlus, Shield, X,
} from 'lucide-react';
import type { SystemSettings, Profile } from '@/types';

export function Settings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'business' | 'users' | 'email'>('business');
  const [newRecipient, setNewRecipient] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'owner' });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: profilesData }] = await Promise.all([
      supabase.from('system_settings').select('*').maybeSingle(),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    ]);
    setSettings(s as SystemSettings || null);
    const profilesWithEmail: Profile[] = (profilesData || []).map((p: Profile) => p);
    setProfiles(profilesWithEmail);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase.from('system_settings').update({
      business_name: settings.business_name,
      business_address: settings.business_address,
      business_phone: settings.business_phone,
      business_email: settings.business_email,
      currency: settings.currency,
      email_recipients: settings.email_recipients,
      weekly_report_day: settings.weekly_report_day,
      weekly_report_enabled: settings.weekly_report_enabled,
      monthly_report_enabled: settings.monthly_report_enabled,
    }).eq('id', settings.id);
    if (error) {
      showToast('Failed to save settings', 'error');
    } else {
      await logAudit('UPDATE_SETTINGS', 'system_settings', settings.id, 'Updated system settings');
      showToast('Settings saved successfully', 'success');
    }
    setSaving(false);
  };

  const addRecipient = () => {
    if (!newRecipient || !settings) return;
    if (settings.email_recipients.includes(newRecipient)) {
      showToast('Email already added', 'error');
      return;
    }
    setSettings({ ...settings, email_recipients: [...settings.email_recipients, newRecipient] });
    setNewRecipient('');
  };

  const removeRecipient = (email: string) => {
    if (!settings) return;
    setSettings({ ...settings, email_recipients: settings.email_recipients.filter(e => e !== email) });
  };

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    if (newUser.role === 'owner' && profiles.filter(p => p.role === 'owner').length >= 3) {
      showToast('Maximum 3 owners allowed', 'error');
      return;
    }
    const { error } = await supabase.auth.admin.createUser({
      email: newUser.email,
      password: newUser.password,
      user_metadata: { name: newUser.name, role: newUser.role },
    });
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logAudit('CREATE_USER', 'profile', null, `Created ${newUser.role} user: ${newUser.name} (${newUser.email})`);
    showToast('User created successfully', 'success');
    setShowAddUser(false);
    setNewUser({ name: '', email: '', password: '', role: 'owner' });
    loadData();
  };

  const toggleUserStatus = async (profile: Profile) => {
    const newStatus = profile.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('profiles').update({ status: newStatus }).eq('id', profile.id);
    if (error) { showToast('Failed to update user status', 'error'); return; }
    await logAudit('UPDATE_USER_STATUS', 'profile', profile.id, `${newStatus === 'active' ? 'Activated' : 'Deactivated'} user: ${profile.name}`);
    showToast(`User ${newStatus === 'active' ? 'activated' : 'deactivated'}`, 'success');
    loadData();
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  if (!settings) {
    return <div className="rounded-2xl bg-white p-6 shadow-sm"><EmptyState icon={SettingsIcon} title="Settings not configured" /></div>;
  }

  const ownerCount = profiles.filter(p => p.role === 'owner').length;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage business information, users, and email settings" />

      <div className="mb-6 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
        {[
          { key: 'business' as const, label: 'Business Info', icon: Building2 },
          { key: 'users' as const, label: 'Users', icon: Users },
          { key: 'email' as const, label: 'Email & Reports', icon: Mail },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'business' && (
        <div className="max-w-2xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business Name</label>
              <input
                type="text"
                value={settings.business_name}
                onChange={e => setSettings({ ...settings, business_name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={settings.business_address || ''}
                onChange={e => setSettings({ ...settings, business_address: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={settings.business_phone || ''}
                  onChange={e => setSettings({ ...settings, business_phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={settings.business_email || ''}
                  onChange={e => setSettings({ ...settings, business_email: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Currency Symbol</label>
              <input
                type="text"
                value={settings.currency}
                onChange={e => setSettings({ ...settings, currency: e.target.value })}
                className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button onClick={handleSaveSettings} disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="max-w-3xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-blue-600" />
              <p className="text-sm text-slate-600">{ownerCount}/3 owners · {profiles.filter(p => p.role === 'admin').length} admin(s)</p>
            </div>
            <button onClick={() => setShowAddUser(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <UserPlus size={16} /> Add User
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Role</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{p.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {p.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleUserStatus(p)}
                        className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      >
                        {p.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showAddUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddUser(false)} />
              <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                  <h2 className="text-lg font-semibold text-slate-900">Add New User</h2>
                  <button onClick={() => setShowAddUser(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                    <X size={20} />
                  </button>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                      placeholder="user@business.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                      placeholder="Minimum 6 characters"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                    <select
                      value={newUser.role}
                      onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                    >
                      <option value="owner">Owner (Read-only)</option>
                      <option value="admin">Administrator (Full Access)</option>
                    </select>
                    {newUser.role === 'owner' && ownerCount >= 3 && (
                      <p className="mt-1 text-xs text-rose-600">Maximum 3 owners already reached</p>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
                  <button onClick={() => setShowAddUser(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button onClick={handleAddUser} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Create User</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'email' && (
        <div className="max-w-2xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Report Email Recipients</h3>
              <p className="text-sm text-slate-500 mb-3">These email addresses will receive automated weekly and monthly business reports.</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={newRecipient}
                  onChange={e => setNewRecipient(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                  placeholder="owner@business.com"
                />
                <button onClick={addRecipient} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  <Plus size={16} /> Add
                </button>
              </div>
              <div className="space-y-2">
                {settings.email_recipients.length > 0 ? (
                  settings.email_recipients.map(email => (
                    <div key={email} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span className="text-sm text-slate-700">{email}</span>
                      <button onClick={() => removeRecipient(email)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400 py-4 text-center">No recipients added yet</p>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.weekly_report_enabled}
                  onChange={e => setSettings({ ...settings, weekly_report_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Enable Weekly Reports</p>
                  <p className="text-xs text-slate-500">Automatically send reports every week</p>
                </div>
              </label>
              {settings.weekly_report_enabled && (
                <div className="mt-3 ml-7">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Send Day</label>
                  <select
                    value={settings.weekly_report_day}
                    onChange={e => setSettings({ ...settings, weekly_report_day: parseInt(e.target.value) })}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                  </select>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.monthly_report_enabled}
                  onChange={e => setSettings({ ...settings, monthly_report_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Enable Monthly Reports</p>
                  <p className="text-xs text-slate-500">Automatically send a report on the 1st of each month</p>
                </div>
              </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={handleSaveSettings} disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
