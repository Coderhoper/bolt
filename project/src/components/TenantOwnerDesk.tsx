import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Inbox, LifeBuoy, LoaderCircle, MessageSquareText, RefreshCw, Send } from 'lucide-react';
import { invokeTenantOwnerBridge } from '@/lib/tenantOwnerBridge';

type OwnerMessage = { id: string; title: string; body: string; priority: string; created_at: string; expires_at: string | null; read_at: string | null };
type OwnerMeeting = { id: string; title: string; purpose: string; starts_at: string; ends_at: string; timezone: string; provider: string; meeting_url: string | null; agenda: string | null; status: string; outcome: string | null; follow_up_at: string | null; follow_up_note: string | null };
type SupportTicket = { id: string; title: string; summary: string; status: string; severity: string; created_at: string; updated_at: string; last_response_at: string | null };
type SupportMessage = { id: string; ticket_id: string; author_kind: string; author_email: string | null; body: string; created_at: string };
type TicketPayload = { tickets: SupportTicket[]; messages: SupportMessage[] };

const input = 'mt-1 w-full rounded-sm border border-ink-200 bg-paper px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-sm bg-accent-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50';
const subtle = 'inline-flex items-center justify-center gap-2 rounded-sm border border-ink-200 bg-paper px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50';
const displayDate = (value: string, timezone?: string) => new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) });

