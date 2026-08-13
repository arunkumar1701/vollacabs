const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

// Find the last closing div of the main application.
const insertPos = code.lastIndexOf('      </div>\n    </div>\n  );\n}');

const modals = `
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
`;

code = code.substring(0, insertPos) + modals + code.substring(insertPos);

fs.writeFileSync('components/WorkflowApp.tsx', code);
