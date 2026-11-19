import { useState, useMemo, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, AlertCircle, ArrowRight, Check, ChevronRight, CircleHelp, Clock3, Command,
  Edit3, KeyRound, LockKeyhole, LogOut, MessageCircle, Plus, RefreshCw,
  RotateCw, Search, Shield, ShieldCheck, Trash2, Unplug, Users, Wifi, X,
} from 'lucide-react';
import {
  getGetAdminOverviewQueryKey, getGetAdminPairingQrQueryKey, getGetAdminSessionQueryKey,
  getGetPairingQrQueryKey,
  getGetWhatsAppStatusQueryKey, getListCommandLogsQueryKey,
  getListCommandsQueryKey, getListGroupsQueryKey, useActivateCommand, useAuthorizeGroup,
  useBlockGroup, useConnectWhatsApp, useCreateCommand, useDeactivateCommand, useDeleteCommand,
  useDisconnectWhatsApp, useGetAdminOverview, useGetAdminPairingQr, useGetAdminSession,
  useGetPairingQr,
  useGetPublicStatus, useGetWhatsAppStatus, useHealthCheck, useListCommandLogs,
  useListCommands, useListGroups, useLoginAdminSession, useLogoutAdminSession,
  useRestartWhatsApp, useUnlinkWhatsApp, useUpdateCommand,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
type Notice = { message: string; error?: boolean };

function AppShell() {
  const session = useGetAdminSession();
  const [path] = useLocation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const logout = useLogoutAdminSession();
  const authenticated = Boolean(session.data?.data?.authenticated);
  const authPending = session.isLoading;
  const toast = (message: string, error = false) => {
    setNotice({ message, error });
    window.setTimeout(() => setNotice(null), 3200);
  };

  if (authPending) return <div className="login-screen"><div className="login-story"><Brand /></div><div className="login-form-side"><div className="login-form"><div className="skeleton" style={{ width: 180, height: 26 }} /><div className="skeleton" style={{ width: '100%', height: 44, marginTop: 25 }} /><div className="skeleton" style={{ width: '100%', height: 44, marginTop: 12 }} /></div></div></div>;
  if (!authenticated) return <Login onSuccess={() => { queryClient.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() }); toast('Session restored. Welcome back.'); }} />;

  const requestLogout = () => setLogoutConfirm(true);
  const doLogout = () => logout.mutate(undefined, {
    onSuccess: () => {
      queryClient.clear();
      setLogoutConfirm(false);
      toast('You have been signed out.');
      queryClient.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
    },
    onError: () => toast('Sign out failed. Please try again.', true),
  });
  const title = path === '/' ? 'Control room' : path.slice(1).replace(/^./, (s) => s.toUpperCase());

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <Brand />
          <div className="side-label">Workspace</div>
          <nav className="nav-list" aria-label="Primary navigation">
            <NavItem href="/" icon={<Activity />} label="Overview" active={path === '/'} />
            <NavItem href="/commands" icon={<Command />} label="Commands" active={path === '/commands'} />
            <NavItem href="/groups" icon={<Users />} label="Groups" active={path === '/groups'} />
            <NavItem href="/activity" icon={<Clock3 />} label="Activity" active={path === '/activity'} />
          </nav>
          <div className="side-bottom">
            <div className="session-card">
              <div className="session-indicator"><span className="dot" /> Admin session active</div>
              <div className="session-caption">Protected by a browser-only HttpOnly session cookie.</div>
            </div>
            <button className="logout" onClick={requestLogout} data-testid="button-logout"><LogOut size={15} /> Sign out <ChevronRight size={14} style={{ marginLeft: 'auto' }} /></button>
          </div>
        </aside>
        <main className="main-area">
          <div className="topbar"><div className="crumb">BobLost <span style={{ color: '#b5b5a9', padding: '0 7px' }}>/</span> {title}</div><div className="top-actions"><span className="clock">CONTROL DESK · ADMIN</span><span className="dot" /></div></div>
          <ErrorBoundary resetKey={path}>
            <Switch>
              <Route path="/" component={() => <Dashboard notify={toast} />} />
              <Route path="/commands" component={() => <Commands notify={toast} />} />
              <Route path="/groups" component={() => <Groups notify={toast} />} />
              <Route path="/activity" component={() => <ActivityPage notify={toast} />} />
              <Route component={NotFound} />
            </Switch>
          </ErrorBoundary>
        </main>
      </div>
      {logoutConfirm && <ConfirmModal title="Sign out?" copy="This ends the current admin browser session. Your WhatsApp connection and saved pairing remain untouched." busy={logout.isPending} confirmLabel="Sign out" onCancel={() => setLogoutConfirm(false)} onConfirm={doLogout} />}
      {notice && <div className="toast-note" role="status" style={notice.error ? { background: '#9c4037' } : undefined}>{notice.message}</div>}
    </>
  );
}