export function TenantOwnerDesk() {
  const [messages, setMessages] = useState<OwnerMessage[]>([]);
  const [meetings, setMeetings] = useState<OwnerMeeting[]>([]);
  const [tickets, setTickets] = useState<TicketPayload>({ tickets: [], messages: [] });
  const [form, setForm] = useState({ title: '', body: '' });
  const [issueCode, setIssueCode] = useState('dashboard_load_failed');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFailure('');
    try {
      const [inbox, schedule, ticketData] = await Promise.all([
        invokeTenantOwnerBridge<{ messages: OwnerMessage[] }>({ action: 'inbox_list' }),
        invokeTenantOwnerBridge<{ meetings: OwnerMeeting[] }>({ action: 'meeting_list' }),
        invokeTenantOwnerBridge<TicketPayload>({ action: 'ticket_list' }),
      ]);
      setMessages(inbox.messages || []);
      setMeetings(schedule.meetings || []);
      setTickets({ tickets: ticketData.tickets || [], messages: ticketData.messages || [] });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not load Owner messages and meetings.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (messageId: string) => {
    try {
      await invokeTenantOwnerBridge({ action: 'inbox_read', message_id: messageId });
      setMessages(rows => rows.map(row => row.id === messageId ? { ...row, read_at: new Date().toISOString() } : row));
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not mark this message read.'); }
  };

  const createTicket = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setFailure(''); setNotice('');
    try {
      await invokeTenantOwnerBridge({ action: 'ticket_create', title: form.title, body: form.body });
      setForm({ title: '', body: '' });
      setNotice('Your support request has been sent to the Owner team.');
      await load();
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not send support request.'); }
    finally { setBusy(false); }
  };

  const reply = async (event: FormEvent, ticketId: string) => {
    event.preventDefault();
    const body = replyDrafts[ticketId]?.trim() || '';
    if (!body) return;
    setBusy(true); setFailure('');
    try {
      await invokeTenantOwnerBridge({ action: 'ticket_reply', ticket_id: ticketId, body });
      setReplyDrafts(current => ({ ...current, [ticketId]: '' }));
      setNotice('Your reply has been added to the support thread.');
      await load();
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not send support reply.'); }
    finally { setBusy(false); }
  };

  const reportIssue = async () => {
    setBusy(true); setFailure(''); setNotice('');
    try {
      await invokeTenantOwnerBridge({ action: 'report_alert', code: issueCode });
      setNotice('The Owner operations team has been alerted. You can add details in a support request below.');
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not report the technical issue.'); }
    finally { setBusy(false); }
  };

  const unreadCount = messages.filter(message => !message.read_at).length;
  return <section className="mb-6 rounded-md border border-accent-100 bg-paper p-4 shadow-xs sm:p-6 border-ink-100">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Owner support</p><h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink-900">Messages, meetings and support</h2><p className="mt-1 text-sm text-ink-500">Visible to your business administrators. Your products and transactions stay private.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className={subtle}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Refresh</button>
    </div>
    {failure && <p role="alert" className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{failure}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg border border-accent-100 bg-accent-50 p-3 text-sm text-accent-900">{notice}</p>}
    {loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-500"><LoaderCircle size={18} className="animate-spin" />Loading owner workspace messages...</div> : <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <section className="overflow-hidden rounded-md border border-ink-200"><div className="flex items-center justify-between border-b border-ink-100 p-4"><div className="flex items-center gap-2"><Inbox size={17} className="text-accent-700"/><h3 className="font-semibold">Admin inbox</h3></div><span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700" data-numeric>{unreadCount} unread</span></div>
          {messages.length ? <div className="divide-y divide-ink-100">{messages.map(message => <article key={message.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-ink-900">{message.title}</h4><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${message.priority === 'urgent' ? 'bg-danger/10 text-danger' : message.priority === 'important' ? 'bg-warning/10 text-warning' : 'bg-ink-100 text-ink-600'}`}>{message.priority}</span>{!message.read_at && <span className="h-2 w-2 rounded-full bg-accent-500" aria-label="Unread" />}</div><p className="mt-1 text-xs text-ink-500" data-numeric>{displayDate(message.created_at)}</p></div>{!message.read_at && <button type="button" onClick={() => void markRead(message.id)} className="shrink-0 text-xs font-semibold text-accent-700"><Check size={14} className="mr-1 inline"/>Mark read</button>}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-700">{message.body}</p></article>)}</div> : <p className="p-5 text-sm text-ink-500">No new Owner messages.</p>}
        </section>
        <section className="overflow-hidden rounded-md border border-ink-200"><div className="flex items-center gap-2 border-b border-ink-100 p-4"><CalendarDays size={17} className="text-accent-700"/><h3 className="font-semibold">Onboarding and training meetings</h3></div>
          {meetings.length ? <div className="divide-y divide-ink-100">{meetings.map(meeting => <article key={meeting.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{meeting.title}</h4><p className="mt-1 text-xs text-ink-500" data-numeric>{displayDate(meeting.starts_at, meeting.timezone)} ({meeting.timezone}) · {meeting.purpose.replace('_', ' ')}</p></div><span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs">{meeting.status}</span></div>{meeting.agenda && <p className="mt-2 text-sm text-ink-600">{meeting.agenda}</p>}{meeting.outcome && <p className="mt-2 rounded-lg bg-accent-50 p-3 text-sm text-accent-900"><strong>Outcome:</strong> {meeting.outcome}</p>}{meeting.follow_up_note && <p className="mt-2 text-xs text-ink-600" data-numeric>Follow-up: {meeting.follow_up_note}{meeting.follow_up_at ? ` · ${displayDate(meeting.follow_up_at, meeting.timezone)}` : ''}</p>}{meeting.meeting_url && meeting.status === 'scheduled' && <a href={meeting.meeting_url} target="_blank" rel="noreferrer" className={`${button} mt-3`}>Join meeting</a>}</article>)}</div> : <p className="p-5 text-sm text-ink-500">No meetings have been scheduled.</p>}
        </section>
      </div>
      <div className="space-y-5">
        <section className="rounded-md border border-ink-200 p-4"><div className="mb-3 flex items-center gap-2"><LifeBuoy size={17} className="text-accent-700"/><h3 className="font-semibold">Contact Owner support</h3></div><form onSubmit={createTicket} className="space-y-3"><label className="block text-sm font-medium">Subject<input required minLength={2} maxLength={160} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} className={input} placeholder="How can we help?" /></label><label className="block text-sm font-medium">Message<textarea required maxLength={5000} rows={3} value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} className={input} placeholder="Describe the issue. Do not include passwords or payment details." /></label><button disabled={busy} className={button}><Send size={15}/>{busy ? 'Sending...' : 'Send support request'}</button></form><div className="mt-5 border-t border-ink-100 pt-4"><p className="text-sm font-semibold">Report a technical alert</p><p className="mt-1 text-xs text-ink-500">This sends a fixed category to Owner operations without sharing sales or customer records.</p><div className="mt-2 flex flex-wrap gap-2"><select aria-label="Technical issue category" value={issueCode} onChange={event => setIssueCode(event.target.value)} className="min-w-48 flex-1 rounded-sm border px-3 py-2 text-sm h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="dashboard_load_failed">Dashboard failed to load</option><option value="catalogue_unavailable">Product catalogue unavailable</option><option value="sign_in_issue">Sign-in issue</option><option value="slow_response">Application is slow</option></select><button type="button" disabled={busy} onClick={() => void reportIssue()} className={subtle}>{busy ? 'Sending...' : 'Report issue'}</button></div></div></section>
        <section className="overflow-hidden rounded-md border border-ink-200"><div className="flex items-center gap-2 border-b border-ink-100 p-4"><MessageSquareText size={17} className="text-accent-700"/><h3 className="font-semibold">Support requests</h3></div>{tickets.tickets.length ? <div className="divide-y divide-ink-100">{tickets.tickets.map(ticket => <article key={ticket.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{ticket.title}</h4><p className="mt-1 text-xs text-ink-500" data-numeric>{displayDate(ticket.created_at)}</p></div><span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs">{ticket.status.replace('_', ' ')}</span></div><div className="mt-3 space-y-2">{tickets.messages.filter(message => message.ticket_id === ticket.id).map(message => <div key={message.id} className={`rounded-lg p-3 text-sm ${message.author_kind === 'owner' ? 'ml-4 bg-accent-50 text-accent-900' : 'mr-4 bg-ink-50 text-ink-800'}`}><p className="mb-1 text-[11px] font-semibold uppercase text-ink-500">{message.author_kind === 'owner' ? 'Owner support' : 'Your business'}</p><p className="whitespace-pre-wrap">{message.body}</p><p className="mt-2 text-[11px] text-ink-500" data-numeric>{displayDate(message.created_at)}</p></div>)}</div>{!['resolved', 'closed'].includes(ticket.status) && <form onSubmit={event => void reply(event, ticket.id)} className="mt-3 flex gap-2"><input aria-label={`Reply to ${ticket.title}`} value={replyDrafts[ticket.id] || ''} onChange={event => setReplyDrafts({ ...replyDrafts, [ticket.id]: event.target.value })} maxLength={5000} className={input.replace('mt-1 ', '')} placeholder="Write a reply"/><button disabled={busy || !(replyDrafts[ticket.id] || '').trim()} className={button} aria-label="Send reply"><Send size={15}/></button></form>}</article>)}</div> : <p className="p-5 text-sm text-ink-500">No support requests yet.</p>}</section>
      </div>
    </div>}
  </section>;
}
