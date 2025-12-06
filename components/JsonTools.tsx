import React, { useState } from 'react';
import * as Lucide from 'lucide-react';

const { Braces, GitCompare, Copy, Trash2, CheckCircle, AlertCircle, ArrowRightLeft, AlignLeft, Minimize2, FileJson } = Lucide;

type Mode = 'FORMATTER' | 'DIFF';

const JsonTools: React.FC = () => {
    const [mode, setMode] = useState<Mode>('FORMATTER');

    // Formatter State
    const [input, setInput] = useState('');
    const [formatted, setFormatted] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [valid, setValid] = useState(false);

    // Diff State
    const [leftJson, setLeftJson] = useState('');
    const [rightJson, setRightJson] = useState('');
    const [diffResult, setDiffResult] = useState<{ leftLines: string[], rightLines: string[] } | null>(null);
    const [diffError, setDiffError] = useState<string | null>(null);

    // --- Formatter Logic ---
    const handleFormat = () => {
        if (!input.trim()) {
            setFormatted('');
            setValid(false);
            setError(null);
            return;
        }
        try {
            const obj = JSON.parse(input);
            setFormatted(JSON.stringify(obj, null, 2));
            setValid(true);
            setError(null);
        } catch (e: any) {
            setValid(false);
            setError(e.message);
            setFormatted('');
        }
    };

    const handleMinify = () => {
        if (!input.trim()) return;
        try {
            const obj = JSON.parse(input);
            setFormatted(JSON.stringify(obj));
            setValid(true);
            setError(null);
        } catch (e: any) {
            setValid(false);
            setError(e.message);
        }
    };

    const clearFormatter = () => {
        setInput('');
        setFormatted('');
        setError(null);
        setValid(false);
    };

    // --- Diff Logic ---
    const handleCompare = () => {
        setDiffError(null);
        setDiffResult(null);

        try {
            // 1. Normalize both inputs
            let leftObj, rightObj;

            try { leftObj = JSON.parse(leftJson); } catch (e) { throw new Error("Left JSON is invalid"); }
            try { rightObj = JSON.parse(rightJson); } catch (e) { throw new Error("Right JSON is invalid"); }

            // 2. Convert to lines
            const leftStr = JSON.stringify(leftObj, null, 2);
            const rightStr = JSON.stringify(rightObj, null, 2);

            const leftLines = leftStr.split('\n');
            const rightLines = rightStr.split('\n');

            // 3. Store result
            setDiffResult({ leftLines, rightLines });

        } catch (e: any) {
            setDiffError(e.message);
        }
    };

    // --- Syntax Highlighting Helper ---
    const highlightJson = (jsonStr: string) => {
        if (!jsonStr) return null;

        // Regex to match keys, strings, numbers, booleans, null
        const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;

        // Simpler approach for React: Tokenize and map
        return jsonStr.split('\n').map((line, lineIdx) => {
            // Very basic coloring for keys vs values
            const keyMatch = line.match(/^(\s*)(".*?")(\s*:\s*)(.*)$/);

            if (keyMatch) {
                const [, indent, key, colon, value] = keyMatch;
                return (
                    <div key={lineIdx} className="whitespace-pre">
                        {indent}
                        <span className="text-indigo-400 font-bold">{key}</span>
                        <span className="text-slate-500">{colon}</span>
                        <span className={getValueClass(value)}>{value}</span>
                    </div>
                );
            }
            return <div key={lineIdx} className="whitespace-pre text-slate-400">{line}</div>;
        });
    };

    const getValueClass = (val: string) => {
        val = val.trim();
        if (val.startsWith('"')) return 'text-emerald-400';
        if (val === 'true' || val === 'false') return 'text-orange-400';
        if (val === 'null') return 'text-red-400';
        if (!isNaN(Number(val.replace(',', '')))) return 'text-blue-400';
        return 'text-slate-300';
    };

    const getDiffCount = () => {
        if (!diffResult) return 0;
        return diffResult.leftLines.reduce((count, line, i) => {
            return line !== diffResult.rightLines[i] ? count + 1 : count;
        }, 0);
    };

    return (
        <div className="flex h-full flex-col bg-slate-950">
            {/* Navigation Tabs */}
            <div className="bg-slate-900 border-b border-slate-800 p-4 shrink-0 flex items-center justify-between">
                <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                        onClick={() => setMode('FORMATTER')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'FORMATTER' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        <Braces size={16} /> Formatter & Validator
                    </button>
                    <button
                        onClick={() => setMode('DIFF')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'DIFF' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        <GitCompare size={16} /> Diff Viewer
                    </button>
                </div>
                <div className="text-slate-500 text-xs font-mono bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
                    JSON Tools v1.0
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden p-6 relative">

                {/* FORMATTER MODE */}
                {mode === 'FORMATTER' && (
                    <div className="flex h-full gap-6">
                        {/* Input Pane */}
                        <div className="flex-1 flex flex-col gap-2">
                            <div className="flex justify-between items-center text-slate-400 px-2">
                                <span className="text-xs font-bold uppercase tracking-wider">Raw Input</span>
                                <div className="flex gap-2">
                                    <button onClick={clearFormatter} className="p-1 hover:text-red-400 transition-colors" title="Clear">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                            <textarea
                                className={`flex-1 bg-slate-900 rounded-2xl border p-4 font-mono text-sm text-slate-300 focus:outline-none focus:ring-1 resize-none shadow-inner custom-scrollbar ${error ? 'border-red-500/50 focus:ring-red-500' : 'border-slate-800 focus:ring-indigo-500'}`}
                                placeholder="Paste your JSON here..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                spellCheck={false}
                            />
                            <div className="flex gap-3 mt-2">
                                <button onClick={handleFormat} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-indigo-900/30 transition-transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2">
                                    <AlignLeft size={16} /> Beautify
                                </button>
                                <button onClick={handleMinify} className="px-6 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-sm border border-slate-700 transition-colors flex items-center gap-2">
                                    <Minimize2 size={16} /> Minify
                                </button>
                            </div>
                        </div>

                        {/* Output Pane */}
                        <div className="flex-1 flex flex-col gap-2">
                            <div className="flex justify-between items-center text-slate-400 px-2">
                                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                                    {valid ? <span className="text-green-500 flex items-center gap-1"><CheckCircle size={12} /> Valid JSON</span> :
                                        error ? <span className="text-red-500 flex items-center gap-1"><AlertCircle size={12} /> Invalid JSON</span> :
                                            'Formatted Output'}
                                </span>
                                <button
                                    onClick={() => {
                                        if (formatted) {
                                            navigator.clipboard.writeText(formatted);
                                            alert("Copied!");
                                        }
                                    }}
                                    disabled={!valid}
                                    className="p-1 hover:text-indigo-400 transition-colors disabled:opacity-30"
                                    title="Copy Result"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                            <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 p-4 font-mono text-sm overflow-auto custom-scrollbar relative shadow-inner">
                                {error ? (
                                    <div className="text-red-400 p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                                        <strong>Error parsing JSON:</strong><br />
                                        {error}
                                    </div>
                                ) : formatted ? (
                                    <div className="text-sm leading-6">
                                        {highlightJson(formatted)}
                                    </div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600">
                                        <FileJson size={48} className="mb-4 opacity-50" />
                                        <p>Ready to format</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* DIFF MODE */}
                {mode === 'DIFF' && (
                    <div className="flex flex-col h-full gap-4">
                        {/* Inputs */}
                        <div className="h-1/3 flex gap-4 min-h-[150px]">
                            <div className="flex-1 flex flex-col">
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Original JSON</label>
                                <textarea
                                    className="flex-1 bg-slate-900 rounded-xl border border-slate-800 p-3 font-mono text-xs text-slate-400 focus:outline-none focus:border-indigo-500 resize-none"
                                    value={leftJson}
                                    onChange={(e) => setLeftJson(e.target.value)}
                                    placeholder='{"a": 1}'
                                />
                            </div>
                            <div className="flex items-center justify-center">
                                <button
                                    onClick={handleCompare}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-lg shadow-indigo-900/50 transition-transform hover:scale-110 active:scale-95"
                                    title="Compare"
                                >
                                    <ArrowRightLeft size={24} />
                                </button>
                            </div>
                            <div className="flex-1 flex flex-col">
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Modified JSON</label>
                                <textarea
                                    className="flex-1 bg-slate-900 rounded-xl border border-slate-800 p-3 font-mono text-xs text-slate-400 focus:outline-none focus:border-indigo-500 resize-none"
                                    value={rightJson}
                                    onChange={(e) => setRightJson(e.target.value)}
                                    placeholder='{"a": 2}'
                                />
                            </div>
                        </div>

                        {/* Diff Output */}
                        <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex flex-col">
                            <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Comparison Result</span>
                                    {diffResult && (
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getDiffCount() > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                                            {getDiffCount()} Lines Different
                                        </span>
                                    )}
                                </div>
                                {diffError && <span className="text-xs text-red-400 font-bold bg-red-500/10 px-2 py-1 rounded">{diffError}</span>}
                            </div>
                            <div className="flex-1 overflow-auto custom-scrollbar p-2">
                                {diffResult ? (
                                    <div className="flex font-mono text-xs">
                                        {/* Left Result */}
                                        <div className="flex-1 border-r border-slate-800 pr-2">
                                            {diffResult.leftLines.map((line, i) => {
                                                const rightLine = diffResult.rightLines[i];
                                                const isDiff = line !== rightLine;
                                                return (
                                                    <div key={i} className={`flex px-2 ${isDiff ? 'bg-red-500/10' : ''}`}>
                                                        <span className={`w-8 select-none text-right mr-4 ${isDiff ? 'text-red-400 font-bold' : 'text-slate-600'}`}>{i + 1}</span>
                                                        <span className={`whitespace-pre-wrap break-all ${isDiff ? 'text-red-300' : 'text-slate-400'}`}>{line}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Right Result */}
                                        <div className="flex-1 pl-2">
                                            {diffResult.rightLines.map((line, i) => {
                                                const leftLine = diffResult.leftLines[i];
                                                const isDiff = line !== leftLine;
                                                return (
                                                    <div key={i} className={`flex px-2 ${isDiff ? 'bg-green-500/10' : ''}`}>
                                                        <span className={`w-8 select-none text-right mr-4 ${isDiff ? 'text-green-400 font-bold' : 'text-slate-600'}`}>{i + 1}</span>
                                                        <span className={`whitespace-pre-wrap break-all ${isDiff ? 'text-green-300' : 'text-slate-400'}`}>{line}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-slate-700 flex-col gap-2">
                                        <GitCompare size={32} opacity={0.5} />
                                        <p>Enter JSON logs and click compare</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default JsonTools;