function Brand() {
  return <div className="brand"><div className="brand-mark">b.</div><div><div className="brand-name">BobLost</div><div className="brand-sub">Community ops</div></div></div>;
}
function NavItem({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return <Link href={href} className={`nav-link${active ? ' active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}>{icon}<span>{label}</span></Link>;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const login = useLoginAdminSession();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    login.mutate({ data: { token } }, {
      onSuccess: (res) => {
        if (res.data.authenticated) onSuccess();
        else setError('That credential was not accepted. Check it and try again.');
      },
      onError: () => setError('Could not start a session. Check the admin credential and try again.'),
    });
  };
  return <div className="login-screen">
    <section className="login-story">
      <div className="login-brand"><div className="brand-mark">b.</div><div><div className="brand-name">BobLost</div><div className="brand-sub">Community ops</div></div></div>
      <div className="login-copy"><div className="login-eyebrow">Moderator control desk</div><div className="login-headline">Keep the<br />conversation<br /><span style={{ color: '#e5aa54' }}>in good hands.</span></div><p>One dependable place to watch your WhatsApp connection, keep commands in shape, and decide which groups can use them.</p></div>
      <div className="login-footer">PRIVATE ADMIN ACCESS · SESSION STORED AS HTTPONLY COOKIE</div>
    </section>
    <section className="login-form-side">
      <form className="login-form" onSubmit={submit}>
        <div className="eyebrow">Welcome back</div><h1>Admin sign in</h1><p>Enter your admin credential to restore a protected session. The credential is never saved in this browser.</p>
        <div className="field"><label htmlFor="admin-token">Admin credential</label><input id="admin-token" data-testid="input-admin-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required placeholder="Enter your credential" /></div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <button className="button button-primary" data-testid="button-login" disabled={login.isPending || !token} style={{ width: '100%', padding: 13, marginTop: 3 }}><KeyRound size={15} />{login.isPending ? 'Starting secure session…' : 'Open control desk'}<ArrowRight size={15} /></button>
        <div className="secure-note"><LockKeyhole /><span>Session credentials are sent directly to the admin API. Only its HttpOnly cookie is retained; no token is stored locally.</span></div>
      </form>
    </section>
  </div>;
}

function Heading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading animate-in"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-desc">{description}</p></div>{action}</div>;
}
function PanelTitle({ title, kicker, right }: { title: string; kicker?: string; right?: ReactNode }) {
  return <div className="panel-head"><div><h2 className="panel-title">{title}</h2>{kicker && <div className="panel-kicker">{kicker}</div>}</div>{right}</div>;
}
function StatusPill({ status }: { status?: string }) {
  const s = status || 'disconnected';
  const text: Record<string, string> = { connected: 'Connected', connecting: 'Connecting', waiting_qr: 'Pairing needed', disconnected: 'Offline', error: 'Attention' };
  return <span className={`status-pill status-${s}`} data-testid="status-whatsapp"><span className="dot" />{text[s] || s.replaceAll('_', ' ')}</span>;
}
function LoadingPanel({ rows = 4 }: { rows?: number }) {
  return <div className="panel load-state" aria-label="Loading"><div style={{ width: 130, margin: '0 auto 20px' }} className="skeleton" />{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${82 - (i % 3) * 13}%`, margin: '13px auto', height: 12 }} />)}</div>;
}
function ErrorPanel({ retry, text = 'We could not load this information.' }: { retry: () => void; text?: string }) {
  return <div className="panel empty-state"><AlertCircle /><strong>Connection interrupted</strong><p>{text}</p><button className="button button-secondary button-small" onClick={retry} style={{ marginTop: 15 }}>Try again</button></div>;
}
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{text}</p>{action && <div style={{ marginTop: 15 }}>{action}</div>}</div>;
}
function useRefreshAfterAction(notify: (message: string, error?: boolean) => void) {
  const qc = useQueryClient();
  return (message: string) => {
    void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetWhatsAppStatusQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAdminPairingQrQueryKey() });
    notify(message);
  };
}

