export interface WorkflowRunStoreItem {
  id: string;
  workflow_id: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
  started_at: string;
  completed_at?: string;
  created_at: string;
  step_runs?: StepRunStoreItem[];
}

export interface StepRunStoreItem {
  id: string;
  workflow_run_id: string;
  workflow_step_id: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
  attempt_count: number;
  approved_by?: string;
  approved_at?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface WorkflowOutputStoreItem {
  id: string;
  workflow_id: string;
  workflow_run_id: string;
  step_run_id: string;
  org_id: string;
  data: any;
  created_at: string;
}

export interface WorkflowNotificationStoreItem {
  id: string;
  workflow_id: string;
  workflow_run_id: string;
  step_run_id: string;
  org_id: string;
  channel: string;
  payload: any;
  status: string;
  created_at: string;
}

// Global in-memory storage for SSR persistence
const globalStore = globalThis as unknown as {
  __WORKFLOW_RUNS__?: WorkflowRunStoreItem[];
  __STEP_RUNS__?: StepRunStoreItem[];
  __WORKFLOW_OUTPUTS__?: WorkflowOutputStoreItem[];
  __WORKFLOW_NOTIFICATIONS__?: WorkflowNotificationStoreItem[];
};

if (!globalStore.__WORKFLOW_RUNS__) globalStore.__WORKFLOW_RUNS__ = [];
if (!globalStore.__STEP_RUNS__) globalStore.__STEP_RUNS__ = [];
if (!globalStore.__WORKFLOW_OUTPUTS__) globalStore.__WORKFLOW_OUTPUTS__ = [];
if (!globalStore.__WORKFLOW_NOTIFICATIONS__) globalStore.__WORKFLOW_NOTIFICATIONS__ = [];

export function addWorkflowRun(run: Omit<WorkflowRunStoreItem, 'created_at'> & { created_at?: string }) {
  const item: WorkflowRunStoreItem = {
    ...run,
    created_at: run.created_at || new Date().toISOString(),
    step_runs: run.step_runs || []
  };
  const existingIdx = globalStore.__WORKFLOW_RUNS__!.findIndex(r => r.id === item.id);
  if (existingIdx >= 0) {
    globalStore.__WORKFLOW_RUNS__![existingIdx] = { ...globalStore.__WORKFLOW_RUNS__![existingIdx], ...item };
  } else {
    globalStore.__WORKFLOW_RUNS__!.unshift(item);
  }
  return item;
}

export function updateWorkflowRun(id: string, updates: Partial<WorkflowRunStoreItem>) {
  const item = globalStore.__WORKFLOW_RUNS__!.find(r => r.id === id);
  if (item) {
    Object.assign(item, updates);
  }
  return item;
}

export function addStepRun(stepRun: Omit<StepRunStoreItem, 'created_at'> & { created_at?: string }) {
  const item: StepRunStoreItem = {
    ...stepRun,
    created_at: stepRun.created_at || new Date().toISOString()
  };
  const existingIdx = globalStore.__STEP_RUNS__!.findIndex(sr => sr.id === item.id);
  if (existingIdx >= 0) {
    globalStore.__STEP_RUNS__![existingIdx] = { ...globalStore.__STEP_RUNS__![existingIdx], ...item };
  } else {
    globalStore.__STEP_RUNS__!.push(item);
  }

  // Sync to parent workflow run
  const parentRun = globalStore.__WORKFLOW_RUNS__!.find(r => r.id === item.workflow_run_id);
  if (parentRun) {
    if (!parentRun.step_runs) parentRun.step_runs = [];
    const srIdx = parentRun.step_runs.findIndex(sr => sr.id === item.id);
    if (srIdx >= 0) {
      parentRun.step_runs[srIdx] = { ...parentRun.step_runs[srIdx], ...item };
    } else {
      parentRun.step_runs.push(item);
    }
  }

  return item;
}

export function updateStepRun(id: string, updates: Partial<StepRunStoreItem>) {
  const item = globalStore.__STEP_RUNS__!.find(sr => sr.id === id);
  if (item) {
    Object.assign(item, updates);
    // Sync to parent workflow run
    const parentRun = globalStore.__WORKFLOW_RUNS__!.find(r => r.id === item.workflow_run_id);
    if (parentRun && parentRun.step_runs) {
      const srIdx = parentRun.step_runs.findIndex(sr => sr.id === id);
      if (srIdx >= 0) {
        Object.assign(parentRun.step_runs[srIdx], updates);
      }
    }
  }
  return item;
}

export function addWorkflowOutput(output: Omit<WorkflowOutputStoreItem, 'created_at'> & { created_at?: string }) {
  const item: WorkflowOutputStoreItem = {
    ...output,
    created_at: output.created_at || new Date().toISOString()
  };
  globalStore.__WORKFLOW_OUTPUTS__!.unshift(item);
  return item;
}

export function addWorkflowNotification(notif: Omit<WorkflowNotificationStoreItem, 'created_at'> & { created_at?: string }) {
  const item: WorkflowNotificationStoreItem = {
    ...notif,
    created_at: notif.created_at || new Date().toISOString()
  };
  globalStore.__WORKFLOW_NOTIFICATIONS__!.unshift(item);
  return item;
}

export function getWorkflowRuns(workflowId?: string) {
  if (!workflowId) return globalStore.__WORKFLOW_RUNS__ || [];
  return (globalStore.__WORKFLOW_RUNS__ || []).filter(r => r.workflow_id === workflowId);
}

export function getWorkflowOutputs(workflowId?: string) {
  if (!workflowId) return globalStore.__WORKFLOW_OUTPUTS__ || [];
  return (globalStore.__WORKFLOW_OUTPUTS__ || []).filter(o => o.workflow_id === workflowId);
}

export function getStepRuns(workflowRunId?: string) {
  if (!workflowRunId) return globalStore.__STEP_RUNS__ || [];
  return (globalStore.__STEP_RUNS__ || []).filter(sr => sr.workflow_run_id === workflowRunId);
}

export function getWorkflowNotifications(workflowId?: string) {
  if (!workflowId) return globalStore.__WORKFLOW_NOTIFICATIONS__ || [];
  return (globalStore.__WORKFLOW_NOTIFICATIONS__ || []).filter(n => n.workflow_id === workflowId);
}
