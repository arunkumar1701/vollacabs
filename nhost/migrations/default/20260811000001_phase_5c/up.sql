CREATE TABLE workflow_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_run_id UUID NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_outputs_org_id_idx ON workflow_outputs(org_id);
CREATE INDEX workflow_outputs_workflow_run_id_idx ON workflow_outputs(workflow_run_id);

CREATE TABLE workflow_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_run_id UUID NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_notifications_org_id_idx ON workflow_notifications(org_id);
CREATE INDEX workflow_notifications_workflow_run_id_idx ON workflow_notifications(workflow_run_id);