function Dashboard({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const qc = useQueryClient();
  const overview = useGetAdminOverview();
  const wa = useGetWhatsAppStatus();
  const publicStatus = useGetPublicStatus();
  const health = useHealthCheck();
  const qr = useGetAdminPairingQr({ query: { enabled: Boolean(wa.data?.data?.qrAvailable), queryKey: getGetAdminPairingQrQueryKey(), refetchInterval: 15000 } });
  const fallbackQr = useGetPairingQr({ query: { enabled: Boolean(wa.data?.data?.qrAvailable) && !qr.data?.data?.qrSvg, queryKey: getGetPairingQrQueryKey(), refetchInterval: 15000 } });
  const connect = useConnectWhatsApp(), disconnect = useDisconnectWhatsApp(), restart = useRestartWhatsApp(), unlink = useUnlinkWhatsApp();
  const done = useRefreshAfterAction(notify);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const status = wa.data?.data || overview.data?.data;
  const doAction = (fn: typeof connect, success: string) => fn.mutate(undefined, { onSuccess: () => done(success), onError: () => notify('Action could not be completed. Try again.', true) });
  const anyPending = connect.isPending || disconnect.isPending || restart.isPending || unlink.isPending;
  const refreshQR = () => void qr.refetch();
  if (overview.isLoading || wa.isLoading) return <><Heading eyebrow="Operations" title="Control room" description="Your community bot at a glance." /><LoadingPanel rows={5} /></>;
  if (overview.isError || wa.isError || !overview.data) return <><Heading eyebrow="Operations" title="Control room" description="Your community bot at a glance." /><ErrorPanel retry={() => { void overview.refetch(); void wa.refetch(); }} /></>;
  const stats = overview.data.data;
  const qrData = qr.data?.data?.qrSvg ? qr.data.data : fallbackQr.data?.data;
  return <>
    <Heading eyebrow="Operations / Overview" title="Control room" description="A clear read on the bot, before the next message arrives." />
    <div className="overview-grid animate-in">
      <section className="panel connection-card">
        <div className="connection-top"><div className="connection-title">WhatsApp connection</div><StatusPill status={status?.status} /></div>
        <div className="connection-state">{status?.connected ? 'All systems talking.' : status?.status === 'waiting_qr' ? 'Ready to pair.' : status?.status === 'error' ? 'Connection needs care.' : 'Standing by.'}</div>
        <div className="connection-caption">{status?.lastError || (status?.connected ? 'The bot is connected and listening for authorized commands.' : 'Your command desk is ready. Connect WhatsApp to bring the bot online.')}</div>
        <div className="connection-actions">
          {!status?.connected ? <button className="button button-primary" disabled={anyPending} onClick={() => doAction(connect, 'WhatsApp connection started.')} data-testid="button-connect"><Wifi />{connect.isPending ? 'Starting…' : 'Connect'}</button> :
            <button className="button button-secondary" disabled={anyPending} onClick={() => doAction(disconnect, 'Disconnected. Saved WhatsApp session retained.')} data-testid="button-disconnect"><Unplug />Disconnect</button>}
          <button className="button button-ghost" disabled={anyPending} onClick={() => doAction(restart, 'WhatsApp restart requested. Saved session retained.')} data-testid="button-restart"><RotateCw />Restart</button>
          <button className="button button-ghost" disabled={anyPending} title="Unlink deletes the persisted WhatsApp session" onClick={() => setConfirmUnlink(true)} data-testid="button-unlink"><Trash2 />Unlink</button>
        </div>
      </section>
      <div className="metrics">
        <Metric label="Commands" value={stats.commandCount} foot={`${stats.activeCommandCount} active`} icon={<Command />} />
        <Metric label="Authorized groups" value={stats.authorizedGroupCount} foot="Access approved" icon={<ShieldCheck />} />
        <Metric label="Recent executions" value={stats.recentCommandCount} foot="Latest activity window" icon={<Activity />} />
        <Metric label="API health" value={health.data?.data?.status || '—'} foot={health.isError ? 'Health check unavailable' : 'Service check'} icon={<CircleHelp />} small />
      </div>
    </div>
    <div className="dashboard-lower animate-in">
      <section className="panel">
        <PanelTitle title="Pairing desk" kicker="QR · refreshes automatically" right={<button className="icon-button" aria-label="Refresh QR" data-testid="button-refresh-qr" onClick={refreshQR}><RefreshCw /></button>} />
        <div className="panel-body">
          <div className="qr-frame" data-testid="qr-pairing">
            {status?.connected ? <div className="qr-placeholder"><Check /><strong style={{ display: 'block', color: '#3c484a' }}>Already paired</strong>Your WhatsApp session is active.</div>
                : qr.isLoading || fallbackQr.isLoading ? <div className="qr-placeholder"><div className="skeleton" style={{ width: 180, height: 180 }} /></div>
                : qrData?.qrSvg && !qrData.expired ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrData.qrSvg)}`} alt="WhatsApp pairing QR code" />
                  : <div className="qr-placeholder"><MessageCircle /><strong style={{ display: 'block', color: '#3c484a' }}>{qrData?.expired ? 'Pairing code expired' : 'No active QR code'}</strong>{qrData?.expired ? 'Refresh to request a fresh code.' : 'Start a connection to request the pairing code.'}</div>}
          </div>
          <div className="qr-meta"><span>{qrData?.timestamp ? `Updated ${formatDate(qrData.timestamp)}` : 'Waiting for a pairing code'}</span><span>{qrData?.expiresAt ? `Expires ${formatTime(qrData.expiresAt)}` : '—'}</span></div>
          {status?.lastError && <div className="notice"><strong>Connection note</strong><br />{status.lastError}</div>}
          <div className="notice"><strong>Session safety</strong> Disconnect and restart retain the saved WhatsApp session. Unlink permanently deletes it and requires pairing again.</div>
          {publicStatus.isError && <div className="sub-cell">Public status check unavailable; protected status remains the source of truth.</div>}
        </div>
      </section>
      <section className="panel">
        <PanelTitle title="Command readiness" kicker="Configured for the community" />
        <div className="panel-body quick-list">
          <QuickRow label="Commands in catalog" meta="Response library" value={String(stats.commandCount)} />
          <QuickRow label="Ready to respond" meta="Active command triggers" value={String(stats.activeCommandCount)} />
          <QuickRow label="Authorized groups" meta="Groups allowed to use commands" value={String(stats.authorizedGroupCount)} />
          <div className="quick-row" style={{ paddingTop: 19 }}><div><div className="quick-name">Keep the desk tidy</div><div className="quick-meta">Review commands and group permissions</div></div><Link href="/commands" className="arrow-link" data-testid="link-review-commands">Review <ArrowRight size={13} /></Link></div>
        </div>
      </section>
    </div>
    {confirmUnlink && <ConfirmModal title="Delete the WhatsApp session?" copy="Unlinking permanently deletes the persisted WhatsApp session. The bot will need a new QR pairing to connect again. Disconnect and restart do not delete it." confirmLabel="Delete session" danger busy={unlink.isPending} onCancel={() => setConfirmUnlink(false)} onConfirm={() => unlink.mutate(undefined, { onSuccess: () => { setConfirmUnlink(false); done('WhatsApp session unlinked. Pair again to reconnect.'); }, onError: () => notify('Could not unlink WhatsApp. Try again.', true) })} />}
  </>;
}
function Metric({ label, value, foot, icon, small = false }: { label: string; value: string | number; foot: string; icon: ReactNode; small?: boolean }) {
  return <div className="panel metric"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div className="metric-label">{label}</div><span style={{ color: '#8c9a91' }}>{icon}</span></div><div className="metric-value" style={small ? { fontSize: 19, textTransform: 'capitalize', letterSpacing: '-.5px' } : undefined}>{value}</div><div className="metric-foot">{foot}</div></div>;
}
function QuickRow({ label, meta, value }: { label: string; meta: string; value: string }) {
  return <div className="quick-row"><div><div className="quick-name">{label}</div><div className="quick-meta">{meta}</div></div><span className="mono" style={{ fontSize: 17, color: '#596660' }}>{value}</span></div>;
}

type CommandDraft = { id?: string; name: string; description: string; responseContent: string; isActive: boolean };
const blankCommand = (): CommandDraft => ({ name: '', description: '', responseContent: '', isActive: true });
function Commands({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const qc = useQueryClient();
  const list = useListCommands();
  const create = useCreateCommand(), update = useUpdateCommand(), remove = useDeleteCommand(), activate = useActivateCommand(), deactivate = useDeactivateCommand();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CommandDraft | null>(null);
  const [deleting, setDeleting] = useState<CommandDraft | null>(null);
  const commands = useMemo(() => (list.data?.data || []).filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(search.toLowerCase())), [list.data, search]);
  const refresh = () => void qc.invalidateQueries({ queryKey: getListCommandsQueryKey() });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const payload = { name: draft.name.trim().replace(/^!/, ''), description: draft.description.trim(), responseContent: draft.responseContent.trim(), isActive: draft.isActive };
    if (draft.id) update.mutate({ id: draft.id, data: payload }, { onSuccess: () => { setDraft(null); refresh(); notify('Command updated.'); }, onError: () => notify('Could not update command. Check the fields and retry.', true) });
    else create.mutate({ data: payload }, { onSuccess: () => { setDraft(null); refresh(); notify('Command created.'); }, onError: () => notify('Could not create command. Check the fields and retry.', true) });
  };
  const toggle = (id: string, isActive: boolean) => (isActive ? deactivate : activate).mutate({ id }, { onSuccess: () => { refresh(); notify(isActive ? 'Command paused.' : 'Command activated.'); }, onError: () => notify('Could not change command status.', true) });
  const doDelete = () => deleting?.id && remove.mutate({ id: deleting.id }, { onSuccess: () => { setDeleting(null); refresh(); notify('Command deleted.'); }, onError: () => notify('Could not delete command.', true) });
  const busy = create.isPending || update.isPending || remove.isPending || activate.isPending || deactivate.isPending;
  return <>
    <Heading eyebrow="Configuration / Commands" title="Command library" description="Shape the replies your bot can send. Search, edit, and control availability." action={<button className="button button-primary" onClick={() => setDraft(blankCommand())} data-testid="button-add-command"><Plus />Add command</button>} />
    <div className="toolbar"><div className="searchbox"><Search /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by command or description…" aria-label="Search commands" data-testid="input-search-commands" /></div><span className="activity-meta">{commands.length} {commands.length === 1 ? 'command' : 'commands'}</span></div>
    {list.isLoading ? <LoadingPanel /> : list.isError ? <ErrorPanel retry={() => void list.refetch()} /> : <section className="panel animate-in">
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Command</th><th>Response</th><th>State</th><th>Updated</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
        <tbody>{commands.map((cmd) => <tr key={cmd.id} data-testid={`row-command-${cmd.id}`}>
          <td><div className="name-cell">!{cmd.name.replace(/^!/, '')}</div><div className="sub-cell">{cmd.description}</div></td>
          <td style={{ maxWidth: 300 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6d7671' }}>{cmd.responseContent}</div></td>
          <td><button className={`switch${cmd.isActive ? ' on' : ''}`} aria-label={`${cmd.isActive ? 'Deactivate' : 'Activate'} ${cmd.name}`} aria-pressed={cmd.isActive} disabled={busy} onClick={() => toggle(cmd.id, cmd.isActive)} data-testid={`toggle-command-${cmd.id}`}><span /></button></td>
          <td><span className="sub-cell">{formatDate(cmd.updatedAt)}</span></td>
          <td><div className="row-actions"><button className="icon-button" aria-label={`Edit ${cmd.name}`} onClick={() => setDraft({ id: cmd.id, name: cmd.name.replace(/^!/, ''), description: cmd.description, responseContent: cmd.responseContent, isActive: cmd.isActive })} data-testid={`edit-command-${cmd.id}`}><Edit3 /></button><button className="icon-button" aria-label={`Delete ${cmd.name}`} onClick={() => setDeleting({ id: cmd.id, name: cmd.name, description: cmd.description, responseContent: cmd.responseContent, isActive: cmd.isActive })} data-testid={`delete-command-${cmd.id}`}><Trash2 /></button></div></td>
        </tr>)}</tbody></table>
        {commands.length === 0 && <EmptyState icon={<Command />} title={search ? 'No matching commands' : 'No commands yet'} text={search ? 'Try a different name or description.' : 'Create your first response command to start building the library.'} action={!search ? <button className="button button-primary button-small" onClick={() => setDraft(blankCommand())}><Plus />Add command</button> : undefined} />}
      </div>
    </section>}
    {draft && <Modal title={draft.id ? 'Edit command' : 'Add command'} subtitle="A clear trigger and a useful reply make a good command." onClose={() => setDraft(null)}>
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="command-name">Command name</label><input id="command-name" data-testid="input-command-name" required maxLength={32} pattern="!?[a-z0-9][a-z0-9_-]{0,31}" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="hours" /><span className="sub-cell">People will send !{draft.name || 'command'} · lowercase letters, numbers, _ or -</span></div>
        <div className="field"><label htmlFor="command-description">Description</label><input id="command-description" data-testid="input-command-description" required maxLength={500} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="When the community space is open" /></div>
        <div className="field"><label htmlFor="command-response">Response</label><textarea id="command-response" data-testid="input-command-response" required maxLength={4000} value={draft.responseContent} onChange={(e) => setDraft({ ...draft, responseContent: e.target.value })} placeholder="Write the message the bot should send…" /></div>
        <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12, color: '#58635d' }}><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Activate immediately</label>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setDraft(null)}>Cancel</button><button className="button button-primary" disabled={busy} data-testid="button-save-command">{busy ? 'Saving…' : 'Save command'}</button></div>
      </form>
    </Modal>}
    {deleting && <ConfirmModal title={`Delete !${deleting.name.replace(/^!/, '')}?`} copy="This removes the command and its response from the library. This cannot be undone." danger busy={remove.isPending} confirmLabel="Delete command" onCancel={() => setDeleting(null)} onConfirm={doDelete} />}
  </>;
}

function Groups({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const qc = useQueryClient();
  const groups = useListGroups();
  const authorize = useAuthorizeGroup(), block = useBlockGroup();
  const [search, setSearch] = useState('');
  const data = useMemo(() => (groups.data?.data || []).filter((g) => `${g.groupName || ''} ${g.groupId}`.toLowerCase().includes(search.toLowerCase())), [groups.data, search]);
  const updateAccess = (id: string, allow: boolean) => (allow ? authorize : block).mutate({ groupId: id }, {
    onSuccess: () => { void qc.invalidateQueries({ queryKey: getListGroupsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }); notify(allow ? 'Group authorized.' : 'Group access blocked.'); },
    onError: () => notify('Could not update group access. Try again.', true),
  });
  const pending = authorize.isPending || block.isPending;
  return <>
    <Heading eyebrow="Access / Groups" title="Group permissions" description="Only authorized groups can use commands. New groups stay blocked until reviewed." />
    <div className="panel" style={{ marginBottom: 16, padding: '15px 18px', display: 'flex', gap: 12, alignItems: 'flex-start', background: '#f4f1e7' }}><ShieldCheck size={17} color="#367d63" /><div><div style={{ fontSize: 12, fontWeight: 700 }}>Authorization is explicit</div><div className="sub-cell" style={{ fontFamily: 'DM Sans', fontSize: 11, marginTop: 4 }}>Blocking a group removes permission to use bot commands; it does not remove the WhatsApp group.</div></div></div>
    <div className="toolbar"><div className="searchbox"><Search /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a group by name or ID…" aria-label="Search groups" data-testid="input-search-groups" /></div><span className="activity-meta">{data.filter((g) => g.isAuthorized).length} authorized in view</span></div>
    {groups.isLoading ? <LoadingPanel /> : groups.isError ? <ErrorPanel retry={() => void groups.refetch()} /> : <section className="panel animate-in"><div className="table-wrap"><table className="data-table"><thead><tr><th>Group</th><th>First seen</th><th>Last updated</th><th>Access</th><th style={{ textAlign: 'right' }}>Permission</th></tr></thead><tbody>{data.map((group) => <tr key={group.groupId} data-testid={`row-group-${group.groupId}`}><td><div className="name-cell">{group.groupName || 'Unnamed group'}</div><div className="sub-cell mono">{group.groupId}</div></td><td className="sub-cell">{formatDate(group.firstSeenAt)}</td><td className="sub-cell">{formatDate(group.updatedAt)}</td><td><span className={`status-pill ${group.isAuthorized ? 'status-connected' : 'status-disconnected'}`}><span className="dot" />{group.isAuthorized ? 'Authorized' : 'Blocked'}</span></td><td style={{ textAlign: 'right' }}><button className={`button button-small ${group.isAuthorized ? 'button-ghost' : 'button-primary'}`} disabled={pending} onClick={() => updateAccess(group.groupId, !group.isAuthorized)} data-testid={`button-group-${group.isAuthorized ? 'block' : 'authorize'}-${group.groupId}`}>{group.isAuthorized ? <><Shield />Block access</> : <><ShieldCheck />Authorize</>}</button></td></tr>)}</tbody></table>{data.length === 0 && <EmptyState icon={<Users />} title={search ? 'No groups found' : 'No groups discovered'} text={search ? 'Try another group name or ID.' : 'Groups appear here after the bot sees them on WhatsApp.'} />}</div></section>}
  </>;
}

function ActivityPage({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [command, setCommand] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('all');
  const params = useMemo(() => {
    const after =
      range === 'day'
        ? new Date(Date.now() - 86400000).toISOString()
        : range === 'week'
          ? new Date(Date.now() - 7 * 86400000).toISOString()
          : undefined;
    return {
      ...(command.trim() ? { commandName: command.trim() } : {}),
      ...(group.trim() ? { groupId: group.trim() } : {}),
      ...(status ? { status } : {}),
      ...(after ? { after } : {}),
      limit: 100,
    };
  }, [command, group, status, range]);
  const logs = useListCommandLogs(params, {
    query: { queryKey: getListCommandLogsQueryKey(params) },
  });
  const retry = () => {
    notify('Refreshing activity…');
    void logs.refetch();
  };
  return (
    <>
      <Heading
        eyebrow="Operations / Activity"
        title="Command activity"
        description="A practical audit trail of command runs across your groups."
        action={
          <button
            className="button button-secondary"
            onClick={retry}
            data-testid="button-refresh-activity"
          >
            <RefreshCw />
            Refresh
          </button>
        }
      />
      <div className="toolbar">
        <div className="searchbox">
          <Search />
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Filter command name…"
            aria-label="Filter by command"
            data-testid="input-filter-command"
          />
        </div>
        <input
          className="filter-select"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          placeholder="Group ID"
          aria-label="Filter by group ID"
          data-testid="input-filter-group"
        />
        <select
          className="filter-select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter by result"
          data-testid="select-filter-status"
        >
          <option value="">All results</option>
          <option value="executed">Executed</option>
          <option value="send_failed">Send failed</option>
          <option value="afk_activation_send_failed">AFK activation failed</option>
          <option value="afk_return_send_failed">AFK return failed</option>
          <option value="afk_mention_send_failed">AFK mention failed</option>
        </select>
        <select
          className="filter-select"
          value={range}
          onChange={(event) => setRange(event.target.value)}
          aria-label="Filter by date range"
          data-testid="select-filter-range"
        >
          <option value="all">Any time</option>
          <option value="day">Last 24 hours</option>
          <option value="week">Last 7 days</option>
        </select>
      </div>
      {logs.isLoading ? (
        <LoadingPanel rows={7} />
      ) : logs.isError ? (
        <ErrorPanel retry={() => void logs.refetch()} />
      ) : (
        <section className="panel animate-in">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Execution log</h2>
              <div className="panel-kicker">Most recent first · up to 100 records</div>
            </div>
            <span className="activity-meta">{logs.data?.data?.length || 0} results</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Group</th>
                  <th>Sender</th>
                  <th>Result</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(logs.data?.data || []).map((entry) => (
                  <tr key={entry.id} data-testid={`row-activity-${entry.id}`}>
                    <td>
                      <span className="name-cell">
                        !{entry.commandName.replace(/^!/, '')}
                      </span>
                    </td>
                    <td>
                      <span className="sub-cell mono">{entry.groupId}</span>
                    </td>
                    <td>
                      <span className="sub-cell mono">{entry.senderJid || '—'}</span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${['executed', 'success', 'ok', 'completed'].includes(entry.status.toLowerCase()) ? 'status-connected' : 'status-error'}`}
                      >
                        <span className="dot" />
                        {entry.status}
                      </span>
                      {entry.errorMessage && (
                        <div
                          className="sub-cell"
                          data-testid={`send-error-${entry.id}`}
                          style={{ maxWidth: 420, whiteSpace: 'normal', marginTop: 6 }}
                        >
                          <strong>
                            {entry.errorName || 'Send error'}
                            {entry.errorCode ? ` · code ${entry.errorCode}` : ''}
                            {entry.errorStatusCode
                              ? ` · status ${entry.errorStatusCode}`
                              : ''}
                          </strong>
                          <div>{entry.errorMessage}</div>
                          {typeof entry.errorContext?.destinationJid === 'string' && (
                            <div className="mono">
                              Target: {entry.errorContext.destinationJid}
                              {' · socket '}
                              {entry.errorContext.socketConnectedBefore === true
                                ? 'connected'
                                : entry.errorContext.socketConnectedBefore === false
                                  ? 'disconnected'
                                  : 'unknown'}
                              {typeof entry.errorContext.socketGenerationBefore === 'number' &&
                                ` · generation ${entry.errorContext.socketGenerationBefore}`}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="activity-meta">
                        {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.data?.data?.length === 0 && (
              <EmptyState
                icon={<Activity />}
                title="No executions match"
                text="Try broadening the filters. New command activity will appear here."
              />
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="modal-close" onClick={onClose} aria-label="Close dialog"><X /></button></div><div className="modal-content">{children}</div></section></div>;
}
function ConfirmModal({ title, copy, confirmLabel = 'Confirm', danger = false, busy, onCancel, onConfirm }: { title: string; copy: string; confirmLabel?: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal title={title} subtitle={danger ? 'This action needs care.' : 'Confirm this action to continue.'} onClose={onCancel}><p style={{ color: '#68736e', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{copy}</p><div className="modal-actions"><button className="button button-secondary" onClick={onCancel}>Keep as is</button><button className={`button ${danger ? 'button-danger' : 'button-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></div></Modal>;
}
function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function formatTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppShell /></WouterRouter></QueryClientProvider>;
}
export default App;
