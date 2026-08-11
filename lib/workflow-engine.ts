import { GoogleGenAI } from '@google/genai';

function getGraphQLUrl() {
  const url = process.env.NHOST_GRAPHQL_URL;
  if (!url) throw new Error("NHOST_GRAPHQL_URL is not configured");
  return url;
}

function getAdminSecret() {
  const secret = process.env.NHOST_ADMIN_SECRET;
  if (!secret) throw new Error("NHOST_ADMIN_SECRET is not configured");
  return secret;
}

async function hasuraRequest(query: string, variables: any = {}) {
  const res = await fetch(getGraphQLUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': getAdminSecret(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

export async function executeWorkflow(workflowId: string, workflowRunId: string): Promise<{status: string, message: string}> {
  try {
    // 1. Fetch workflow steps and existing step_runs for this run
    const wfData = await hasuraRequest(`
      query GetWorkflowSteps($workflowId: uuid!, $workflowRunId: uuid!) {
        workflows_by_pk(id: $workflowId) {
          id
          org_id
          workflow_steps(order_by: { position: asc }) {
            id
            type
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

    const workflow = wfData.workflows_by_pk;
    if (!workflow) throw new Error("Workflow not found");
    const orgId = workflow.org_id;

    let previousOutput: any = null;
    let skippedStepIds = new Set<string>();

    const existingStepRuns = wfData.step_runs || [];
    const stepRunMap = new Map();
    for (const sr of existingStepRuns) {
      stepRunMap.set(sr.workflow_step_id, sr);
    }

    for (const step of workflow.workflow_steps) {
      if (skippedStepIds.has(step.id)) {
        // Only log a skipped step_run if it doesn't already exist
        if (!stepRunMap.has(step.id)) {
          await hasuraRequest(`
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
        }
        continue;
      }

      // Check if this step was already executed (completed, skipped) in a previous partial run (e.g., before an approval pause)
      const existingSr = stepRunMap.get(step.id);
      if (existingSr) {
        if (existingSr.status === 'completed' || existingSr.status === 'skipped') {
          // Restore context
          previousOutput = existingSr.output;
          skippedStepIds.add(step.id);
          continue;
        } else if (existingSr.status === 'paused') {
          // If we encounter a paused step, but the run is active/resuming, it means it was just approved.
          // Wait, actually, the approveStep action sets its status to 'completed'.
          // So if we see 'paused' here, it shouldn't normally happen during an active run, 
          // unless someone manually triggered execution while it's still waiting.
          // We can just throw or return. But let's let it re-evaluate or just skip creating it again.
          // For safety, we shouldn't create a new step_run, we should use the existing one's ID.
          // But since approveStep marks it completed, we will see 'completed' above instead.
        }
      }

      let stepRunId = existingSr?.id;
      if (!stepRunId) {
        // Create step_run
        const stepRunData = await hasuraRequest(`
          mutation CreateStepRun($workflowRunId: uuid!, $workflowStepId: uuid!, $input: jsonb) {
            insert_step_runs_one(object: {
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
        stepRunId = stepRunData.insert_step_runs_one.id;
      } else if (existingSr.status === 'paused') {
          // If it was paused, and somehow we are here (not approved), we should probably re-pause or wait.
          // But actually, approveStep sets it to 'completed', so we'd hit the block above and skip it.
          // If we are here, we are re-running a failed step maybe. 
          await hasuraRequest(`
            mutation UpdateStepRunToRunning($id: uuid!) {
              update_step_runs_by_pk(pk_columns: {id: $id}, _set: { status: "running" }) { id }
            }
          `, { id: stepRunId });
      }

      console.log(`[Workflow Engine] Step ${step.position} started: ${stepRunId}`);

      let stepStatus = "completed";
      let stepOutput: any = null;
      let stepError: any = null;
      let attemptCount = 1;

      try {
        if (step.type === 'llm_call') {
          stepOutput = await executeLlmCall(step.config, previousOutput);
        } else if (step.type === 'http_request') {
          stepOutput = await executeHttpRequest(step.config, previousOutput);
        } else if (step.type === 'conditional_branch') {
          const conditionMet = evaluateCondition(step.config?.condition, previousOutput);
          stepOutput = { conditionMet };
          const trueIds = step.config?.true_step_ids || [];
          const falseIds = step.config?.false_step_ids || [];
          if (conditionMet) {
             falseIds.forEach((id: string) => skippedStepIds.add(id));
          } else {
             trueIds.forEach((id: string) => skippedStepIds.add(id));
          }
        } else if (step.type === 'approval_gate') {
          stepStatus = "paused";
          stepOutput = previousOutput; // pass context through
        } else if (step.type === 'db_write') {
          stepOutput = await executeDbWrite(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId);
        } else if (step.type === 'notify') {
          stepOutput = await executeNotify(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId);
        } else {
          throw new Error(`Step type ${step.type} is not implemented yet`);
        }
      } catch (err: any) {
        attemptCount = 2;
        console.log(`[Workflow Engine] Step ${step.position} failed on attempt 1, retrying...`);
        try {
          if (step.type === 'llm_call') {
            stepOutput = await executeLlmCall(step.config, previousOutput);
          } else if (step.type === 'http_request') {
            stepOutput = await executeHttpRequest(step.config, previousOutput);
          } else if (step.type === 'db_write') {
            stepOutput = await executeDbWrite(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId);
          } else if (step.type === 'notify') {
            stepOutput = await executeNotify(step.config, previousOutput, workflowId, workflowRunId, stepRunId, orgId);
          } else {
            throw err;
          }
        } catch (retryErr: any) {
          stepStatus = "failed";
          stepError = retryErr.message;
        }
      }

      console.log(`[Workflow Engine] Step ${step.position} finished with status: ${stepStatus}`);
      // Update step_run
      await hasuraRequest(`
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

      if (stepStatus === "failed") {
        throw new Error(`Step ${step.position} failed: ${stepError}`);
      }

      if (stepStatus === "paused") {
        await hasuraRequest(`
          mutation PauseWorkflowRun($id: uuid!) {
            update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
              status: "paused"
            }) {
              id
            }
          }
        `, { id: workflowRunId });
        console.log(`[Workflow Engine] Step ${step.position} paused. Workflow run ${workflowRunId} paused.`);
        return { status: "paused", message: "Workflow paused awaiting approval" };
      }

      previousOutput = stepOutput;
    }

    // Complete workflow_run
    await hasuraRequest(`
      mutation CompleteWorkflowRun($id: uuid!) {
        update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
          status: "completed",
          completed_at: "now()"
        }) {
          id
        }
      }
    `, { id: workflowRunId });

    console.log(`Workflow run ${workflowRunId} completed successfully.`);
    return { status: "completed", message: "Workflow executed successfully" };
  } catch (err: any) {
    console.error(`Workflow run ${workflowRunId} failed:`, err.message);
    // Mark workflow_run as failed.
    // NOTE: quota_used is NOT decremented here because quota is only incremented
    // on successful completion (completion-based semantics). No pre-reservation was made.
    await hasuraRequest(`
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
    
    return { status: "failed", message: `Workflow execution failed: ${err.message}` };
  }
}

async function executeLlmCall(config: any, input: any) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = config.prompt || JSON.stringify(input);
  const model = config.model || "gemini-2.5-flash";
  
  const response = await ai.models.generateContent({
    model: model,
    contents: prompt,
  });
  
  return { text: response.text };
}

async function executeHttpRequest(config: any, input: any) {
  const { url, method = 'GET', headers = {}, body, timeoutMs = 10000 } = config;
  if (!url) throw new Error("HTTP request requires a URL");
  
  try {
      new URL(url); // validate URL
  } catch(e) {
      throw new Error("Invalid URL provided");
  }

  const reqInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (method !== 'GET' && method !== 'HEAD') {
    reqInit.body = typeof body === 'string' ? body : JSON.stringify(body || input || {});
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  reqInit.signal = controller.signal;

  try {
      const res = await fetch(url, reqInit);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await res.json();
      }
      return await res.text();
  } catch (err: any) {
      if (err.name === 'AbortError') {
          throw new Error(`HTTP Request timed out after ${timeoutMs}ms`);
      }
      throw err;
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

async function executeDbWrite(config: any, input: any, workflowId: string, workflowRunId: string, stepRunId: string, orgId: string) {
  // We explicitly control what table we write to, ignoring arbitrary user configs.
  const data = await hasuraRequest(`
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

  return {
    type: "db_write",
    record_id: data.insert_workflow_outputs_one.id,
    status: "saved"
  };
}

async function executeNotify(config: any, input: any, workflowId: string, workflowRunId: string, stepRunId: string, orgId: string) {
  const channel = config?.channel || "default";
  
  // Inserting into workflow_notifications triggers the Hasura Event Trigger for safe execution.
  const data = await hasuraRequest(`
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

  return {
    type: "notify",
    notification_id: data.insert_workflow_notifications_one.id,
    status: "queued"
  };
}
