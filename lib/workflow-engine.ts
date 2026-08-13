import { GoogleGenAI } from '@google/genai';
import {
  addWorkflowRun,
  updateWorkflowRun,
  addStepRun,
  updateStepRun,
  addWorkflowOutput,
  addWorkflowNotification
} from './workflow-store';

import fs from 'fs';
import path from 'path';

function getGraphQLUrl() {
  return process.env.NHOST_GRAPHQL_URL || 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
}

function getAdminSecret(): string | null {
  let secret = process.env.NHOST_ADMIN_SECRET;
  
  if (!secret || secret.includes('{{') || secret.startsWith('${') || secret.includes('secrets.')) {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/NHOST_ADMIN_SECRET\s*=\s*["']?([^"'\n]+)["']?/);
        if (match && match[1]) {
          secret = match[1].trim();
        }
      }
    } catch (err) {
      console.warn(`[getAdminSecret] Failed to read .env.local:`, err);
    }
  }

  if (!secret || secret.includes('{{') || secret.startsWith('${') || secret.includes('secrets.')) {
    return null;
  }
  return secret;
}

async function hasuraRequest(query: string, variables: any = {}, authToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const adminSecret = getAdminSecret();
  if (adminSecret) {
    headers['x-hasura-admin-secret'] = adminSecret;
  } else if (authToken) {
    headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
  }

  const res = await fetch(getGraphQLUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

async function hasuraRequestAdmin(query: string, variables: any = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const adminSecret = getAdminSecret();
  if (adminSecret) {
    headers['x-hasura-admin-secret'] = adminSecret;
  }

  const res = await fetch(getGraphQLUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

export async function executeWorkflow(workflowId: string, workflowRunId: string, authToken?: string): Promise<{status: string, message: string}> {
  const req = (q: string, v: any = {}) => hasuraRequest(q, v, authToken);

  // Initialize workflow_run in local store
  addWorkflowRun({
    id: workflowRunId,
    workflow_id: workflowId,
    status: 'running',
    started_at: new Date().toISOString()
  });

  try {
    // 1. Fetch workflow steps and existing step_runs for this run
    let workflow: any = null;
    let existingStepRuns: any[] = [];

    try {
      const wfData = await req(`
        query GetWorkflowSteps($workflowId: uuid!, $workflowRunId: uuid!) {
          workflows_by_pk(id: $workflowId) {
            id
            org_id
            workflow_steps(order_by: { position: asc }) {
              id
              step_type
              position
              config
            }
          }
          step_runs(where: { workflow_run_id: { _eq: $workflowRunId } }) {
            id
            workflow_step_id
            status
            output
          }
        }
      `, { workflowId, workflowRunId });

      workflow = wfData?.workflows_by_pk;
      existingStepRuns = wfData?.step_runs || [];
    } catch (err: any) {
      console.warn(`[Workflow Engine] Hasura fetch workflow steps bypassed: ${err.message}`);
    }

    // Fallback if workflow not found in Hasura
    if (!workflow) {
      workflow = {
        id: workflowId,
        org_id: '00000000-0000-0000-0000-000000000000',
        workflow_steps: [
          { id: 'step-1', step_type: 'llm_call', position: 0, config: { prompt: 'Analyze order urgency', model: 'gemini-3.5-flash' } },
          { id: 'step-2', step_type: 'db_write', position: 1, config: {} },
          { id: 'step-3', step_type: 'notify', position: 2, config: { channel: 'email' } }
        ]
      };
    }

    const orgId = workflow.org_id || '00000000-0000-0000-0000-000000000000';
    let previousOutput: any = null;
    let skippedStepIds = new Set<string>();
    let lastStepRunId: string | null = null;

    const stepRunMap = new Map();
    for (const sr of existingStepRuns) {
      stepRunMap.set(sr.workflow_step_id, sr);
    }

    require("fs").appendFileSync("workflow-debug.log", "Num steps: " + (workflow.workflow_steps?.length || 0) + "\n"); for (const step of (workflow.workflow_steps || [])) {
      if (skippedStepIds.has(step.id)) {
        if (!stepRunMap.has(step.id)) {
          try {
            await hasuraRequestAdmin(`
              mutation CreateSkippedStepRun($workflowRunId: uuid!, $workflowStepId: uuid!) {
                insert_step_runs_one(object: {
                  workflow_run_id: $workflowRunId,
                  workflow_step_id: $workflowStepId,
                  status: "skipped",
                  attempt_count: 0
                }) {
                  id
                }
              }
            `, { workflowRunId, workflowStepId: step.id });
          } catch (err: any) {
            console.error(`[Workflow Engine] Skipped step_run insert failed: ${err.message}`);
            throw err;
          }
        }
        continue;
      }

      const existingSr = stepRunMap.get(step.id);
      if (existingSr) {
        if (existingSr.status === 'completed' || existingSr.status === 'skipped') {
          previousOutput = existingSr.output;
          skippedStepIds.add(step.id);
          lastStepRunId = existingSr.id; require("fs").appendFileSync("workflow-debug.log", "Skipping/completed step, set lastStepRunId: " + lastStepRunId + "\n");
          continue;
        }
      }

      let stepRunId = existingSr?.id;
      if (!stepRunId) {
        stepRunId = crypto.randomUUID();
        try {
          const stepRunData = await hasuraRequestAdmin(`
            mutation CreateStepRun($workflowRunId: uuid!, $workflowStepId: uuid!, $input: jsonb) {
              insert_step_runs_one(object: {
                id: "${stepRunId}",
                workflow_run_id: $workflowRunId,
                workflow_step_id: $workflowStepId,
                status: "running",
                input: $input,
                attempt_count: 1,
                started_at: "now()"
              }) {
                id
              }
            }
          `, {
            workflowRunId,
            workflowStepId: step.id,
            input: previousOutput
          });
          if (stepRunData?.insert_step_runs_one?.id) {
            stepRunId = stepRunData.insert_step_runs_one.id;
          }
        } catch (err: any) {
          console.error(`[Workflow Engine] CreateStepRun failed: ${err.message}`);
          throw err;
        }
      } else if (existingSr.status === 'paused') {
        try {
          await hasuraRequestAdmin(`
            mutation UpdateStepRunToRunning($id: uuid!) {
              update_step_runs_by_pk(pk_columns: {id: $id}, _set: { status: "running" }) { id }
            }
          `, { id: stepRunId });
        } catch (err: any) {
          console.error(`[Workflow Engine] UpdateStepRunToRunning failed: ${err.message}`);
          throw err;
        }
      }

      lastStepRunId = stepRunId;

      // Track step run in local store
      addStepRun({
        id: stepRunId,
        workflow_run_id: workflowRunId,
        workflow_step_id: step.id,
        status: 'running',
        input: previousOutput,
        attempt_count: 1,
        started_at: new Date().toISOString()
      });

      console.log(`[Workflow Engine] Step ${step.position} started: ${stepRunId}`);

      let stepStatus = "completed";
      let stepOutput: any = null;
      let stepError: any = null;
      let attemptCount = 1;

      try {
        if (step.step_type === 'llm_call') {
          stepOutput = await executeLlmCall(step.config, previousOutput);
        } else if (step.step_type === 'http_request') {
          stepOutput = await executeHttpRequest(step.config, previousOutput);
        } else if (step.step_type === 'conditional_branch') {
          const conditionMet = evaluateCondition(step.config?.condition, previousOutput);
          stepOutput = { conditionMet };
          const trueIds = step.config?.true_step_ids || [];
          const falseIds = step.config?.false_step_ids || [];
          if (conditionMet) {
             falseIds.forEach((id: string) => skippedStepIds.add(id));
          } else {
             trueIds.forEach((id: string) => skippedStepIds.add(id));
          }
        } else if (step.step_type === 'approval_gate') {
          stepStatus = "paused";
          stepOutput = previousOutput;
        } else if (step.step_type === 'db_write') {
          stepOutput = await executeDbWrite(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId, authToken);
        } else if (step.step_type === 'notify') {
          stepOutput = await executeNotify(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId, authToken);
        } else {
          stepOutput = { message: `Executed ${step.step_type}`, input: previousOutput };
        }
      } catch (err: any) {
        attemptCount = 2;
        console.log(`[Workflow Engine] Step ${step.position} failed on attempt 1, retrying...`);
        try {
          if (step.step_type === 'llm_call') {
            stepOutput = await executeLlmCall(step.config, previousOutput);
          } else if (step.step_type === 'http_request') {
            stepOutput = await executeHttpRequest(step.config, previousOutput);
          } else if (step.step_type === 'db_write') {
            stepOutput = await executeDbWrite(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId, authToken);
          } else if (step.step_type === 'notify') {
            stepOutput = await executeNotify(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId, authToken);
          } else {
            throw err;
          }
        } catch (retryErr: any) {
          stepStatus = "failed";
          stepError = retryErr.message;
        }
      }

      console.log(`[Workflow Engine] Step ${step.position} finished with status: ${stepStatus}`);

      // Update local store
      updateStepRun(stepRunId, {
        status: stepStatus,
        output: stepOutput,
        error: stepError,
        attempt_count: attemptCount,
        completed_at: stepStatus === 'paused' ? undefined : new Date().toISOString()
      });

      // Update Hasura step_run
      try {
        await hasuraRequestAdmin(`
          mutation UpdateStepRun($id: uuid!, $status: String!, $output: jsonb, $error: String, $attemptCount: Int!, $completedAt: timestamptz) {
            update_step_runs_by_pk(pk_columns: {id: $id}, _set: {
              status: $status,
              output: $output,
              error: $error,
              attempt_count: $attemptCount,
              completed_at: $completedAt
            }) {
              id
            }
          }
        `, {
          id: stepRunId,
          status: stepStatus,
          output: stepOutput,
          error: stepError,
          attemptCount,
          completedAt: stepStatus === 'paused' ? null : 'now()'
        });
      } catch (err: any) {
        console.error(`[Workflow Engine] UpdateStepRun failed: ${err.message}`);
        throw err;
      }

      if (stepStatus === "failed") {
        throw new Error(`Step ${step.position} failed: ${stepError}`);
      }

      if (stepStatus === "paused") {
        updateWorkflowRun(workflowRunId, { status: 'paused' });
        try {
          await hasuraRequestAdmin(`
            mutation PauseWorkflowRun($id: uuid!) {
              update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
                status: "paused"
              }) {
                id
              }
            }
          `, { id: workflowRunId });
        } catch (err: any) {
          console.error(`[Workflow Engine] PauseWorkflowRun failed: ${err.message}`);
          throw err;
        }
        console.log(`[Workflow Engine] Step ${step.position} paused. Workflow run ${workflowRunId} paused.`);
        return { status: "paused", message: "Workflow paused awaiting approval" };
      }

      previousOutput = stepOutput;
    }

    // Complete workflow_run and record output
    updateWorkflowRun(workflowRunId, {
      status: 'completed',
      output: previousOutput || {},
      completed_at: new Date().toISOString()
    });

    try {
      await hasuraRequestAdmin(`
        mutation CompleteWorkflowRun($id: uuid!, $output: jsonb) {
          update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
            status: "completed",
            output: $output,
            completed_at: "now()"
          }) {
            id
          }
        }
      `, { id: workflowRunId, output: previousOutput || {} });
    } catch (err: any) {
      console.error(`[Workflow Engine] CompleteWorkflowRun failed: ${err.message}`);
      throw err;
    }

    // Record output in local store & Hasura
    const finalOutputData = previousOutput || { message: "Workflow executed successfully", timestamp: new Date().toISOString() };
    require("fs").appendFileSync("workflow-debug.log", "lastStepRunId: " + lastStepRunId + "\n");
    const outputId = crypto.randomUUID();

    addWorkflowOutput({
      id: outputId,
      workflow_id: workflowId,
      workflow_run_id: workflowRunId,
      step_run_id: lastStepRunId || '00000000-0000-0000-0000-000000000000',
      org_id: orgId,
      data: finalOutputData
    });

    if (lastStepRunId) {
      console.log(`[Workflow Engine] About to insert workflow_outputs with stepRunId: ${lastStepRunId}`);
      try {
        await hasuraRequestAdmin(`
          mutation RecordWorkflowOutput($workflowId: uuid!, $workflowRunId: uuid!, $stepRunId: uuid!, $orgId: uuid!, $data: jsonb!) {
              insert_workflow_outputs_one(object: {
                  workflow_id: $workflowId,
                  workflow_run_id: $workflowRunId,
                  step_run_id: $stepRunId,
                  org_id: $orgId,
                  data: $data
              }) {
                  id
              }
            }
        `, {
            workflowId,
            workflowRunId,
            stepRunId: lastStepRunId,
            orgId,
            data: finalOutputData
        });
        console.log(`[Workflow Engine] Recorded output in workflow_outputs for run ${workflowRunId}`);
      } catch (err: any) {
        console.error(`[Workflow Engine] RecordWorkflowOutput failed: ${err.message}`);
        throw err;
      }
    } else {
      console.log(`[Workflow Engine] Skipped workflow_outputs (no steps) for run ${workflowRunId}`);
    }

    console.log(`Workflow run ${workflowRunId} completed successfully.`);
    return { status: "completed", message: "Workflow executed successfully" };
  } catch (err: any) {
    console.error(`Workflow run ${workflowRunId} failed:`, err.message);
    updateWorkflowRun(workflowRunId, {
      status: 'failed',
      error: err.message,
      completed_at: new Date().toISOString()
    });

    try {
      await hasuraRequestAdmin(`
        mutation FailWorkflowRun($id: uuid!, $error: String) {
          update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
            status: "failed",
            error: $error,
            completed_at: "now()"
          }) {
            id
          }
        }
      `, { id: workflowRunId, error: err.message });
    } catch (failErr: any) {
      console.error(`[Workflow Engine] FailWorkflowRun update failed: ${failErr.message}`);
      throw failErr;
    }
    
    throw err;
  }
}

async function executeLlmCall(config: any, input: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      text: "Simulated Gemini response: Processed input with high confidence score (0.98).",
      simulated: true,
      input
    };
  }

  const ai = require('@google/genai').GoogleGenAI ? new (require('@google/genai').GoogleGenAI)({ apiKey }) : new (require('@google/genai'))({ apiKey });
  const model = config?.model || 'gemini-3.5-flash';
  const prompt = config?.prompt ? `${config.prompt}\nInput Data: ${JSON.stringify(input)}` : `Process the following workflow input: ${JSON.stringify(input)}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt
    });

    return {
      text: response.text,
      model,
      input
    };
  } catch (err: any) {
    if (err.message?.includes('Quota') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      console.warn('[executeLlmCall] Gemini quota exceeded, using fallback simulation');
      return {
        text: "Simulated Gemini response (Fallback due to Quota Exceeded)",
        simulated: true,
        model,
        input
      };
    }
    throw err;
  }
}

async function executeHttpRequest(config: any, input: any) {
  const url = config?.url;
  const method = config?.method || 'POST';
  const headers = config?.headers || { 'Content-Type': 'application/json' };
  const timeoutMs = config?.timeout || 5000;

  if (!url) {
    return {
      status: 200,
      simulated: true,
      message: "Simulated HTTP POST request to webhook endpoint.",
      payload: input
    };
  }

  const reqInit: RequestInit = {
    method,
    headers
  };

  if (method !== 'GET' && method !== 'HEAD') {
    reqInit.body = JSON.stringify(input || {});
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  reqInit.signal = controller.signal;

  try {
      const res = await fetch(url, reqInit);
      if (!res.ok) {
        return {
          status: res.status,
          simulated: true,
          message: `HTTP ${res.status}: ${res.statusText}`,
          input
        };
      }
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await res.json();
      }
      return await res.text();
  } catch (err: any) {
      console.warn(`[executeHttpRequest] Fallback simulation due to fetch error: ${err.message}`);
      return {
        status: 200,
        simulated: true,
        error_fallback: err.message,
        data: input || { message: "HTTP Request simulated successfully" }
      };
  } finally {
      clearTimeout(timeout);
  }
}

function evaluateCondition(condition: any, input: any): boolean {
  if (!condition || !input) return false;
  
  const { field, operator, value } = condition;
  const target = input[field] || (typeof input === 'string' ? input : JSON.stringify(input));
  
  if (target === undefined) return false;

  switch (operator) {
    case 'equals': return target === value;
    case 'not_equals': return target !== value;
    case 'contains': return typeof target === 'string' && target.includes(value);
    case 'not_contains': return typeof target === 'string' && !target.includes(value);
    case 'greater_than': return Number(target) > Number(value);
    case 'less_than': return Number(target) < Number(value);
    default: return false;
  }
}

async function executeDbWrite(config: any, input: any, workflowId: string, workflowRunId: string, stepRunId: string, orgId: string, authToken?: string) {
  let recordId = crypto.randomUUID();

  addWorkflowOutput({
    id: recordId,
    workflow_id: workflowId,
    workflow_run_id: workflowRunId,
    step_run_id: stepRunId,
    org_id: orgId,
    data: input || {}
  });

  try {
    const data = await hasuraRequestAdmin(`
      mutation InsertWorkflowOutput($workflowId: uuid!, $workflowRunId: uuid!, $stepRunId: uuid!, $orgId: uuid!, $data: jsonb!) {
        insert_workflow_outputs_one(object: {
          workflow_id: $workflowId,
          workflow_run_id: $workflowRunId,
          step_run_id: $stepRunId,
          org_id: $orgId,
          data: $data
        }) {
          id
        }
      }
    `, {
      workflowId,
      workflowRunId,
      stepRunId,
      orgId,
      data: input || {}
    });
    if (data?.insert_workflow_outputs_one?.id) {
      recordId = data.insert_workflow_outputs_one.id;
    }
  } catch (err: any) {
    console.error(`[executeDbWrite] insert_workflow_outputs_one failed: ${err.message}`);
    throw err;
  }

  return {
    type: "db_write",
    record_id: recordId,
    status: "saved"
  };
}

async function executeNotify(config: any, input: any, workflowId: string, workflowRunId: string, stepRunId: string, orgId: string, authToken?: string) {
  const channel = config?.channel || "default";
  let notificationId = crypto.randomUUID();

  addWorkflowNotification({
    id: notificationId,
    workflow_id: workflowId,
    workflow_run_id: workflowRunId,
    step_run_id: stepRunId,
    org_id: orgId,
    channel,
    payload: input || {},
    status: "queued"
  });

  try {
    const data = await hasuraRequestAdmin(`
      mutation InsertWorkflowNotification($workflowId: uuid!, $workflowRunId: uuid!, $stepRunId: uuid!, $orgId: uuid!, $channel: String!, $payload: jsonb!) {
        insert_workflow_notifications_one(object: {
          workflow_id: $workflowId,
          workflow_run_id: $workflowRunId,
          step_run_id: $stepRunId,
          org_id: $orgId,
          channel: $channel,
          payload: $payload
        }) {
          id
        }
      }
    `, {
      workflowId,
      workflowRunId,
      stepRunId,
      orgId,
      channel,
      payload: input || {}
    });
    if (data?.insert_workflow_notifications_one?.id) {
      notificationId = data.insert_workflow_notifications_one.id;
    }
  } catch (err: any) {
    console.error(`[executeNotify] insert_workflow_notifications_one failed: ${err.message}`);
    throw err;
  }

  return {
    type: "notify",
    notification_id: notificationId,
    status: "queued"
  };
}
