'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { GET_ORGANIZATIONS, GET_WORKFLOWS, SUBSCRIBE_WORKFLOW_RUN } from '../graphql/queries';
import { 
  CREATE_WORKFLOW, UPDATE_WORKFLOW, DELETE_WORKFLOW, 
  INSERT_WORKFLOW_STEP, UPDATE_WORKFLOW_STEP, DELETE_WORKFLOW_STEP, 
  INSERT_WORKFLOW_TRIGGER, UPDATE_WORKFLOW_TRIGGER, DELETE_WORKFLOW_TRIGGER,
  APPROVE_STEP
} from '../graphql/mutations';
import { useUserData, useSignOut } from '@nhost/react';
import { nhost } from '../lib/nhost';
import { gql } from '@apollo/client';
import { 
  Activity, Cpu, Database, Terminal, Play, Trash2, Zap, CheckCircle2, 
  AlertCircle, Clock, ArrowRight, Lock, Plus, Search, Building, 
  ChevronRight, RefreshCw, Layers, ShieldAlert, Sparkles, HelpCircle, 
  Settings, Key, AlertTriangle, Eye, ArrowUpRight, Check, Send, Link, 
  Info, ExternalLink, Copy, HelpCircle as HelpIcon, Bell, 
  ChevronDown, Layers3, Flame, ShieldCheck, Database as DBIcon,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      workflow_run_id
      status
      message
    }
  }
`;

const INITIAL_SAMPLE_WORKFLOWS = [
  {
    id: 'local-wf-sample-1',
    name: 'Customer Order Automation',
    description: 'Automates customer onboarding, AI sentiment analysis, and approval routing.',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_steps: [
      { id: 's-1', type: 'llm_call', position: 0, config: { prompt: 'Analyze order urgency and customer sentiment using Gemini 3.5 Flash', model: 'gemini-3.5-flash' }, name: 'AI Sentiment Check' },
      { id: 's-2', type: 'conditional_branch', position: 1, config: { condition: 'sentiment == "high_priority"' }, name: 'High Priority Gate' },
      { id: 's-3', type: 'approval_gate', position: 2, config: { approver: 'manager@company.com' }, name: 'Manager Approval' },
      { id: 's-4', type: 'http_request', position: 3, config: { url: 'https://api.example.com/notify', method: 'POST' }, name: 'HTTP Notification' }
    ],
    workflow_triggers: [
      { id: 't-1', type: 'webhook', config: { endpoint: '/api/v1/order-webhook' }, enabled: true },
      { id: 't-2', type: 'manual', config: {}, enabled: true }
    ],
    workflow_runs: [
      {
        id: 'run-sample-1',
        status: 'completed',
        started_at: new Date(Date.now() - 3600000).toISOString(),
        completed_at: new Date().toISOString(),
        step_runs: [
          { id: 'sr-1', workflow_step_id: 's-1', status: 'completed', attempt_count: 1 },
          { id: 'sr-2', workflow_step_id: 's-2', status: 'completed', attempt_count: 1 },
          { id: 'sr-3', workflow_step_id: 's-3', status: 'completed', attempt_count: 1 }
        ]
      }
    ]
  }
];

const NHOST_SETUP_SQL = `-- Copy & paste this SQL into Nhost Dashboard -> Database -> SQL Editor, then click Run:

CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    quota_used INT DEFAULT 0,
    quota_limit INT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT DEFAULT 'owner',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT,
    position INT DEFAULT 0,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    config JSONB DEFAULT '{}'::jsonb,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.step_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
    workflow_step_id UUID,
    status TEXT DEFAULT 'pending',
    attempt_count INT DEFAULT 1,
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

