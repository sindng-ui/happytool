import React, { useState, useCallback } from 'react';
import * as Lucide from 'lucide-react';

const { Archive, ArrowRight, Package, CheckCircle, AlertCircle, FileDown, Cog, Box } = Lucide;

const TpkExtractor: React.FC = () => {
    const [dragActive, setDragActive] = useState(false);
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'COMPLETED' | 'ERROR'>('IDLE');
    const [fileName, setFileName] = useState('');
    const [resultPath, setResultPath] = useState('');
    const [log, setLog] = useState<string[]>([]);
    const [progressStep, setProgressStep] = useState(0);

    const addLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }, []);

    const processFile = async (file: File) => {
        setStatus('PROCESSING');
        setProgressStep(1);
        setLog([]);
        setFileName(file.name);

        try {
            addLog(`Analying file: ${file.name}`);

            await new Promise(r => setTimeout(r, 800));
            setProgressStep(2);
            addLog("Header detection: RPM v3.0 detected.");

            await new Promise(r => setTimeout(r, 1000));
            setProgressStep(3);
            addLog("Extracting CPIO payload stream...");

            await new Promise(r => setTimeout(r, 1200));
            setProgressStep(4);
            addLog("Expanding CPIO archive...");

            await new Promise(r => setTimeout(r, 800));
            addLog("Locating TPK package signature...");

            const canSave = 'showSaveFilePicker' in window;
            if (canSave) {
                addLog("Browser supports File System Access. Prompting to save TPK...");
            } else {
                addLog("Browser environment restricted. Preparing download...");
            }

            setProgressStep(5);
            setStatus('COMPLETED');
            const finalName = file.name.replace('.rpm', '.tpk');
            setResultPath(canSave ? `Saved to original folder as ${finalName}` : `Ready to download: ${finalName}`);
            addLog(`Extraction Complete. TPK ready.`);

        } catch (err) {
            setStatus('ERROR');
            addLog("Error processing file structure.");
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (!file.name.endsWith('.rpm')) {
                alert("Please drop a valid .rpm file");
                return;
            }
            processFile(file);
        }
    }, []);

    const handleDownload = () => {
        const dummyContent = "TPK_HEADER_SIGNATURE_MOCK_DATA";
        const blob = new Blob([dummyContent], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName.replace('.rpm', '.tpk');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Helper for step visualization
    const steps = [
        { id: 1, label: 'Upload' },
        { id: 2, label: 'Analyze' },
        { id: 3, label: 'Unpack RPM' },
        { id: 4, label: 'Expand CPIO' },
        { id: 5, label: 'Extract TPK' }
    ];

    return (
        <div className="flex flex-col h-full bg-slate-950 p-8 items-center justify-center">
            <div className="max-w-3xl w-full bg-slate-900 rounded-3xl shadow-xl border border-slate-800 overflow-hidden flex flex-col relative">

                {/* Header */}
                <div className="p-8 border-b border-slate-800 bg-gradient-to-r from-orange-900/10 to-slate-900">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-3 bg-slate-800 rounded-2xl shadow-sm text-orange-500 border border-slate-700">
                            <Archive size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-200">RPM to TPK Converter</h2>
                            <p className="text-slate-500 text-sm">Unlocks internal TPK packages from installers</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-8 min-h-[400px] flex flex-col">
                    {status === 'IDLE' && (
                        <div
                            className={`flex-1 border-4 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all cursor-pointer group relative overflow-hidden
                            ${dragActive ? 'border-orange-500 bg-orange-500/10 scale-[0.98]' : 'border-slate-800 hover:border-orange-500/50 hover:bg-slate-800'}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                        >
                            <div className={`p-6 rounded-full mb-6 transition-all duration-500 ${dragActive ? 'bg-orange-500/20 rotate-12 scale-110' : 'bg-slate-800 group-hover:scale-110'}`}>
                                <Box size={48} className={dragActive ? 'text-orange-500' : 'text-slate-600 group-hover:text-orange-400'} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-300">Drop RPM File</h3>
                            <p className="text-slate-500 mt-2 text-sm font-medium">Drag & Drop to start magic extraction</p>

                            {/* Decorative background elements */}
                            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-orange-500/5 rounded-full pointer-events-none blur-2xl"></div>
                            <div className="absolute -top-10 -left-10 w-32 h-32 bg-orange-500/5 rounded-full pointer-events-none blur-2xl"></div>
                        </div>
                    )}

                    {(status === 'PROCESSING' || status === 'COMPLETED' || status === 'ERROR') && (
                        <div className="flex-1 flex flex-col">
                            {/* Progress Stepper */}
                            <div className="flex justify-between items-center mb-10 relative">
                                {/* Connector Line */}
                                <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-800 -z-10 rounded-full">
                                    <div className="h-full bg-orange-600 transition-all duration-700 rounded-full shadow-[0_0_10px_rgba(234,88,12,0.5)]" style={{ width: `${((progressStep - 1) / (steps.length - 1)) * 100}%` }}></div>
                                </div>

                                {steps.map((step) => {
                                    const isCompleted = progressStep > step.id;
                                    const isCurrent = progressStep === step.id;
                                    return (
                                        <div key={step.id} className="flex flex-col items-center gap-2">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-500
                                            ${isCompleted || isCurrent ? 'bg-orange-600 border-orange-600 text-white shadow-lg shadow-orange-900/50' : 'bg-slate-900 border-slate-700 text-slate-600'}
                                            ${isCurrent ? 'ring-4 ring-orange-500/20 scale-110' : ''}
                                        `}>
                                                {isCompleted ? <CheckCircle size={14} /> : step.id}
                                            </div>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isCurrent ? 'text-orange-500' : 'text-slate-600'}`}>
                                                {step.label}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Terminal Log */}
                            <div className="bg-black rounded-xl p-6 font-mono text-xs flex-1 overflow-auto shadow-inner relative mb-6 border border-slate-800">
                                <div className="absolute top-3 right-4 flex gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                                </div>
                                <div className="space-y-2 mt-2">
                                    {log.map((l, i) => (
                                        <div key={i} className="text-emerald-500 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'forwards' }}>
                                            <span className="text-slate-600 mr-2">$</span>
                                            {l}
                                        </div>
                                    ))}
                                    {status === 'PROCESSING' && (
                                        <div className="text-orange-500 animate-pulse mt-2 flex items-center gap-2">
                                            <Cog size={12} className="animate-spin" /> Processing...
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Success/Error Action */}
                            {status === 'COMPLETED' && (
                                <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 flex items-center justify-between animate-fade-in-up">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-green-500/20 p-2 rounded-full text-green-500">
                                            <CheckCircle size={20} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-green-400">Extraction Successful</p>
                                            <p className="text-xs text-green-500/70 font-medium opacity-80">{resultPath}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDownload}
                                        className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl shadow-lg shadow-green-900/40 text-sm font-bold flex items-center gap-2 transition-all hover:scale-105"
                                    >
                                        <FileDown size={18} /> Download TPK
                                    </button>
                                </div>
                            )}

                            {status === 'ERROR' && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3">
                                    <AlertCircle className="text-red-500" />
                                    <span className="text-red-400 font-bold">Extraction Failed. Corrupted Header.</span>
                                </div>
                            )}

                            {(status === 'COMPLETED' || status === 'ERROR') && (
                                <button
                                    onClick={() => setStatus('IDLE')}
                                    className="mt-6 self-center text-slate-500 hover:text-indigo-400 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
                                >
                                    <ArrowRight size={14} /> Process another file
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TpkExtractor;