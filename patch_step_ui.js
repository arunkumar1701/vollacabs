const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

// Replace the step top right actions to include reorder arrows
const targetHtml = `                      <div className="flex items-center gap-2">
                        {canEditWorkflow && (
                          <button 
                            onClick={() => handleDeleteStep(step.id, index)} 
                            className="text-slate-600 hover:text-red-400 hover:bg-red-950/20 p-1 rounded-md transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}`;

const newHtml = `                      <div className="flex items-center gap-2">
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
                        )}`;

code = code.replace(targetHtml, newHtml);

fs.writeFileSync('components/WorkflowApp.tsx', code);