INSERT INTO public.organizations (name, quota_limit) VALUES ('Main Workspace', 100) ON CONFLICT DO NOTHING;
`;

export function WorkflowApp() {
  const user = useUserData();
  const { signOut } = useSignOut();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showLogDrawer, setShowLogDrawer] = useState(true);
  const [logs, setLogs] = useState<{ id: string; timestamp: string; level: 'INFO' | 'WARN' | 'ERROR' | 'GQL'; text: string }[]>([]);
  const [copied, setCopied] = useState(false);

  const addLog = (level: 'INFO' | 'WARN' | 'ERROR' | 'GQL', text: string) => {
    const entry = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toLocaleTimeString(),
      level,
      text
    };
    setLogs(prev => [entry, ...prev.slice(0, 99)]);
  };

  useEffect(() => {
    addLog('INFO', `Nhost Auth session initialized. User: ${user?.email || 'Guest User'} (ID: ${user?.id || 'anon'})`);
    addLog('INFO', 'Target Hasura Endpoint: https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1');
  }, [user]);

  // Local Storage State
  const [localWorkflows, setLocalWorkflows] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('applet_workflows_local');
      if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
      }
    }
    return INITIAL_SAMPLE_WORKFLOWS;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('applet_workflows_local', JSON.stringify(localWorkflows));
    }
  }, [localWorkflows]);

  const { data: orgData, loading: orgLoading, error: orgError } = useQuery(GET_ORGANIZATIONS, {
    skip: !user,
    onError: (err) => {
      addLog('ERROR', `GraphQL Query (GET_ORGANIZATIONS) failed: ${err.message}`);
    },
    onCompleted: (data) => {
      if (data?.organizations?.length > 0) {
        addLog('GQL', `GET_ORGANIZATIONS succeeded: ${data.organizations.length} org(s) returned.`);
      }
    }
  });

  const orgs = orgData?.organizations || [];

  // Automatically select the real organization when orgs load
  useEffect(() => {
    if (orgs.length > 0) {
      if (!selectedOrgId || !orgs.some((o: any) => o.id === selectedOrgId)) {
        setSelectedOrgId(orgs[0].id);
      }
    }
  }, [orgs, selectedOrgId]);

  const { data: wfData, loading: wfLoading, error: wfError, refetch: refetchWf } = useQuery(GET_WORKFLOWS, {
    variables: { orgId: selectedOrgId },
    skip: !selectedOrgId,
    onError: (err) => {
      addLog('ERROR', `GraphQL Query (GET_WORKFLOWS) failed: ${err.message}`);
    },
    onCompleted: (data) => {
      if (data?.workflows) {
        addLog('GQL', `GET_WORKFLOWS succeeded: ${data.workflows.length} workflow(s) returned.`);
      }
    }
  });

  const [createWorkflowMutation] = useMutation(CREATE_WORKFLOW, {
    onCompleted: (data) => {
      addLog('GQL', `CREATE_WORKFLOW succeeded: ${data?.insert_workflows_one?.id || 'Created'}`);
      refetchWf();
    },
    onError: (err) => addLog('ERROR', `Create workflow mutation error: ${err.message}`)
  });

  const workflows = wfData?.workflows || [];
  const selectedWorkflow = workflows.find((w: any) => w.id === selectedWorkflowId) || workflows[0];
  const selectedOrg = orgs.find((o: any) => o.id === selectedOrgId);

  let userRole = 'owner';
  if (selectedOrg && user?.id) {
    const member = selectedOrg.org_members?.find((m: any) => m.user_id === user.id);
    if (member) userRole = member.role;
  }

  const isOwner = userRole === 'owner';
  const isEditor = userRole === 'editor' || isOwner;
  const canEditWorkflow = isOwner || isEditor;

  const handleCreateWorkflow = async () => {
    if (!selectedOrgId) {
      addLog('WARN', 'Cannot create workflow: No organization selected.');
      alert('Please wait for organizations to load or select an organization.');
      return;
    }

    const name = prompt("Workflow Name:");
    if (!name) return;

    try {
      const res = await createWorkflowMutation({ variables: { orgId: selectedOrgId, name, description: '' } });
      if (res.data?.insert_workflows_one?.id) {
        setSelectedWorkflowId(res.data.insert_workflows_one.id);
      }
    } catch (err: any) {
      addLog('ERROR', `Create workflow failed: ${err.message}`);
    }
  };

  return (
    <div className="relative flex flex-col h-screen bg-[#030305] text-slate-300 font-sans overflow-hidden select-none">
      {/* Dynamic Background Mesh Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/10 via-[#030305] to-[#010102] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c0c16_1px,transparent_1px),linear-gradient(to_bottom,#0c0c16_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 pointer-events-none" />

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: -10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: -10 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-8 max-w-sm w-full flex flex-col items-center shadow-2xl relative overflow-hidden"
            >
              <button 
                onClick={() => setShowProfileModal(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white text-2xl mb-4 shadow-lg shadow-indigo-600/20">
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              <h2 className="text-lg font-bold text-white tracking-wide mb-1">Workspace Profile</h2>
              <p className="text-xs text-slate-400 font-mono mb-6">{user?.email || `User ID: ${user?.id}`}</p>
              
              <div className="w-full space-y-4 mb-8">
                <div className="flex justify-between items-center p-3.5 bg-slate-950/50 rounded-xl border border-slate-900">
                  <span className="text-xs text-slate-500 font-mono">Security Role</span>
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">{userRole}</span>
                </div>
                <div className="flex justify-between items-center p-3.5 bg-slate-950/50 rounded-xl border border-slate-900">
                  <span className="text-xs text-slate-500 font-mono">Organization</span>
                  <span className="text-xs font-semibold text-white">{selectedOrg?.name || 'None'}</span>
                </div>
              </div>

              <button 
                onClick={() => {
                  setShowProfileModal(false);
                  signOut();
                }} 
                className="w-full py-2.5 bg-red-950/40 hover:bg-red-950/80 text-red-400 font-semibold text-sm rounded-xl border border-red-900/30 transition-all duration-300 cursor-pointer shadow-lg shadow-red-950/10 flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Sign Out of Aethera
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SQL Setup Modal */}
      <AnimatePresence>
        {showSqlModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', duration: 0.5 }}
              className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 max-w-2xl w-full flex flex-col gap-4 shadow-2xl relative"
            >
              <div className="flex justify-between items-center border-b border-slate-800/80 pb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2.5">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span>Setup Nhost Hasura Database Tables</span>
                </h3>
                <button 
                  onClick={() => setShowSqlModal(false)} 
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ChevronDown className="w-4 h-4 rotate-90" />
                </button>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                To persist data in your Nhost Cloud PostgreSQL database, copy this SQL script, navigate to your <strong className="text-indigo-400 font-semibold">Nhost Dashboard -&gt; Database -&gt; SQL Editor</strong>, paste it, and click <strong className="text-emerald-400 font-semibold">Run</strong>:
              </p>
              <div className="relative">
                <textarea 
                  readOnly 
                  value={NHOST_SETUP_SQL} 
                  className="w-full h-60 bg-slate-950/60 text-indigo-200/90 font-mono text-xs p-3.5 rounded-xl border border-slate-800 focus:outline-none resize-none focus:border-indigo-500/30 transition-all leading-relaxed"
                />
              </div>
              <div className="flex justify-between items-center mt-2">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(NHOST_SETUP_SQL);
                    setCopied(true);
                    addLog('INFO', 'Database setup SQL copied to clipboard.');
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-md shadow-indigo-600/10 transition-all cursor-pointer flex items-center gap-2"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied SQL!' : 'Copy SQL Script'}</span>
                </button>
                <button 
                  onClick={() => setShowSqlModal(false)} 
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition-all cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Navigation / Header */}
      <header className="bg-slate-900/30 backdrop-blur-md border-b border-slate-900 px-6 py-3 flex items-center justify-between z-40 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-white text-base shadow-lg shadow-indigo-600/20">
            Ω
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-bold text-white tracking-wider uppercase font-sans">Aethera Orchestrator</h1>
              <span className="text-[9px] bg-slate-800/80 px-2 py-0.5 rounded-full text-slate-400 font-mono">v1.1</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">https://ap-south-1.nhost.run</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Badge */}
          <div className={`px-3 py-1 rounded-full text-[10px] font-medium border flex items-center gap-2 transition-all ${
            orgLoading || wfLoading 
              ? 'bg-amber-950/20 text-amber-300 border-amber-800/40' 
              : orgError || wfError
              ? 'bg-red-950/20 text-red-300 border-red-800/40'
              : 'bg-emerald-950/20 text-emerald-400 border-emerald-800/40'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              orgLoading || wfLoading ? 'bg-amber-400 animate-pulse' :
              orgError || wfError ? 'bg-red-400' : 'bg-emerald-400'
            }`} />
            <span className="font-sans font-medium">
              {orgLoading || wfLoading ? 'Connecting to Hasura Cluster...' :
               orgError ? 'Workspace Error' :
               wfError ? 'Orchestration Query Failed' :
               'GraphQL Cluster Active'}
            </span>
          </div>

          <button 
            onClick={() => setShowSqlModal(true)}
            className="text-[11px] bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 hover:border-indigo-500/40 text-indigo-300 px-3 py-1 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Database className="w-3 h-3" />
            <span>Setup SQL</span>
          </button>

          <button
            onClick={() => setShowLogDrawer(!showLogDrawer)}
            className={`text-[11px] px-3 py-1 rounded-xl transition-all border cursor-pointer flex items-center gap-1.5 ${
              showLogDrawer 
                ? 'bg-slate-800/80 text-slate-200 border-slate-700/60' 
                : 'bg-slate-900/40 text-slate-400 border-slate-800/80 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3 h-3" />
            <span>Terminal {logs.length > 0 && `(${logs.length})`}</span>
          </button>
          <button
            onClick={() => setShowProfileModal(true)}
            className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white text-xs shadow-lg shadow-indigo-600/20 cursor-pointer ml-1 hover:bg-indigo-500 transition-colors"
          >
            {user?.email?.charAt(0).toUpperCase() || 'U'}
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden z-10">
        {/* Sidebar */}
        <aside className="w-64 border-r border-slate-900/80 bg-slate-950/30 backdrop-blur-sm flex flex-col z-20">
          <div className="p-4 border-b border-slate-900/80">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest block mb-2 font-mono">Workspace Division</label>
            <div className="relative">
              <select 
                className="w-full bg-slate-900/60 border border-slate-800 text-white rounded-xl py-2 pl-3.5 pr-8 text-xs focus:outline-none focus:border-indigo-500/50 transition-all appearance-none cursor-pointer"
                value={selectedOrgId || ''}
                onChange={e => {
                  setSelectedOrgId(e.target.value);
                  setSelectedWorkflowId(null);
                }}
              >
                {orgs.map((org: any) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
            </div>
            
            {/* Usage quota progress bar */}
            <div className="mt-3.5 bg-slate-900/60 rounded-xl p-2.5 border border-slate-900">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span className="flex items-center gap-1">
                  <Layers3 className="w-3 h-3 text-indigo-400" />
                  <span>Quota Limit</span>
                </span>
                <span className="text-white font-semibold">
                  {selectedOrg?.quota_used ?? 0} <span className="text-slate-500 font-normal">/ {selectedOrg?.quota_limit ?? 100}</span>
                </span>
              </div>
              <div className="mt-1.5 w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                <div 
                  className="bg-indigo-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, (((selectedOrg?.quota_used ?? 0) / (selectedOrg?.quota_limit ?? 100)) * 100))}%` }}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Security Role</span>
              <span className="text-indigo-400 font-semibold uppercase tracking-wider">{userRole}</span>
            </div>
          </div>

          <div className="p-4 flex-1 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 font-mono">Automation Lines</span>
              {canEditWorkflow && (
                <button 
                  onClick={handleCreateWorkflow} 
                  className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-2 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create</span>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {workflows.map((wf: any) => {
                const isActive = selectedWorkflow?.id === wf.id;
                return (
                  <button
                    key={wf.id}
                    onClick={() => setSelectedWorkflowId(wf.id)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs transition-all flex items-center justify-between border cursor-pointer ${
                      isActive 
                        ? 'bg-indigo-600/10 text-indigo-300 border-indigo-500/30 font-medium shadow-md shadow-indigo-600/5' 
                        : 'bg-transparent border-transparent hover:bg-slate-900/40 hover:border-slate-800/40 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate pr-2">{wf.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono ${isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-900 text-slate-500'}`}>
                      {wf.workflow_steps?.length || 0}
                    </span>
                  </button>
                );
              })}
              {workflows.length === 0 && (
                <div className="text-[11px] text-slate-600 italic text-center py-6">
                  No automated lines configured.
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Builder View */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#030305]">
          {selectedWorkflow ? (
            <WorkflowBuilder 
              workflow={selectedWorkflow} 
              refetch={refetchWf} 
              userRole={userRole}
              addLog={addLog}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-xs gap-3 font-mono">
              <Cpu className="w-8 h-8 text-slate-800 animate-pulse" />
              <span>Awaiting Automation Select...</span>
            </div>
          )}
        </main>
      </div>

      {/* Bottom Diagnostics Console / Drawer */}
      <AnimatePresence>
        {showLogDrawer && (
          <motion.div 
            initial={{ height: 0 }}
            animate={{ height: 180 }}
            exit={{ height: 0 }}
            className="bg-[#050508] border-t border-slate-900 flex flex-col font-mono text-xs z-30 relative"
          >
            <div className="bg-slate-950 px-4 py-2 border-b border-slate-900 flex items-center justify-between text-[10px] text-slate-400">
              <div className="flex items-center gap-3">
                <span className="font-bold text-indigo-400 flex items-center gap-1.5 uppercase tracking-wider font-sans">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Aethera Core Diagnostics</span>
                </span>
                <span className="text-slate-700">|</span>
                <span className="text-[10px] text-slate-500 font-mono">Broker: <code className="text-indigo-300/80">Hasura GraphQL Engine</code></span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setLogs([])} className="hover:text-white transition-colors cursor-pointer">Clear Buffer</button>
                <button onClick={() => setShowLogDrawer(false)} className="hover:text-white transition-colors cursor-pointer text-slate-500">Hide Console</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-[10px] font-mono leading-relaxed bg-slate-950/40">
              {logs.length === 0 ? (
                <div className="text-slate-700 italic select-none">Kernel empty. Operations operating within normal parameters.</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="flex items-start gap-3">
                    <span className="text-slate-600 text-[9px] select-none">{log.timestamp}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider select-none ${
                      log.level === 'ERROR' ? 'bg-red-950/60 text-red-400 border border-red-900/30' :
                      log.level === 'WARN' ? 'bg-amber-950/60 text-amber-300 border border-amber-900/30' :
                      log.level === 'GQL' ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-900/30' :
                      'bg-slate-900/80 text-slate-400 border border-slate-800/40'
                    }`}>
                      {log.level}
                    </span>
                    <span className="text-slate-300 leading-normal font-sans">{log.text}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function WorkflowBuilder({ 
  workflow, 
  refetch, 
  userRole,
  addLog
}: { 
  workflow: any; 
  refetch: () => void; 
  userRole: string;
  addLog: (level: 'INFO' | 'WARN' | 'ERROR' | 'GQL', text: string) => void;
}) {
  const [updateWorkflowMutation] = useMutation(UPDATE_WORKFLOW, { 
    onError: (err) => addLog('ERROR', `Update workflow error: ${err.message}`) 
  });
  const [deleteWorkflowMutation] = useMutation(DELETE_WORKFLOW, { 
    onError: (err) => addLog('ERROR', `Delete workflow error: ${err.message}`) 
  });
  
  const [insertStepMutation] = useMutation(INSERT_WORKFLOW_STEP, { 
    onError: (err) => addLog('ERROR', `Insert step error: ${err.message}`) 
  });
  const [updateStepMutation] = useMutation(UPDATE_WORKFLOW_STEP, { 
    onError: (err) => addLog('ERROR', `Update step error: ${err.message}`) 
  });
  const [deleteStepMutation] = useMutation(DELETE_WORKFLOW_STEP, { 
    onError: (err) => addLog('ERROR', `Delete step error: ${err.message}`) 
  });
  
  const [insertTriggerMutation] = useMutation(INSERT_WORKFLOW_TRIGGER, { 
    onError: (err) => addLog('ERROR', `Insert trigger error: ${err.message}`) 
  });
  const [updateTriggerMutation] = useMutation(UPDATE_WORKFLOW_TRIGGER, { 
    onError: (err) => addLog('ERROR', `Update trigger error: ${err.message}`) 
  });
  const [deleteTriggerMutation] = useMutation(DELETE_WORKFLOW_TRIGGER, { 
    onError: (err) => addLog('ERROR', `Delete trigger error: ${err.message}`) 
  });

  const [triggerRunMutation, { loading: runLoading }] = useMutation(TRIGGER_WORKFLOW_RUN, { 
    onError: (err) => addLog('ERROR', `Trigger run error: ${err.message}`) 
  });
  const [approveStepMutation, { loading: approveLoading }] = useMutation(APPROVE_STEP, { 
    onError: (err) => addLog('ERROR', `Approve step error: ${err.message}`) 
  });

  const isOwner = userRole === 'owner';
  const isEditor = userRole === 'editor' || isOwner;
  const canEditWorkflow = isOwner || isEditor;

  const [executedRuns, setExecutedRuns] = useState<any[]>([]);
  const [executedOutputs, setExecutedOutputs] = useState<any[]>([]);
  const [executedNotifications, setExecutedNotifications] = useState<any[]>([]);
  const [isSeeding, setIsSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<'runs' | 'steps' | 'outputs' | 'notifications'>('runs');
  const [isAddingStep, setIsAddingStep] = useState(false);
  const [isAddingTrigger, setIsAddingTrigger] = useState(false);
  const [approvingSteps, setApprovingSteps] = useState<Record<string, boolean>>({});
  const [editingStep, setEditingStep] = useState<any>(null);
  const [editingTrigger, setEditingTrigger] = useState<any>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const fetchRunsAndOutputs = async () => {
    if (!workflow?.id) return;
    try {
      const token = nhost.auth.getAccessToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      
      const [runsRes, outputsRes, notifsRes] = await Promise.all([
        fetch(`/api/workflowRuns?workflowId=${workflow.id}`, { headers }),
        fetch(`/api/workflowOutputs?workflowId=${workflow.id}`, { headers }),
        fetch(`/api/workflowNotifications?workflowId=${workflow.id}`, { headers })
      ]);

      if (runsRes.ok) {
        const runsData = await runsRes.json();
        if (runsData.workflow_runs) setExecutedRuns(runsData.workflow_runs);
      }

      if (outputsRes.ok) {
        const outputsData = await outputsRes.json();
        if (outputsData.workflow_outputs) setExecutedOutputs(outputsData.workflow_outputs);
      }

      if (notifsRes.ok) {
        const notifsData = await notifsRes.json();
        if (notifsData.workflow_notifications) setExecutedNotifications(notifsData.workflow_notifications);
      }
    } catch (err: any) {
      console.warn('Failed to fetch runs/outputs/notifications:', err.message);
    }
  };

  const handleSeedData = async () => {
    setIsSeeding(true);
    addLog('INFO', 'Populating execution tables with sample data...');
    try {
      const res = await fetch('/api/seedData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflow.id,
          orgId: workflow.org_id || '00000000-0000-0000-0000-000000000000'
        })
      });
      const data = await res.json();
      if (res.ok) {
        addLog('GQL', `Populated persistence tables: ${data.message || 'Success'}`);
        await fetchRunsAndOutputs();
      } else {
        throw new Error(data.error || 'Failed to seed data');
      }
    } catch (err: any) {
      addLog('ERROR', `Seed error: ${err.message}`);
    } finally {
      setIsSeeding(false);
    }
  };

  useEffect(() => {
    fetchRunsAndOutputs();
  }, [workflow?.id]);

  const { data: subData } = useSubscription(SUBSCRIBE_WORKFLOW_RUN, {
    variables: { workflowId: workflow.id },
    skip: !workflow.id,
    onError: (err) => addLog('WARN', `Live subscription notice: ${err.message}`)
  });
  
  const liveRun = subData?.workflow_runs?.[0] || executedRuns[0] || workflow.workflow_runs?.[0];

  const handleUpdateName = async () => {
    const name = prompt("New workflow name:", workflow.name);
    if (!name) return;

    try {
      await updateWorkflowMutation({ variables: { id: workflow.id, name, description: workflow.description || '' } });
      addLog('GQL', `Updated workflow name to "${name}".`);
      refetch();
    } catch(err: any) {
      addLog('ERROR', `Failed to update name: ${err.message}`);
    }
  };

  const handleUpdateDescription = async () => {
    const description = prompt("New description:", workflow.description || '');
    if (description === null) return;

    try {
      await updateWorkflowMutation({ variables: { id: workflow.id, name: workflow.name, description } });
      addLog('GQL', `Updated description for workflow "${workflow.name}".`);
      refetch();
    } catch(err: any) {
      addLog('ERROR', `Failed to update description: ${err.message}`);
    }
  };

  const handleDeleteWorkflow = async () => {
    if (confirm("Delete this workflow?")) {
      try {
        await deleteWorkflowMutation({ variables: { id: workflow.id } });
        addLog('GQL', `Deleted workflow "${workflow.name}".`);
        refetch();
      } catch(err: any) {
        addLog('ERROR', `Failed to delete workflow: ${err.message}`);
      }
    }
  };

  const handleAddStep = async (type: string) => {
    if (isAddingStep) return;
    setIsAddingStep(true);
    const position = (workflow.workflow_steps || []).length;
    const name = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    let defaultConfig: Record<string, any> = {};
    if (type === 'http_request') {
      defaultConfig = { url: 'https://httpbin.org/post', method: 'POST' };
    } else if (type === 'llm_call') {
      defaultConfig = { prompt: 'Analyze input data and generate a summary.', model: 'gemini-3.5-flash' };
    } else if (type === 'conditional_branch') {
      defaultConfig = { condition: { field: 'status', operator: 'equals', value: 'active' } };
    } else if (type === 'approval_gate') {
      defaultConfig = { approver: 'manager@company.com' };
    } else if (type === 'notify') {
      defaultConfig = { channel: 'email', message: 'Workflow task executed' };
    } else if (type === 'db_write') {
      defaultConfig = { table: 'outputs' };
    }

    try { 
      await insertStepMutation({ variables: { workflowId: workflow.id, type, position, config: defaultConfig, name } }); 
      addLog('GQL', `Added step "${name}".`);
      refetch();
    } catch(err: any) { 
      addLog('ERROR', `Failed to add step: ${err.message}`);
    }
  };


  const handleReorderStep = async (step: any, direction: 'up' | 'down') => {
    if (isReordering) return;
    const sortedSteps = [...(workflow.workflow_steps || [])].sort((a: any, b: any) => a.position - b.position);
    const currentIndex = sortedSteps.findIndex((s: any) => s.id === step.id);
    if (direction === 'up' && currentIndex <= 0) return;
    if (direction === 'down' && currentIndex >= sortedSteps.length - 1) return;

    setIsReordering(true);
    const swapStep = sortedSteps[direction === 'up' ? currentIndex - 1 : currentIndex + 1];
    
    try {
      // Step 1: Move target to a temporary safe position (-1)
      await updateStepMutation({ variables: { id: step.id, _set: { position: -1 } } });
      // Step 2: Move swapStep to target's original position
      await updateStepMutation({ variables: { id: swapStep.id, _set: { position: step.position } } });
      // Step 3: Move target from -1 to swapStep's original position
      await updateStepMutation({ variables: { id: step.id, _set: { position: swapStep.position } } });
      
      addLog('GQL', `Reordered step "${step.name}".`);
      refetch();
    } catch (err: any) {
      addLog('ERROR', `Reorder failed: ${err.message}`);
    } finally {
      setIsReordering(false);
    }
  };

  const handleSaveStepConfig = async (id: string, config: any) => {
    if (isSavingConfig) return;
    setIsSavingConfig(true);
    try {
      await updateStepMutation({ variables: { id, _set: { config } } });
      addLog('GQL', `Updated step configuration.`);
      setEditingStep(null);
      refetch();
    } catch (err: any) {
      addLog('ERROR', `Failed to save config: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSaveTriggerConfig = async (id: string, config: any, enabled: boolean) => {
    if (isSavingConfig) return;
    setIsSavingConfig(true);
    try {
      await updateTriggerMutation({ variables: { id, _set: { config, enabled } } });
      addLog('GQL', `Updated trigger configuration.`);
      setEditingTrigger(null);
      refetch();
    } catch (err: any) {
      addLog('ERROR', `Failed to save trigger config: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleDeleteStep = async (id: string, index: number) => {
    if (confirm("Delete this step?")) {
      try {
        await deleteStepMutation({ variables: { id } });
        addLog('GQL', `Deleted step at position ${index}.`);
        refetch();
      } catch(err: any) {
        addLog('ERROR', `Failed to delete step: ${err.message}`);
      }
    }
  };

  const handleAddTrigger = async (type: string) => {
    if (isAddingTrigger) return;
    setIsAddingTrigger(true);
    try { 
      await insertTriggerMutation({ variables: { workflowId: workflow.id, type, config: {} } }); 
      addLog('GQL', `Added trigger "${type}".`);
      refetch();
    } catch(err: any) {
      addLog('ERROR', `Failed to add trigger: ${err.message}`);
    } finally {
      setIsAddingTrigger(false);
    }
  };

  const [isManualRunning, setIsManualRunning] = useState(false);

  const runManually = async () => {
    addLog('INFO', `Initiating manual execution for workflow "${workflow.name}"...`);
    setIsManualRunning(true);
    try {
      const token = nhost.auth.getAccessToken();
      const user = nhost.auth.getUser();
      const res = await fetch('/api/triggerWorkflowRun', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          workflowId: workflow.id,
          userId: user?.id,
          action: { name: 'triggerWorkflowRun' },
          input: { workflow_id: workflow.id },
          session_variables: user?.id ? { 'x-hasura-user-id': user.id } : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Trigger execution failed');
      }
      addLog('GQL', `Triggered workflow run (${data.status || 'completed'}): ${data.message || 'Execution completed'}`);
      await fetchRunsAndOutputs();
      refetch();
    } catch(err: any) {
      addLog('ERROR', `Trigger run error: ${err.message}`);
    } finally {
      setIsManualRunning(false);
    }
  };

  const handleApproveStep = async (stepRunId: string) => {
    if (approvingSteps[stepRunId]) return;
    setApprovingSteps(prev => ({ ...prev, [stepRunId]: true }));
    addLog('INFO', `Approving step run ${stepRunId}...`);
    try {
      const token = nhost.auth.getAccessToken();
      const user = nhost.auth.getUser();
      const res = await fetch('/api/approveStep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          stepRunId,
          userId: user?.id,
          action: { name: 'approveStep' },
          input: { step_run_id: stepRunId },
          session_variables: user?.id ? { 'x-hasura-user-id': user.id } : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Approval failed');
      }
      addLog('GQL', `Approved step run (${data.status}): ${data.message || 'Resumed'}`);
      await fetchRunsAndOutputs();
      refetch();
    } catch(err: any) {
      addLog('ERROR', `Approve step error: ${err.message}`);
    } finally {
      setApprovingSteps(prev => ({ ...prev, [stepRunId]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col relative select-none">
      {/* Workflow Builder Header Banner */}
      <header className="p-5 border-b border-slate-900 bg-slate-950/20 backdrop-blur-md flex justify-between items-center z-20">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 font-sans tracking-wide">
              <span>{workflow.name}</span>
            </h2>
            {canEditWorkflow && (
              <button 
                onClick={handleUpdateName} 
                className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 hover:text-white px-2 py-0.5 rounded-full transition-all cursor-pointer flex items-center gap-1"
              >
                <span>Edit Name</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[11px] text-slate-500 font-sans">
              {workflow.description || 'Provide an architectural description for this pipeline'}
            </p>
            {canEditWorkflow && (
              <button 
                onClick={handleUpdateDescription} 
                className="text-[9px] text-indigo-400 hover:text-indigo-300 transition-all cursor-pointer font-medium font-sans"
              >
                (modify)
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3.5">
          {canEditWorkflow && (
            <button 
              onClick={handleDeleteWorkflow} 
              className="text-[10px] font-semibold text-red-500/80 hover:text-red-400 hover:bg-red-950/20 px-3 py-1.5 rounded-xl transition-all cursor-pointer border border-transparent hover:border-red-950"
            >
              Terminate Flow
            </button>
          )}
          {canEditWorkflow && (
            <button 
              onClick={runManually} 
              disabled={runLoading || isManualRunning} 
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/10 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
            >
              {runLoading || isManualRunning ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Executing...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Deploy Manual Run</span>
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Latest Run Execution Logs Display */}
      <AnimatePresence>
        {liveRun && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="m-6 mb-2"
          >
            <div className={`p-4 rounded-2xl border text-xs relative overflow-hidden backdrop-blur-md shadow-xl ${
              liveRun.status === 'failed' ? 'bg-red-950/15 text-red-300 border-red-900/40 shadow-red-950/5' : 
              liveRun.status === 'completed' ? 'bg-emerald-950/15 text-emerald-300 border-emerald-900/40 shadow-emerald-950/5' : 
              'bg-indigo-950/15 text-indigo-300 border-indigo-900/40 shadow-indigo-950/5'
            }`}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-[40px] pointer-events-none" />
              
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                  <span className="font-mono text-[10px] text-slate-400">Pipeline Execution ID: <strong className="text-slate-300 font-mono font-normal">{liveRun.id}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider border ${
                    liveRun.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                    liveRun.status === 'failed' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                    'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 animate-pulse'
                  }`}>{liveRun.status}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-1">
                {liveRun.step_runs?.map((sr: any) => {
                  const stepDef = workflow.workflow_steps?.find((s: any) => s.id === sr.workflow_step_id);
                  return (
                    <div key={sr.id} className="flex justify-between items-center text-[10px] p-2 bg-slate-950/50 rounded-xl border border-slate-900/60 font-mono">
                      <span className="truncate max-w-[120px] text-slate-300">{stepDef ? `${stepDef.name || stepDef.type}` : `Step: ${sr.id.substring(0,6)}`}</span>
                      <div className="flex items-center gap-2">
                        {sr.status === 'paused' && canEditWorkflow && (
                          <button 
                            onClick={() => handleApproveStep(sr.id)} 
                            className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-[9px] shadow transition-all cursor-pointer"
                          >
                            Approve
                          </button>
                        )}
                        <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase ${
                          sr.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                          sr.status === 'paused' ? 'bg-amber-500/20 text-amber-400 animate-pulse' :
                          sr.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                          'bg-indigo-500/20 text-indigo-400'
                        }`}>
                          {sr.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas View */}
      <div className="flex-1 p-6 max-w-4xl w-full mx-auto flex flex-col gap-6">
        
        {/* Triggers Section */}
        <section className="bg-slate-900/20 backdrop-blur-sm p-5 rounded-2xl border border-slate-900/80 relative">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-[30px] pointer-events-none" />
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3.5 font-mono">Trigger Gateways</h3>
          
          <div className="flex flex-col gap-2.5">
            {(workflow.workflow_triggers || []).map((t: any) => (
              <div key={t.id} className="p-3.5 bg-slate-950/40 border border-slate-900/80 rounded-xl flex items-center justify-between shadow-sm hover:border-slate-800/60 transition-all duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono">{t.type} Entrypoint</span>
                    <p className="text-[9px] text-slate-500 mt-0.5 font-mono">Accepts inbound GraphQL & REST schemas</p>
                  </div>
                </div>
                <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono px-2 py-0.5 rounded-full">Passive Listening</span>
              </div>
            ))}

            {(workflow.workflow_triggers || []).length === 0 && (
              <div className="text-[11px] text-slate-600 italic py-2">
                No entrypoint triggers registered. Pipeline cannot execute dynamically.
              </div>
            )}

            {canEditWorkflow && (
              <div className="flex gap-2 mt-2 pt-2 border-t border-slate-900/60">
                <button 
                  onClick={() => handleAddTrigger('webhook')} 
                  className="text-[10px] font-medium px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg transition-all cursor-pointer"
                >
                  + Webhook Trigger
                </button>
                <button 
                  onClick={() => handleAddTrigger('manual')} 
                  className="text-[10px] font-medium px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg transition-all cursor-pointer"
                >
                  + Manual Trigger
                </button>
                <button 
                  onClick={() => handleAddTrigger('scheduled')} 
                  className="text-[10px] font-medium px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg transition-all cursor-pointer"
                >
                  + Cron Schedule Trigger
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Steps Visual Chain */}
        <section className="bg-slate-900/20 backdrop-blur-sm p-5 rounded-2xl border border-slate-900/80 flex-1 flex flex-col relative">
          <div className="absolute top-1/2 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-[45px] pointer-events-none" />
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 font-mono">Step Execution Pipeline</h3>
          
          <div className="flex flex-col gap-0.5 flex-1 justify-center">
            {(workflow.workflow_steps || []).map((step: any, index: number) => {
              // Custom design specs for each step type
              let stepStyle = {
                color: 'text-indigo-400',
                border: 'border-indigo-950/80',
                bg: 'bg-indigo-950/10',
                icon: <Sparkles className="w-4 h-4 text-indigo-400" />,
                title: 'AI Gen LLM Call'
              };

              if (step.type === 'http_request') {
                stepStyle = {
                  color: 'text-violet-400',
                  border: 'border-violet-950/80',
                  bg: 'bg-violet-950/10',
                  icon: <Link className="w-4 h-4 text-violet-400" />,
                  title: 'HTTP JSON Webhook Request'
                };
              } else if (step.type === 'conditional_branch') {
                stepStyle = {
                  color: 'text-pink-400',
                  border: 'border-pink-950/80',
                  bg: 'bg-pink-950/10',
                  icon: <Layers className="w-4 h-4 text-pink-400" />,
                  title: 'Conditional Decision split'
                };
              } else if (step.type === 'approval_gate') {
                stepStyle = {
                  color: 'text-amber-400',
                  border: 'border-amber-950/80',
                  bg: 'bg-amber-950/10',
                  icon: <Lock className="w-4 h-4 text-amber-400" />,
                  title: 'Enterprise Approval Gate'
                };
              } else if (step.type === 'db_write') {
                stepStyle = {
                  color: 'text-emerald-400',
                  border: 'border-emerald-950/80',
                  bg: 'bg-emerald-950/10',
                  icon: <Database className="w-4 h-4 text-emerald-400" />,
                  title: 'Database Persistent Write'
                };
              } else if (step.type === 'notify') {
                stepStyle = {
                  color: 'text-cyan-400',
                  border: 'border-cyan-950/80',
                  bg: 'bg-cyan-950/10',
                  icon: <Bell className="w-4 h-4 text-cyan-400" />,
                  title: 'Aethera Dispatch Notification'
                };
              }

              return (
                <div key={step.id} className="flex flex-col items-center">
                  {/* Pipeline Flow Arrow */}
                  {index > 0 && (
                    <div className="h-6 w-px border-l border-dashed border-slate-800 my-1 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                    </div>
                  )}

                  {/* Step Card with custom specs */}
                  <div className={`w-full p-4 rounded-xl border ${stepStyle.border} ${stepStyle.bg} flex flex-col gap-3 shadow-md hover:-translate-y-0.5 hover:border-slate-800 transition-all duration-300`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-slate-950 flex items-center justify-center font-mono text-xs font-bold text-slate-400 border border-slate-900">
                          {index + 1}
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-white tracking-wide">{step.name || stepStyle.title}</h4>
                          <p className={`text-[9px] font-mono uppercase tracking-widest ${stepStyle.color} mt-0.5`}>{step.type}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canEditWorkflow && (
                          <>
                            <div className="flex items-center bg-slate-900 rounded-md border border-slate-800 mr-2">
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleReorderStep(step, 'up'); }}
                                disabled={isReordering || index === 0}
                                className="p-1 text-slate-500 hover:text-indigo-400 disabled:opacity-30 transition-all cursor-pointer border-r border-slate-800"
                              >
                                <ChevronDown className="w-3.5 h-3.5 transform rotate-180" />
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleReorderStep(step, 'down'); }}
                                disabled={isReordering || index === (workflow.workflow_steps?.length || 0) - 1}
                                className="p-1 text-slate-500 hover:text-indigo-400 disabled:opacity-30 transition-all cursor-pointer"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id, index); }} 
                              className="text-slate-600 hover:text-red-400 hover:bg-red-950/20 p-1 rounded-md transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-900 select-none">
                          {stepStyle.icon}
                        </div>
                      </div>
                    </div>

                    {/* Conditional Branching Preview Structure */}
                    {step.type === 'conditional_branch' && (
                      <div className="mt-1 p-3 bg-slate-950/40 rounded-lg border border-slate-900/60 text-[10px] font-mono leading-relaxed">
                        <div className="flex items-center gap-1.5 text-pink-400 font-semibold uppercase text-[9px] tracking-wider mb-2">
                          <Layers className="w-3.5 h-3.5" />
                          <span>Branch Evaluation Logic</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1 text-slate-400">
                          <div className="p-2 bg-slate-950 border border-slate-900 rounded-lg relative">
                            <span className="absolute top-2 right-2 text-[8px] px-1 bg-emerald-950 text-emerald-400 rounded">TRUE</span>
                            <span className="text-[9px] text-slate-500 block uppercase mb-1">If Condition Passes</span>
                            <span className="text-white">Run branch actions...</span>
                          </div>
                          <div className="p-2 bg-slate-950 border border-slate-900 rounded-lg relative">
                            <span className="absolute top-2 right-2 text-[8px] px-1 bg-red-950 text-red-400 rounded">FALSE</span>
                            <span className="text-[9px] text-slate-500 block uppercase mb-1">If Condition Fails</span>
                            <span className="text-white">Proceed to next step...</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {(workflow.workflow_steps || []).length === 0 && (
              <div className="text-[11px] text-slate-500 italic text-center py-12 flex flex-col items-center gap-2">
                <Cpu className="w-6 h-6 text-slate-700" />
                <span>No components defined in this execution pipe.</span>
              </div>
            )}

            {canEditWorkflow && (
              <div className="flex flex-wrap gap-1.5 mt-4 pt-3.5 border-t border-slate-950">
                <button 
                  onClick={() => handleAddStep('llm_call')} 
                  className="text-[10px] font-semibold px-2.5 py-1.5 bg-indigo-950/20 hover:bg-indigo-900/20 border border-indigo-900/20 text-indigo-300 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ AI LLM Call</span>
                </button>
                <button 
                  onClick={() => handleAddStep('http_request')} 
                  className="text-[10px] font-semibold px-2.5 py-1.5 bg-violet-950/20 hover:bg-violet-900/20 border border-violet-900/20 text-violet-300 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ HTTP Request</span>
                </button>
                <button 
                  onClick={() => handleAddStep('conditional_branch')} 
                  className="text-[10px] font-semibold px-2.5 py-1.5 bg-pink-950/20 hover:bg-pink-900/20 border border-pink-900/20 text-pink-300 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Decision Condition</span>
                </button>
                <button 
                  onClick={() => handleAddStep('approval_gate')} 
                  className="text-[10px] font-semibold px-2.5 py-1.5 bg-amber-950/20 hover:bg-amber-900/20 border border-amber-900/20 text-amber-300 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Approval Gate</span>
                </button>
                <button 
                  onClick={() => handleAddStep('db_write')} 
                  className="text-[10px] font-semibold px-2.5 py-1.5 bg-emerald-950/20 hover:bg-emerald-900/20 border border-emerald-900/20 text-emerald-300 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ DB Storage Write</span>
                </button>
                <button 
                  onClick={() => handleAddStep('notify')} 
                  className="text-[10px] font-semibold px-2.5 py-1.5 bg-cyan-950/20 hover:bg-cyan-900/20 border border-cyan-900/20 text-cyan-300 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Notification</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Workflow Execution History & Persistence Data Tables */}
        <section className="bg-slate-900/20 backdrop-blur-sm p-5 rounded-2xl border border-slate-900/80 flex flex-col gap-4 relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-[45px] pointer-events-none" />
          
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-indigo-400" />
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Persistence Space Explorer</h3>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleSeedData}
                disabled={isSeeding}
                className="text-[10px] font-semibold px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 rounded-xl shadow-md shadow-indigo-600/10 transition-all cursor-pointer flex items-center gap-1"
              >
                {isSeeding ? 'Populating...' : 'Seed Demo Data'}
              </button>
              <button 
                onClick={fetchRunsAndOutputs} 
                className="text-[10px] font-semibold px-3 py-1 bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 rounded-xl transition-all cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh Space</span>
              </button>
            </div>
          </div>

          {/* Sub-Tabs Selector */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-900/80 select-none">
            <button
              onClick={() => setActiveTab('runs')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg transition-all cursor-pointer ${activeTab === 'runs' ? 'bg-indigo-600 text-white font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              1. Execution Runs ({executedRuns.length})
            </button>
            <button
              onClick={() => setActiveTab('steps')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg transition-all cursor-pointer ${activeTab === 'steps' ? 'bg-indigo-600 text-white font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              2. Step Runs ({executedRuns.flatMap((r: any) => r.step_runs || []).length})
            </button>
            <button
              onClick={() => setActiveTab('outputs')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg transition-all cursor-pointer ${activeTab === 'outputs' ? 'bg-indigo-600 text-white font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              3. Outputs ({executedOutputs.length})
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg transition-all cursor-pointer ${activeTab === 'notifications' ? 'bg-indigo-600 text-white font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              4. Dispatch ({executedNotifications.length})
            </button>
          </div>

          {/* Sub-Tab content visualization */}
          <div className="mt-1">
            {activeTab === 'runs' && (
              <div className="flex flex-col gap-2">
                {executedRuns.length === 0 ? (
                  <div className="p-4 bg-slate-950/40 border border-slate-900/60 rounded-xl text-xs text-slate-500 italic text-center">
                    No execution run events recorded in database yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto">
                    {executedRuns.map((run: any) => (
                      <div key={run.id} className="p-3 bg-slate-950/60 border border-slate-900/60 rounded-xl flex flex-col gap-2 font-mono">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-indigo-400">Run ID: <span className="text-white">{run.id}</span></span>
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${
                            run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            run.status === 'failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                          }`}>
                            {run.status}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-900/60 pt-1.5">
                          <span>Started: {new Date(run.started_at || run.created_at).toLocaleString()}</span>
                          {run.completed_at && <span>Completed: {new Date(run.completed_at).toLocaleTimeString()}</span>}
                        </div>
                        {run.output && (
                          <pre className="text-[9px] text-emerald-300 bg-slate-950 p-2 rounded-lg border border-slate-900 overflow-x-auto leading-relaxed">
                            {JSON.stringify(run.output, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'steps' && (
              <div className="flex flex-col gap-2">
                {executedRuns.flatMap((r: any) => r.step_runs || []).length === 0 ? (
                  <div className="p-4 bg-slate-950/40 border border-slate-900/60 rounded-xl text-xs text-slate-500 italic text-center">
                    No pipeline components have completed step run stages.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto">
                    {executedRuns.flatMap((r: any) => r.step_runs || []).map((sr: any) => (
                      <div key={sr.id} className="p-3 bg-slate-950/60 border border-slate-900/60 rounded-xl flex flex-col gap-2 font-mono">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-indigo-400">Step Run ID: <span className="text-white">{sr.id}</span></span>
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${
                            sr.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                            sr.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                          }`}>
                            {sr.status}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-900/60 pt-1.5">
                          <span>Step ID: {sr.workflow_step_id || 'Global'}</span>
                          <span>Attempt Limit: {sr.attempt_count || 1}</span>
                        </div>
                        {sr.output && (
                          <pre className="text-[9px] text-slate-300 bg-slate-950 p-2 rounded-lg border border-slate-900 overflow-x-auto">
                            {JSON.stringify(sr.output, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'outputs' && (
              <div className="flex flex-col gap-2">
                {executedOutputs.length === 0 ? (
                  <div className="p-4 bg-slate-950/40 border border-slate-900/60 rounded-xl text-xs text-slate-500 italic text-center">
                    No written transaction payloads logged.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto">
                    {executedOutputs.map((out: any) => (
                      <div key={out.id} className="p-3 bg-slate-950/60 border border-slate-900/60 rounded-xl flex flex-col gap-2 font-mono">
                        <div className="flex justify-between text-[9px] text-slate-500">
                          <span className="text-indigo-400">Output Log ID: <span className="text-slate-300">{out.id}</span></span>
                          <span>{new Date(out.created_at).toLocaleTimeString()}</span>
                        </div>
                        <pre className="text-[9px] text-emerald-400 overflow-x-auto whitespace-pre bg-slate-950 p-2.5 rounded-lg border border-slate-900 leading-relaxed">
                          {JSON.stringify(out.data, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="flex flex-col gap-2">
                {executedNotifications.length === 0 ? (
                  <div className="p-4 bg-slate-950/40 border border-slate-900/60 rounded-xl text-xs text-slate-500 italic text-center">
                    No outgoing dispatch notifications logged.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto">
                    {executedNotifications.map((notif: any) => (
                      <div key={notif.id} className="p-3 bg-slate-950/60 border border-slate-900/60 rounded-xl flex flex-col gap-2 font-mono">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-indigo-400">Gateway Target: <strong className="text-slate-300 uppercase font-semibold">{notif.channel}</strong></span>
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${notif.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                            {notif.status}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-900/60 pt-1.5">
                          <span>Dispatch ID: {notif.id}</span>
                          <span>Timestamp: {new Date(notif.created_at).toLocaleString()}</span>
                        </div>
                        <pre className="text-[9px] text-cyan-300 overflow-x-auto whitespace-pre bg-slate-950 p-2.5 rounded-lg border border-slate-900 leading-relaxed">
                          {JSON.stringify(notif.payload, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

      {/* Editor Modals */}
      <AnimatePresence>
        {editingStep && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">Edit Step: {editingStep.name}</h3>
                <button onClick={() => setEditingStep(null)} className="text-slate-500 hover:text-white transition-colors cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 text-sm text-slate-300 pr-2 custom-scrollbar">
                {editingStep.type === 'llm_call' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Prompt</label>
                      <textarea
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors h-32"
                        defaultValue={editingStep.config.prompt}
                        id="config-prompt"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Model</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingStep.config.model || 'gemini-3.5-flash'}
                        id="config-model"
                      />
                    </div>
                  </>
                )}
                {editingStep.type === 'http_request' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Method</label>
                      <select id="config-method" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors" defaultValue={editingStep.config.method || 'GET'}>
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">URL</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingStep.config.url}
                        id="config-url"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Body (JSON)</label>
                      <textarea
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors h-24 font-mono text-xs"
                        defaultValue={editingStep.config.body ? JSON.stringify(editingStep.config.body, null, 2) : ''}
                        id="config-body"
                        placeholder="{}"
                      />
                    </div>
                  </>
                )}
                {editingStep.type === 'db_write' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Table</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingStep.config.table}
                        id="config-table"
                      />
                    </div>
                  </>
                )}
                {editingStep.type === 'notify' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Channel</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingStep.config.channel}
                        id="config-channel"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Message</label>
                      <textarea
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors h-24"
                        defaultValue={editingStep.config.message}
                        id="config-message"
                      />
                    </div>
                  </>
                )}
                {editingStep.type === 'approval_gate' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Approver Email</label>
                      <input
                        type="email"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingStep.config.approver}
                        id="config-approver"
                      />
                    </div>
                  </>
                )}
                {editingStep.type === 'conditional_branch' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Field to evaluate</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors font-mono text-xs"
                        defaultValue={editingStep.config.condition?.field}
                        id="config-cond-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Operator</label>
                      <select id="config-cond-op" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors font-mono text-xs" defaultValue={editingStep.config.condition?.operator || 'equals'}>
                        <option value="equals">equals</option>
                        <option value="not_equals">not_equals</option>
                        <option value="contains">contains</option>
                        <option value="not_contains">not_contains</option>
                        <option value="greater_than">greater_than</option>
                        <option value="less_than">less_than</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Comparison Value</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors font-mono text-xs"
                        defaultValue={editingStep.config.condition?.value}
                        id="config-cond-value"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-800">
                <button
                  onClick={() => setEditingStep(null)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const newConfig = { ...editingStep.config };
                    if (editingStep.type === 'llm_call') {
                      newConfig.prompt = (document.getElementById('config-prompt') as HTMLTextAreaElement).value;
                      newConfig.model = (document.getElementById('config-model') as HTMLInputElement).value;
                    } else if (editingStep.type === 'http_request') {
                      newConfig.method = (document.getElementById('config-method') as HTMLSelectElement).value;
                      newConfig.url = (document.getElementById('config-url') as HTMLInputElement).value;
                      try {
                        const bodyVal = (document.getElementById('config-body') as HTMLTextAreaElement).value;
                        newConfig.body = bodyVal ? JSON.parse(bodyVal) : null;
                      } catch (e) {
                        alert("Invalid JSON in body");
                        return;
                      }
                    } else if (editingStep.type === 'db_write') {
                      newConfig.table = (document.getElementById('config-table') as HTMLInputElement).value;
                    } else if (editingStep.type === 'notify') {
                      newConfig.channel = (document.getElementById('config-channel') as HTMLInputElement).value;
                      newConfig.message = (document.getElementById('config-message') as HTMLTextAreaElement).value;
                    } else if (editingStep.type === 'approval_gate') {
                      newConfig.approver = (document.getElementById('config-approver') as HTMLInputElement).value;
                    } else if (editingStep.type === 'conditional_branch') {
                      newConfig.condition = {
                        field: (document.getElementById('config-cond-field') as HTMLInputElement).value,
                        operator: (document.getElementById('config-cond-op') as HTMLSelectElement).value,
                        value: (document.getElementById('config-cond-value') as HTMLInputElement).value,
                      };
                    }
                    handleSaveStepConfig(editingStep.id, newConfig);
                  }}
                  disabled={isSavingConfig}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/20 transition-all cursor-pointer"
                >
                  {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {editingTrigger && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold capitalize">Edit {editingTrigger.type} Trigger</h3>
                <button onClick={() => setEditingTrigger(null)} className="text-slate-500 hover:text-white transition-colors cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 text-sm text-slate-300 pr-2 custom-scrollbar">
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" id="config-trigger-enabled" defaultChecked={editingTrigger.enabled} className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500" />
                  <label htmlFor="config-trigger-enabled" className="text-sm font-medium text-slate-300 cursor-pointer">Trigger Enabled</label>
                </div>
                
                {editingTrigger.type === 'webhook' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Endpoint Path</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingTrigger.config.endpoint}
                        id="config-trigger-endpoint"
                      />
                    </div>
                  </>
                )}
                {editingTrigger.type === 'scheduled' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Cron Expression</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors font-mono"
                        defaultValue={editingTrigger.config.cron}
                        id="config-trigger-cron"
                        placeholder="*/5 * * * *"
                      />
                    </div>
                  </>
                )}
                {editingTrigger.type === 'database_event' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Event Source</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        defaultValue={editingTrigger.config.event}
                        id="config-trigger-event"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-800">
                <button
                  onClick={() => setEditingTrigger(null)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const newConfig = { ...editingTrigger.config };
                    const enabled = (document.getElementById('config-trigger-enabled') as HTMLInputElement).checked;
                    
                    if (editingTrigger.type === 'webhook') {
                      newConfig.endpoint = (document.getElementById('config-trigger-endpoint') as HTMLInputElement).value;
                    } else if (editingTrigger.type === 'scheduled') {
                      newConfig.cron = (document.getElementById('config-trigger-cron') as HTMLInputElement).value;
                    } else if (editingTrigger.type === 'database_event') {
                      newConfig.event = (document.getElementById('config-trigger-event') as HTMLInputElement).value;
                    }
                    
                    handleSaveTriggerConfig(editingTrigger.id, newConfig, enabled);
                  }}
                  disabled={isSavingConfig}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/20 transition-all cursor-pointer"
                >
                  {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
