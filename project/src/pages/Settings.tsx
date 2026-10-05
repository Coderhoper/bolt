import { useEffect, useState, useCallback } from 'react';
import { isTenantContextActive, supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useToast } from '@/components/ui/Toast';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { PaymentSettingsPanel } from '@/components/PaymentSettingsPanel';
import {
  Settings as SettingsIcon, Plus, Trash2, Users, Mail,
  Building2, Save, UserPlus, Shield, X, CreditCard, Gift, MessageSquareText,
} from 'lucide-react';
import type { SystemSettings, Profile } from '@/types';

interface StaffRegistrationRequest {
  user_id: string;
  full_name: string;
  email: string;
  requested_at: string;
}

export function Settings() {
  const { showToast } = useToast();
  const tenantMode = isTenantContextActive();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [staffRequests, setStaffRequests] = useState<StaffRegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'business' | 'users' | 'email' | 'payments' | 'loyalty'>('business');
  const [newRecipient, setNewRecipient] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'owner' });
  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const requestsPromise = tenantMode
      ? supabase.rpc('list_tenant_staff_registration_requests')
      : Promise.resolve({ data: [] as StaffRegistrationRequest[], error: null });
    const [{ data: s }, { data: userData, error: usersError }, { data: requestsData }] = await Promise.all([
      supabase.from('system_settings').select('*').maybeSingle(),
      supabase.functions.invoke('admin-users', { body: { action: 'list' } }),
      requestsPromise,
    ]);
    setSettings(s as SystemSettings || null);
    const profilesWithEmail: Profile[] = usersError ? [] : (userData?.profiles || []);
    setProfiles(profilesWithEmail);
    setStaffRequests((requestsData || []) as StaffRegistrationRequest[]);
    if (!quiet) setLoading(false);
  }, [tenantMode]);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

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
      loyalty_enabled: settings.loyalty_enabled ?? true,
      loyalty_points_per_100: settings.loyalty_points_per_100 ?? 1,
      loyalty_kes_per_point: settings.loyalty_kes_per_point ?? 1,
      loyalty_minimum_redemption: settings.loyalty_minimum_redemption ?? 100,
      loyalty_redemption_month: settings.loyalty_redemption_month ?? 12,
      loyalty_redemption_day: settings.loyalty_redemption_day ?? 31,
      sms_balance_notifications_enabled: settings.sms_balance_notifications_enabled ?? true,
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
    if (!newUser.name.trim() || !newUser.email.trim() || (!tenantMode && newUser.password.length < 8)) {
      showToast(tenantMode ? 'Enter a name and valid email address' : 'Please fill in all fields', 'error');
      return;
    }
    const activeStaffCount = profiles.filter(p => ['user', 'owner'].includes(p.role) && p.status === 'active').length;
    if (tenantMode && activeStaffCount >= 5) {
      showToast('This tenant already has five active staff users. Deactivate a staff account before inviting another.', 'error');
      return;
    }
    if (!tenantMode && newUser.role === 'owner' && profiles.filter(p => p.role === 'owner').length >= 3) {
      showToast('Maximum 3 owners allowed', 'error');
      return;
    }
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'create', name: newUser.name.trim(), email: newUser.email.trim().toLowerCase(), password: newUser.password, role: tenantMode ? 'user' : newUser.role },
    });
    if (error) {
      let message = error.message;
      const response = (error as unknown as { context?: Response }).context;
      if (response) {
        try { message = (await response.clone().json())?.error || message; } catch { /* keep the client message */ }
      }
      showToast(message, 'error');
      return;
    }
    await logAudit('CREATE_USER', 'profile', null, `Created ${newUser.role} user: ${newUser.name} (${newUser.email})`);
    showToast(data?.message || (tenantMode ? 'Invitation sent successfully' : 'User created successfully'), 'success');
    setShowAddUser(false);
    setNewUser({ name: '', email: '', password: '', role: 'owner' });
    loadData();
  };

  const toggleUserStatus = async (profile: Profile) => {
    const newStatus = profile.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'status', id: profile.id, status: newStatus },
    });
    if (error) {
      let message = error.message || 'Failed to update user status';
      const response = (error as unknown as { context?: Response }).context;
      if (response) {
        try { message = (await response.clone().json())?.error || message; } catch { /* keep the client message */ }
      }
      showToast(message, 'error');
      return;
    }
    await logAudit('UPDATE_USER_STATUS', 'profile', profile.id, `${newStatus === 'active' ? 'Activated' : 'Deactivated'} user: ${profile.name}`);
    showToast(`User ${newStatus === 'active' ? 'activated' : 'deactivated'}`, 'success');
    loadData();
  };

  const reviewStaffRequest = async (userId: string, decision: 'approve' | 'reject') => {
    setReviewingUserId(userId);
    const { error } = await supabase.rpc('admin_review_tenant_staff_registration', {
      p_user_id: userId,
      p_decision: decision,
    });
    if (error) {
      showToast(error.message, 'error');
    } else {
      await logAudit(decision === 'approve' ? 'APPROVE_STAFF_REGISTRATION' : 'REJECT_STAFF_REGISTRATION', 'tenant_membership', userId,
        `${decision === 'approve' ? 'Approved' : 'Rejected'} employee registration request`);
      showToast(decision === 'approve' ? 'Employee access approved' : 'Registration request rejected', 'success');
      await loadData(true);
    }
    setReviewingUserId(null);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  if (!settings) {
    return <div className="rounded-md bg-paper p-6 shadow-xs border border-ink-100"><EmptyState icon={SettingsIcon} title="Settings not configured" /></div>;
  }

  const ownerCount = profiles.filter(p => p.role === 'owner').length;
  const activeStaffCount = profiles.filter(p => ['user', 'owner'].includes(p.role) && p.status === 'active').length;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage business details, team access, payments, rewards, and reporting." />

      <div className="mb-6 flex w-fit flex-wrap gap-1 rounded-md border border-ink-100 bg-paper p-1">
        {[
          { key: 'business' as const, label: 'Business Info', icon: Building2 },
          { key: 'users' as const, label: 'Users', icon: Users },
          { key: 'email' as const, label: 'Email & Reports', icon: Mail },
          ...(tenantMode ? [{ key: 'payments' as const, label: 'Payments', icon: CreditCard }] : []),
          ...(tenantMode ? [{ key: 'loyalty' as const, label: 'Loyalty & SMS', icon: Gift }] : []),
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'bg-accent-500 text-white' : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'business' && (
        <div className="max-w-2xl rounded-md bg-paper p-6 shadow-xs border border-ink-100">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Business Name</label>
              <input
                type="text"
                value={settings.business_name}
                onChange={e => setSettings({ ...settings, business_name: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Address</label>
              <input
                type="text"
                value={settings.business_address || ''}
                onChange={e => setSettings({ ...settings, business_address: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={settings.business_phone || ''}
                  onChange={e => setSettings({ ...settings, business_phone: e.target.value })}
                  className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Email</label>
                <input
                  type="email"
                  value={settings.business_email || ''}
                  onChange={e => setSettings({ ...settings, business_email: e.target.value })}
                  className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Currency Symbol</label>
              <input
                type="text"
                value={settings.currency}
                onChange={e => setSettings({ ...settings, currency: e.target.value })}
                className="w-32 rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button onClick={handleSaveSettings} disabled={saving} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
              <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="max-w-3xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-accent-500" />
              <p className="text-sm text-ink-600" data-numeric>{tenantMode ? `${activeStaffCount}/5 active staff users · ${profiles.filter(p => p.role === 'admin').length} administrator(s)` : `${ownerCount}/3 owners · ${profiles.filter(p => p.role === 'admin').length} admin(s)`}</p>
            </div>
            <button onClick={() => setShowAddUser(true)} disabled={tenantMode && activeStaffCount >= 5} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50">
              <UserPlus size={16} /> Add User
            </button>
          </div>

          {tenantMode && (
            <section className="mb-5 overflow-hidden rounded-md border border-ink-100 bg-paper shadow-xs">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="font-display text-base font-semibold text-ink-900">Employee registration requests</h2>
                <p className="mt-1 text-sm text-ink-500">Approve employees to give them sales entry and access to their own receipts.</p>
              </div>
              {staffRequests.length ? (
                <div className="divide-y divide-ink-100">
                  {staffRequests.map(request => (
                    <div key={request.user_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{request.full_name}</p>
                        <p className="truncate text-sm text-ink-600">{request.email}</p>
                        <p className="mt-1 text-xs text-ink-400">Requested {new Date(request.requested_at).toLocaleString()}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => reviewStaffRequest(request.user_id, 'reject')}
                          disabled={reviewingUserId === request.user_id}
                          className="rounded-sm border border-ink-200 px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
                        >Reject</button>
                        <button
                          onClick={() => reviewStaffRequest(request.user_id, 'approve')}
                          disabled={reviewingUserId === request.user_id || activeStaffCount >= 5}
                          className="rounded-sm bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                          title={activeStaffCount >= 5 ? 'Deactivate an existing staff user to free a seat' : undefined}
                        >Approve</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-5 py-5 text-sm text-ink-500">No employee requests are waiting for review.</p>
              )}
            </section>
          )}

          <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ink-600 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {profiles.map(p => (
                  <tr key={p.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm font-medium text-ink-900">{p.name}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">{p.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.role === 'admin' ? 'bg-accent-100 text-accent-700' : 'bg-accent-100 text-accent-700'
                      }`}>
                        {p.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.status === 'active' ? 'bg-accent-100 text-accent-700' : 'bg-ink-100 text-ink-500'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleUserStatus(p)}
                        className="rounded-sm px-3 py-1 text-xs text-ink-600 hover:bg-ink-100"
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
              <div className="absolute inset-0 bg-ink-900/60 backdrop-blur-sm" onClick={() => setShowAddUser(false)} />
              <div className="relative w-full max-w-md rounded-md bg-paper shadow-xs border border-ink-100">
                <div className="flex items-center justify-between border-b border-ink-200 px-6 py-4">
                  <h2 className="text-lg font-semibold text-ink-900 font-display">Add New User</h2>
                  <button onClick={() => setShowAddUser(false)} className="rounded-sm p-1.5 text-ink-400 hover:bg-ink-100">
                    <X size={20} />
                  </button>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                      placeholder="user@business.com"
                    />
                  </div>
                  {!tenantMode && <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                      className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                      placeholder="At least 8 characters"
                    />
                  </div>}
                  {tenantMode && <p className="rounded-lg bg-accent-50 p-3 text-sm text-accent-900">We’ll email an invitation. The new member will set their own password. Their access is limited to this business.</p>}
                  {!tenantMode && <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1">Role</label>
                    <select
                      value={newUser.role}
                      onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                      className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                    >
                      <option value="owner">{tenantMode ? 'Staff (Standard access)' : 'Owner (Read-only)'}</option>
                      <option value="admin">Administrator (Full Access)</option>
                    </select>
                    {!tenantMode && newUser.role === 'owner' && ownerCount >= 3 && (
                      <p className="mt-1 text-xs text-danger">Maximum 3 owners already reached</p>
                    )}
                  </div>}
                  {tenantMode && <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-700">Staff accounts can record sales and open their own receipts. They cannot access other business pages or records. Your tenant can have up to five active staff users.</p>}
                </div>
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-ink-100">
                  <button onClick={() => setShowAddUser(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
                  <button onClick={handleAddUser} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">{tenantMode ? 'Send invite' : 'Create User'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'email' && (
        <div className="max-w-2xl rounded-md bg-paper p-6 shadow-xs border border-ink-100">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-ink-900 mb-3">Report Email Recipients</h3>
              <p className="text-sm text-ink-500 mb-3">These email addresses will receive automated weekly and monthly business reports.</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={newRecipient}
                  onChange={e => setNewRecipient(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                  className="flex-1 rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                  placeholder="owner@business.com"
                />
                <button onClick={addRecipient} className="flex items-center gap-1 rounded-sm bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700">
                  <Plus size={16} /> Add
                </button>
              </div>
              <div className="space-y-2">
                {settings.email_recipients.length > 0 ? (
                  settings.email_recipients.map(email => (
                    <div key={email} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
                      <span className="text-sm text-ink-700">{email}</span>
                      <button onClick={() => removeRecipient(email)} className="rounded-sm p-1 text-ink-400 hover:bg-danger/10 hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ink-400 py-4 text-center">No recipients added yet</p>
                )}
              </div>
            </div>

            <div className="border-t border-ink-100 pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.weekly_report_enabled}
                  onChange={e => setSettings({ ...settings, weekly_report_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-ink-300 text-accent-500 focus:ring-accent-500"
                />
                <div>
                  <p className="text-sm font-medium text-ink-900">Enable Weekly Reports</p>
                  <p className="text-xs text-ink-500">Automatically send reports every week</p>
                </div>
              </label>
              {settings.weekly_report_enabled && (
                <div className="mt-3 ml-7">
                  <label className="block text-sm font-medium text-ink-700 mb-1">Send Day</label>
                  <select
                    value={settings.weekly_report_day}
                    onChange={e => setSettings({ ...settings, weekly_report_day: parseInt(e.target.value) })}
                    className="rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
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

            <div className="border-t border-ink-100 pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.monthly_report_enabled}
                  onChange={e => setSettings({ ...settings, monthly_report_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-ink-300 text-accent-500 focus:ring-accent-500"
                />
                <div>
                  <p className="text-sm font-medium text-ink-900">Enable Monthly Reports</p>
                  <p className="text-xs text-ink-500">Automatically send a report on the 1st of each month</p>
                </div>
              </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={handleSaveSettings} disabled={saving} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
              <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'payments' && tenantMode && <PaymentSettingsPanel />}
      {activeTab === 'loyalty' && tenantMode && (
        <div className="max-w-3xl rounded-xl border border-ink-100 bg-paper p-5 shadow-sm sm:p-6">
          <div className="mb-6"><div className="flex items-center gap-2"><Gift size={18} className="text-accent-600" /><h2 className="font-semibold text-ink-900">Customer loyalty and messages</h2></div><p className="mt-1 text-sm text-ink-500">Set how customers earn points and when they can redeem their year-end rewards.</p></div>
          <div className="space-y-6">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-100 p-4"><input type="checkbox" checked={settings.loyalty_enabled ?? true} onChange={event => setSettings({ ...settings, loyalty_enabled: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-500" /><span><span className="block text-sm font-semibold text-ink-800">Enable customer points</span><span className="mt-1 block text-xs leading-5 text-ink-500">Points are added after an incoming payment succeeds. Refunds adjust the points originally earned.</span></span></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsNumber label="Points for each KSh 100 paid" value={settings.loyalty_points_per_100 ?? 1} min={0} max={1000} step="0.1" disabled={!(settings.loyalty_enabled ?? true)} onChange={value => setSettings({ ...settings, loyalty_points_per_100: value })} />
              <SettingsNumber label="KSh value of one point" value={settings.loyalty_kes_per_point ?? 1} min={0} max={10000} step="0.1" disabled={!(settings.loyalty_enabled ?? true)} onChange={value => setSettings({ ...settings, loyalty_kes_per_point: value })} />
              <SettingsNumber label="Minimum points to redeem" value={settings.loyalty_minimum_redemption ?? 100} min={1} max={1000000} step="1" disabled={!(settings.loyalty_enabled ?? true)} onChange={value => setSettings({ ...settings, loyalty_minimum_redemption: value })} />
              <div><label className="mb-1.5 block text-sm font-medium text-ink-700">Redemption month</label><select disabled={!(settings.loyalty_enabled ?? true)} value={settings.loyalty_redemption_month ?? 12} onChange={event => setSettings({ ...settings, loyalty_redemption_month: Number(event.target.value) })} className="h-10 w-full rounded-lg border border-ink-200 bg-paper px-3 text-sm disabled:opacity-50">{['January','February','March','April','May','June','July','August','September','October','November','December'].map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></div>
              <SettingsNumber label="Redemption day of month" value={settings.loyalty_redemption_day ?? 31} min={1} max={31} step="1" disabled={!(settings.loyalty_enabled ?? true)} onChange={value => setSettings({ ...settings, loyalty_redemption_day: value })} />
            </div>
            <div className="rounded-lg bg-ink-50 p-4"><p className="text-sm font-semibold text-ink-800">Africa’s Talking SMS</p><p className="mt-1 text-xs leading-5 text-ink-600">Payment and balance updates are sent only to customers who have agreed to SMS. Add these secrets in the Supabase project that runs this tenant’s payment-gateway Edge Function:</p><ul className="mt-2 space-y-1 font-mono text-xs text-ink-700"><li>AFRICASTALKING_USERNAME</li><li>AFRICASTALKING_API_KEY</li><li>AFRICASTALKING_SENDER_ID (optional)</li></ul><p className="mt-2 text-xs text-ink-500">Keep the API key in Supabase secrets. Do not put it in Vercel’s VITE_* variables.</p></div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-100 p-4"><input type="checkbox" checked={settings.sms_balance_notifications_enabled ?? true} onChange={event => setSettings({ ...settings, sms_balance_notifications_enabled: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-500" /><span><span className="flex items-center gap-2 text-sm font-semibold text-ink-800"><MessageSquareText size={15} />Send payment and balance messages</span><span className="mt-1 block text-xs leading-5 text-ink-500">Turn this off to stop the system from sending new customer payment SMS messages.</span></span></label>
          </div>
          <div className="mt-6 flex justify-end"><button onClick={handleSaveSettings} disabled={saving} className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"><Save size={16} />{saving ? 'Saving…' : 'Save loyalty settings'}</button></div>
        </div>
      )}
    </div>
  );
}

function SettingsNumber({ label, value, min, max, step, disabled, onChange }: { label: string; value: number; min: number; max: number; step: string; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="block text-sm font-medium text-ink-700">{label}<input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-paper px-3 text-sm disabled:opacity-50" /></label>;
}
