
import React, { useState, useMemo, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as Lucide from 'lucide-react';
import { LogRule, AppSettings, LogHighlight, LogWorkerResponse } from '../types';

const {
    Upload, Plus, Trash2, Copy, Download, X, Sparkles, Zap, ShieldAlert, Save,
    Highlighter, RotateCcw, Columns, Maximize, Check, ChevronLeft, ChevronRight,
    Palette, Bookmark, Split, CornerDownRight, FolderOpen, Folder, GripVertical, FileDown,
    Cog, FileJson
} = Lucide;

interface LogExtractorProps {
    rules: LogRule[];
    onUpdateRules: (rules: LogRule[]) => void;
    onExportSettings: () => void;
    onImportSettings: (settings: AppSettings) => void;
}

const HIGHLIGHT_COLORS = [
    { label: 'Yellow', value: 'bg-yellow-200' },
    { label: 'Red', value: 'bg-red-200' },
    { label: 'Green', value: 'bg-green-200' },
    { label: 'Blue', value: 'bg-blue-200' },
    { label: 'Purple', value: 'bg-purple-200' },
    { label: 'Orange', value: 'bg-orange-200' },
    { label: 'Light Red', value: 'bg-red-100' },
];

const ROW_HEIGHT = 24;
const OVERSCAN = 10;

// --- Sub-Component: Async Log Viewer Pane ---
interface LogViewerPaneProps {
    workerReady: boolean;
    totalMatches: number;
    onScrollRequest: (startIndex: number, count: number) => Promise<{ lineNum: number; content: string }[]>;
    placeholderText: string;
    hotkeyScope?: 'ctrl' | 'alt' | 'none';
    onSyncScroll?: (deltaY: number) => void;
    isRawMode?: boolean;
    highlights?: LogHighlight[];
    activeLineIndex?: number;
    onLineClick?: (index: number) => void;
    onLineDoubleClick?: (index: number) => void;
    onDrop?: (file: File) => void;
    paneId?: 'left' | 'right' | 'single';
    fileName?: string;
    onReset?: () => void;
}

export interface LogViewerHandle {
    scrollBy: (deltaY: number) => void;
    scrollTo: (scrollTop: number) => void;
    jumpToNextBookmark: () => void;
    jumpToPrevBookmark: () => void;
}

const LogViewerPane = React.memo(forwardRef<LogViewerHandle, LogViewerPaneProps>(({
    workerReady, totalMatches, onScrollRequest, placeholderText, hotkeyScope = 'none', onSyncScroll, isRawMode = false, highlights, activeLineIndex = -1, onLineClick, onLineDoubleClick, onDrop, paneId = 'single', fileName, onReset
}, ref) => {
    const [scrollTop, setScrollTop] = useState<number>(0);
    const [viewportHeight, setViewportHeight] = useState<number>(0);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const [cachedLines, setCachedLines] = useState<Map<number, { lineNum: number, content: string }>>(new Map());
    const [loadingRange, setLoadingRange] = useState<{ start: number, end: number } | null>(null);
    const [dragActive, setDragActive] = useState(false);

    // Bookmarks Local State for this pane
    const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());

    const toggleBookmark = useCallback((index: number) => {
        setBookmarks(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    }, []);

    useImperativeHandle(ref, () => ({
        scrollBy: (deltaY: number) => {
            if (scrollViewportRef.current) scrollViewportRef.current.scrollTop += deltaY;
        },
        scrollTo: (top: number) => {
            if (scrollViewportRef.current) scrollViewportRef.current.scrollTop = top;
        },
        jumpToNextBookmark: () => {
            const viewportTopIdx = Math.floor((scrollViewportRef.current?.scrollTop || 0) / ROW_HEIGHT);
            const currentIdx = activeLineIndex >= 0 ? activeLineIndex : viewportTopIdx;

            const sorted = Array.from(bookmarks).sort((a: number, b: number) => a - b);
            const next = sorted.find((b: number) => b > currentIdx);

            const centerOffset = Math.max(0, (viewportHeight / 2) - (ROW_HEIGHT / 2));
            let target = -1;

            if (next !== undefined) {
                target = next;
            } else if (sorted.length > 0) {
                target = sorted[0]; // Wrap
            }

            if (target !== -1 && scrollViewportRef.current) {
                scrollViewportRef.current.scrollTop = Math.max(0, (target * ROW_HEIGHT) - centerOffset);
                if (onLineClick) onLineClick(target);
            }
        },
        jumpToPrevBookmark: () => {
            const viewportTopIdx = Math.floor((scrollViewportRef.current?.scrollTop || 0) / ROW_HEIGHT);
            const currentIdx = activeLineIndex >= 0 ? activeLineIndex : viewportTopIdx;
            // Since we want strict less than, finding Prev from current bookmark (at activeLineIndex) works correctly.
            // But if we are scrolled slightly up/down, activeLineIndex clamps it.

            const sorted = Array.from(bookmarks).sort((a: number, b: number) => b - a); // Descending
            const prev = sorted.find((b: number) => b < currentIdx);

            const centerOffset = Math.max(0, (viewportHeight / 2) - (ROW_HEIGHT / 2));
            let target = -1;

            if (prev !== undefined) {
                target = prev;
            } else if (sorted.length > 0) {
                target = sorted[0]; // Wrap (last item since sorted descending)
            }

            if (target !== -1 && scrollViewportRef.current) {
                scrollViewportRef.current.scrollTop = Math.max(0, (target * ROW_HEIGHT) - centerOffset);
                if (onLineClick) onLineClick(target);
            }
        }
    }));

    // Virtualization Logic
    const { virtualItems, totalHeight, offsetY, startIndex, endIndex } = useMemo(() => {
        const totalHeight = totalMatches * ROW_HEIGHT;
        const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
        const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
        const endIndex = Math.min(totalMatches - 1, startIndex + visibleCount + (OVERSCAN * 2));

        const virtualItems = [];
        for (let i = startIndex; i <= endIndex; i++) {
            virtualItems.push(i);
        }
        const offsetY = startIndex * ROW_HEIGHT;

        return { virtualItems, totalHeight, offsetY, startIndex, endIndex };
    }, [totalMatches, scrollTop, viewportHeight]);

    // Clear cache when Total Matches changes (filtering applied) or Worker restarts
    useEffect(() => {
        setCachedLines(new Map());
    }, [totalMatches, workerReady, fileName]);

    // Async Data Fetching
    useEffect(() => {
        if (!workerReady || totalMatches === 0) return;

        const neededIndices = [];
        for (let i = startIndex; i <= endIndex; i++) {
            if (!cachedLines.has(i)) neededIndices.push(i);
        }

        if (neededIndices.length > 0) {
            const reqStart = neededIndices[0];
            const reqEnd = neededIndices[neededIndices.length - 1];
            const reqCount = reqEnd - reqStart + 1;

            setLoadingRange({ start: reqStart, end: reqEnd });

            onScrollRequest(reqStart, reqCount).then((lines) => {
                setCachedLines(prev => {
                    const next = new Map(prev);
                    lines.forEach((line, idx) => {
                        next.set(reqStart + idx, line);
                    });
                    if (next.size > 5000) {
                        for (const key of next.keys()) {
                            if (key < startIndex - 100 || key > endIndex + 100) next.delete(key);
                        }
                    }
                    return next;
                });
                setLoadingRange(null);
            });
        }
    }, [startIndex, endIndex, totalMatches, workerReady, onScrollRequest]);

    // Resize Observer
    useEffect(() => {
        if (!scrollViewportRef.current) return;

        // Immediately set initial height
        setViewportHeight(scrollViewportRef.current.clientHeight);

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setViewportHeight(entry.contentRect.height);
        });
        observer.observe(scrollViewportRef.current);
        return () => observer.disconnect();
    }, []);

    // Recalculate viewport height when file loads
    useEffect(() => {
        if (!scrollViewportRef.current || !workerReady) return;
        // Force recalculation after a short delay to ensure DOM has updated
        const timer = setTimeout(() => {
            if (scrollViewportRef.current) {
                setViewportHeight(scrollViewportRef.current.clientHeight);
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [workerReady, totalMatches]);


    const renderHighlightedText = (text: string) => {
        if (!highlights || highlights.length === 0) return text;
        const validHighlights = highlights.filter(h => h.keyword.trim() !== '');
        if (validHighlights.length === 0) return text;

        const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(${validHighlights.map(h => escapeRegExp(h.keyword)).join('|')})`, 'g');
        const parts = text.split(pattern);

        return parts.map((part, i) => {
            const highlight = validHighlights.find(h => h.keyword === part);
            if (highlight) {
                const isHex = highlight.color.startsWith('#');
                const style = isHex ? { backgroundColor: highlight.color } : undefined;
                const className = `text-slate-900 rounded-sm px-0.5 font-bold ${!isHex ? highlight.color : ''}`;
                return <span key={i} className={className} style={style}>{part}</span>;
            }
            return part;
        });
    };

    // Drag handlers
    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
    }, []);

    const handleDropEvent = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0] && onDrop) {
            onDrop(e.dataTransfer.files[0]);
        }
    }, [onDrop]);

    // Wheel event handler to prevent horizontal scroll on Shift+wheel
    useEffect(() => {
        const viewport = scrollViewportRef.current;
        if (!viewport) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.shiftKey) {
                e.preventDefault();
                // Only vertical scroll when shift is held
                viewport.scrollTop += e.deltaY;
                if (onSyncScroll) {
                    onSyncScroll(e.deltaY);
                }
            }
        };

        viewport.addEventListener('wheel', handleWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', handleWheel);
    }, [onSyncScroll]);

    // Focus & Keyboard Handler
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.code === 'Space') {
            if (activeLineIndex !== undefined && activeLineIndex >= 0) {
                e.preventDefault();
                toggleBookmark(activeLineIndex);
            }
        }
        // Arrow key navigation
        if (e.code === 'ArrowDown' && onLineClick) {
            e.preventDefault();
            const nextIndex = Math.min(totalMatches - 1, activeLineIndex + 1);
            onLineClick(nextIndex);
            // Scroll to keep visible
            if (scrollViewportRef.current) {
                const lineTop = nextIndex * ROW_HEIGHT;
                const lineBottom = lineTop + ROW_HEIGHT;
                const viewportTop = scrollViewportRef.current.scrollTop;
                const viewportBottom = viewportTop + viewportHeight;
                if (lineBottom > viewportBottom) {
                    scrollViewportRef.current.scrollTop = lineBottom - viewportHeight;
                }
            }
        }
        if (e.code === 'ArrowUp' && onLineClick) {
            e.preventDefault();
            const prevIndex = Math.max(0, activeLineIndex - 1);
            onLineClick(prevIndex);
            // Scroll to keep visible
            if (scrollViewportRef.current) {
                const lineTop = prevIndex * ROW_HEIGHT;
                const viewportTop = scrollViewportRef.current.scrollTop;
                if (lineTop < viewportTop) {
                    scrollViewportRef.current.scrollTop = lineTop;
                }
            }
        }
    };


    return (
        <div
            tabIndex={0}
            className={`flex-1 flex flex-col relative overflow-hidden transition-colors border-r border-slate-900 last:border-r-0 outline-none h-full ${dragActive ? 'bg-indigo-900/10 ring-4 ring-inset ring-indigo-500/50' : 'bg-slate-950'} ${isRawMode ? 'bg-slate-900' : ''}`}
            onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDropEvent}
            onKeyDown={handleKeyDown}
        >
            {/* Toolbar */}
            <div className={`h-12 border-b border-slate-800 flex items-center justify-between shrink-0 z-10 group/toolbar ${!isRawMode && (paneId === 'left' || paneId === 'single') ? 'pl-10 pr-3' : 'px-3'} ${isRawMode ? 'bg-indigo-950/30' : 'bg-slate-950/50'}`}>
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`p-1.5 rounded-md ${workerReady ? (isRawMode ? 'bg-orange-500/10 text-orange-400' : 'bg-indigo-500/10 text-indigo-400') : 'bg-slate-800 text-slate-600'}`}>
                        {isRawMode ? <Split size={14} /> : <Zap size={14} />}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-bold text-xs text-slate-300 truncate max-w-[300px]">
                            {workerReady ? (isRawMode ? 'Raw View' : (placeholderText.includes('Drag') ? placeholderText : placeholderText.replace('Processing...', '').replace('Drop a log file to start', 'No file loaded'))) : 'Empty'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1 opacity-50 group-hover/toolbar:opacity-100 transition-opacity">
                    {fileName && onReset && !isRawMode && (
                        <button onClick={onReset} className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400 transition-colors" title="Reset File">
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 relative h-full">
                {workerReady ? (
                    <div
                        ref={scrollViewportRef}
                        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                        className="absolute inset-0 overflow-y-auto overflow-x-auto custom-scrollbar"
                    >
                        <div style={{ height: totalHeight, position: 'relative' }}>
                            {virtualItems.map((virtualIndex) => {
                                const top = virtualIndex * ROW_HEIGHT;
                                const data = cachedLines.get(virtualIndex);
                                const isLoading = !data;
                                const isActive = virtualIndex === activeLineIndex;

                                return (
                                    <div
                                        key={virtualIndex}
                                        style={{ top, height: ROW_HEIGHT }}
                                        className={`absolute left-0 min-w-full w-max flex items-center px-4 font-mono text-xs text-slate-400 border-b whitespace-pre transition-colors duration-100 cursor-pointer ${isActive ? 'bg-indigo-500/30 border-indigo-500/50 z-10' :
                                            'border-slate-900/30 hover:bg-slate-800/30'
                                            }`}
                                        onClick={() => onLineClick && onLineClick(virtualIndex)}
                                        onDoubleClick={() => onLineDoubleClick && onLineDoubleClick(virtualIndex)}
                                    >
                                        <div className="w-4 flex items-center justify-center shrink-0 mr-1">
                                            {bookmarks.has(virtualIndex) && <Bookmark size={10} className="text-indigo-400 fill-indigo-400" />}
                                        </div>
                                        {!isRawMode && (
                                            <span className="w-10 text-indigo-400/70 select-none text-right pr-2 shrink-0 border-r border-slate-800 mr-2 font-bold">
                                                #{virtualIndex + 1}
                                            </span>
                                        )}
                                        <span className="w-12 text-slate-500 select-none text-right pr-4 shrink-0 font-medium">
                                            {isLoading ? '...' : data?.lineNum}
                                        </span>
                                        <span className={isLoading ? 'text-slate-700 italic' : ''}>
                                            {isLoading ? 'Loading...' : (isRawMode ? data?.content : renderHighlightedText(data?.content || ''))}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 pointer-events-none select-none">
                        <div className={`p-6 rounded-full border-2 border-dashed border-slate-800 mb-4 transition-transform duration-300 ${dragActive ? 'scale-110 border-indigo-500 bg-indigo-500/10' : ''}`}><Upload size={32} className={dragActive ? 'text-indigo-400' : 'text-slate-700'} /></div>
                        <p className="text-sm font-medium text-slate-500">{placeholderText}</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            {workerReady && (
                <div className="bg-slate-950 border-t border-slate-900 px-3 py-1 text-[10px] text-slate-600 font-mono flex justify-between">
                    <div className="flex gap-4"><span>Matches: {totalMatches}</span></div>
                    <div className="flex gap-2 text-indigo-400">{loadingRange ? 'Fetching...' : 'Ready'}</div>
                </div>
            )}
        </div>
    );
}));


// --- Main Component ---

const LogExtractor: React.FC<LogExtractorProps> = ({ rules, onUpdateRules, onExportSettings, onImportSettings }) => {
    const [selectedRuleId, setSelectedRuleId] = useState<string>(() => {
        const saved = localStorage.getItem('lastSelectedRuleId');
        if (saved && rules.find(r => r.id === saved)) return saved;
        return rules.length > 0 ? rules[0].id : '';
    });

    // Save selected rule ID
    useEffect(() => {
        if (selectedRuleId) {
            localStorage.setItem('lastSelectedRuleId', selectedRuleId);
        }
    }, [selectedRuleId]);
    const [isDualView, setIsDualView] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(true);

    // Left Pane Worker State
    const leftWorkerRef = useRef<Worker | null>(null);
    const [leftWorkerReady, setLeftWorkerReady] = useState(false);
    const [leftIndexingProgress, setLeftIndexingProgress] = useState(0);
    const [leftTotalLines, setLeftTotalLines] = useState(0);
    const [leftFilteredCount, setLeftFilteredCount] = useState(0);
    const [leftFileName, setLeftFileName] = useState<string>('');
    const leftPendingRequests = useRef<Map<string, (data: any) => void>>(new Map());

    // Right Pane Worker State (for split mode)
    const rightWorkerRef = useRef<Worker | null>(null);
    const [rightWorkerReady, setRightWorkerReady] = useState(false);
    const [rightIndexingProgress, setRightIndexingProgress] = useState(0);
    const [rightTotalLines, setRightTotalLines] = useState(0);
    const [rightFilteredCount, setRightFilteredCount] = useState(0);
    const [rightFileName, setRightFileName] = useState<string>('');
    const rightPendingRequests = useRef<Map<string, (data: any) => void>>(new Map());

    // Filtered / Selection State - separate for each pane in split mode
    const [selectedLineIndexLeft, setSelectedLineIndexLeft] = useState<number>(-1);
    const [selectedLineIndexRight, setSelectedLineIndexRight] = useState<number>(-1);

    // Raw Context State
    const [rawContextOpen, setRawContextOpen] = useState(false);
    const [rawContextTargetLine, setRawContextTargetLine] = useState<{ lineNum: number, content: string } | null>(null);
    const [rawContextSourcePane, setRawContextSourcePane] = useState<'left' | 'right'>('left');

    // Config Panel State
    const [configPanelWidth, setConfigPanelWidth] = useState(() => {
        const saved = localStorage.getItem('configPanelWidth');
        return saved ? parseFloat(saved) : 320;
    });

    // Initialize raw context height from localStorage or default to 50%
    const [rawContextHeight, setRawContextHeight] = useState(() => {
        const saved = localStorage.getItem('rawContextHeight');
        return saved ? parseFloat(saved) : 50;
    });

    // File Input Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const logFileInputRef = useRef<HTMLInputElement>(null);

    // Viewer Pane Refs for bookmark navigation
    const leftViewerRef = useRef<LogViewerHandle>(null);
    const rightViewerRef = useRef<LogViewerHandle>(null);
    const rawViewerRef = useRef<LogViewerHandle>(null);

    // Initialize Left Worker
    useEffect(() => {
        leftWorkerRef.current = new Worker(new URL('../workers/LogProcessor.worker.ts', import.meta.url), { type: 'module' });

        leftWorkerRef.current.onmessage = (e: MessageEvent<LogWorkerResponse>) => {
            const { type, payload, requestId } = e.data;

            if (requestId && leftPendingRequests.current.has(requestId)) {
                const resolve = leftPendingRequests.current.get(requestId);
                if (type === 'LINES_DATA') {
                    resolve && resolve(payload.lines);
                }
                leftPendingRequests.current.delete(requestId);
                return;
            }

            switch (type) {
                case 'STATUS_UPDATE':
                    if (payload.status === 'indexing') setLeftIndexingProgress(payload.progress);
                    if (payload.status === 'ready') setLeftWorkerReady(true);
                    break;
                case 'INDEX_COMPLETE':
                    setLeftTotalLines(payload.totalLines);
                    setLeftIndexingProgress(100);
                    break;
                case 'FILTER_COMPLETE':
                    setLeftFilteredCount(payload.matchCount);
                    setLeftWorkerReady(true);
                    break;
            }
        };

        return () => {
            leftWorkerRef.current?.terminate();
        };
    }, []);

    // Initialize Right Worker (persists across mode switches)
    useEffect(() => {
        rightWorkerRef.current = new Worker(new URL('../workers/LogProcessor.worker.ts', import.meta.url), { type: 'module' });

        rightWorkerRef.current.onmessage = (e: MessageEvent<LogWorkerResponse>) => {
            const { type, payload, requestId } = e.data;

            if (requestId && rightPendingRequests.current.has(requestId)) {
                const resolve = rightPendingRequests.current.get(requestId);
                if (type === 'LINES_DATA') {
                    resolve && resolve(payload.lines);
                }
                rightPendingRequests.current.delete(requestId);
                return;
            }

            switch (type) {
                case 'STATUS_UPDATE':
                    if (payload.status === 'indexing') setRightIndexingProgress(payload.progress);
                    if (payload.status === 'ready') setRightWorkerReady(true);
                    break;
                case 'INDEX_COMPLETE':
                    setRightTotalLines(payload.totalLines);
                    setRightIndexingProgress(100);
                    break;
                case 'FILTER_COMPLETE':
                    setRightFilteredCount(payload.matchCount);
                    setRightWorkerReady(true);
                    setSelectedLineIndexRight(-1);
                    break;
            }
        };

        return () => {
            rightWorkerRef.current?.terminate();
        };
    }, []); // Initialize once, not dependent on isDualView

    // Global Keyboard Event Listener for Bookmark Navigation
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // F3: Previous bookmark
            if (e.key === 'F3') {
                e.preventDefault();
                if (e.shiftKey && isDualView) {
                    rightViewerRef.current?.jumpToPrevBookmark();
                } else {
                    // Support Shift+F3 in single view or just F3
                    leftViewerRef.current?.jumpToPrevBookmark();
                }
            }
            // F4: Next bookmark
            if (e.key === 'F4') {
                e.preventDefault();
                if (e.shiftKey && isDualView) {
                    rightViewerRef.current?.jumpToNextBookmark();
                } else {
                    // Support Shift+F4 in single view or just F4
                    leftViewerRef.current?.jumpToNextBookmark();
                }
            }
            // ESC: Close raw context view (works globally)
            if (e.key === 'Escape') {
                if (rawContextOpen) {
                    e.preventDefault();
                    setRawContextOpen(false);
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [isDualView, rawContextOpen]);

    const currentConfig = rules.find(r => r.id === selectedRuleId);

    // Auto-Apply Filter when Rule Changes (Left Pane)
    useEffect(() => {
        if (leftWorkerRef.current && currentConfig && leftTotalLines > 0) {
            const rawGroups = currentConfig.includeGroups;
            const refinedGroups: string[][] = [];

            const groupsByRoot = new Map<string, string[][]>();
            rawGroups.forEach(group => {
                const root = (group[0] || '').trim();
                if (!root) return;
                if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
                groupsByRoot.get(root)!.push(group);
            });

            groupsByRoot.forEach((rootGroups) => {
                const hasBranches = rootGroups.some(g => g.length > 1 && g.slice(1).some(t => t.trim() !== ''));
                if (hasBranches) {
                    const branchOnly = rootGroups.filter(g => g.length > 1 && g.slice(1).some(t => t.trim() !== ''));
                    refinedGroups.push(...branchOnly);
                } else {
                    refinedGroups.push(...rootGroups);
                }
            });

            setLeftWorkerReady(false);
            leftWorkerRef.current.postMessage({
                type: 'FILTER_LOGS',
                payload: { ...currentConfig, includeGroups: refinedGroups }
            });
            setSelectedLineIndexLeft(-1);
        }
    }, [currentConfig, leftTotalLines]);

    // Auto-Apply Filter (Right Pane in Split Mode)
    useEffect(() => {
        if (isDualView && rightWorkerRef.current && currentConfig && rightTotalLines > 0) {
            const rawGroups = currentConfig.includeGroups;
            const refinedGroups: string[][] = [];

            const groupsByRoot = new Map<string, string[][]>();
            rawGroups.forEach(group => {
                const root = (group[0] || '').trim();
                if (!root) return;
                if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
                groupsByRoot.get(root)!.push(group);
            });

            groupsByRoot.forEach((rootGroups) => {
                const hasBranches = rootGroups.some(g => g.length > 1 && g.slice(1).some(t => t.trim() !== ''));
                if (hasBranches) {
                    const branchOnly = rootGroups.filter(g => g.length > 1 && g.slice(1).some(t => t.trim() !== ''));
                    refinedGroups.push(...branchOnly);
                } else {
                    refinedGroups.push(...rootGroups);
                }
            });

            setRightWorkerReady(false);
            rightWorkerRef.current.postMessage({
                type: 'FILTER_LOGS',
                payload: { ...currentConfig, includeGroups: refinedGroups }
            });
        }
    }, [currentConfig, rightTotalLines, isDualView]);


    // Handlers for Left Pane
    const handleLeftFileChange = useCallback((file: File) => {
        if (!leftWorkerRef.current) return;
        setLeftFileName(file.name);
        setLeftWorkerReady(false);
        setLeftIndexingProgress(0);
        setLeftTotalLines(0);
        setLeftFilteredCount(0);
        setSelectedLineIndexLeft(-1);
        leftWorkerRef.current.postMessage({ type: 'INIT_FILE', payload: file });
    }, []);

    const requestLeftLines = useCallback((startIndex: number, count: number) => {
        return new Promise<{ lineNum: number; content: string }[]>((resolve) => {
            if (!leftWorkerRef.current) return resolve([]);
            const reqId = crypto.randomUUID();
            leftPendingRequests.current.set(reqId, resolve);
            leftWorkerRef.current.postMessage({
                type: 'GET_LINES',
                payload: { startLine: startIndex, count },
                requestId: reqId
            });
        });
    }, []);

    const requestLeftRawLines = useCallback((startLine: number, count: number) => {
        return new Promise<{ lineNum: number; content: string }[]>((resolve) => {
            if (!leftWorkerRef.current) return resolve([]);
            const reqId = crypto.randomUUID();
            leftPendingRequests.current.set(reqId, resolve);
            leftWorkerRef.current.postMessage({
                type: 'GET_RAW_LINES',
                payload: { startLine, count },
                requestId: reqId
            });
        });
    }, []);

    // Handlers for Right Pane (Split Mode)
    const handleRightFileChange = useCallback((file: File) => {
        if (!rightWorkerRef.current) return;
        setRightFileName(file.name);
        setRightWorkerReady(false);
        setRightIndexingProgress(0);
        setRightTotalLines(0);
        setRightFilteredCount(0);
        rightWorkerRef.current.postMessage({ type: 'INIT_FILE', payload: file });
    }, []);

    const requestRightLines = useCallback((startIndex: number, count: number) => {
        return new Promise<{ lineNum: number; content: string }[]>((resolve) => {
            if (!rightWorkerRef.current) return resolve([]);
            const reqId = crypto.randomUUID();
            rightPendingRequests.current.set(reqId, resolve);
            rightWorkerRef.current.postMessage({
                type: 'GET_LINES',
                payload: { startLine: startIndex, count },
                requestId: reqId
            });
        });
    }, []);

    const requestRightRawLines = useCallback((startLine: number, count: number) => {
        return new Promise<{ lineNum: number; content: string }[]>((resolve) => {
            if (!rightWorkerRef.current) return resolve([]);
            const reqId = crypto.randomUUID();
            rightPendingRequests.current.set(reqId, resolve);
            rightWorkerRef.current.postMessage({
                type: 'GET_RAW_LINES',
                payload: { startLine, count },
                requestId: reqId
            });
        });
    }, []);

    const handleLeftReset = useCallback(() => {
        setLeftFileName('');
        setLeftWorkerReady(false);
        setLeftTotalLines(0);
        setLeftFilteredCount(0);
        setSelectedLineIndexLeft(-1);
    }, []);

    const handleRightReset = useCallback(() => {
        setRightFileName('');
        setRightWorkerReady(false);
        setRightTotalLines(0);
        setRightFilteredCount(0);
        setSelectedLineIndexRight(-1);
    }, []);

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

    const updateCurrentRule = (updates: Partial<LogRule>) => {
        const updatedRules = rules.map(r => r.id === selectedRuleId ? { ...r, ...updates } : r);
        onUpdateRules(updatedRules);
    };

    const handleCreateRule = () => {
        const newId = crypto.randomUUID();
        const newRule: LogRule = {
            id: newId,
            name: 'New Analysis',
            includeGroups: [['']],
            excludes: [],
            highlights: [],
        };
        onUpdateRules([...rules, newRule]);
        setSelectedRuleId(newId);
        if (!isPanelOpen) setIsPanelOpen(true);
    };

    const handleDeleteRule = () => {
        const updated = rules.filter(r => r.id !== selectedRuleId);
        onUpdateRules(updated);
        setSelectedRuleId(updated.length > 0 ? updated[0].id : '');
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                onImportSettings(json);
                alert('Settings imported!');
            } catch (error) { alert('Failed to parse settings file.'); }
        };
        reader.readAsText(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleLogFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) handleLeftFileChange(e.target.files[0]);
    };

    const handleToggleRoot = (root: string, enabled: boolean) => {
        if (!currentConfig) return;
        const newIncludes = [...currentConfig.includeGroups];
        const newDisabled = [...(currentConfig.disabledGroups || [])];

        const allGroups = [...newIncludes.map(g => ({ g, active: true })), ...newDisabled.map(g => ({ g, active: false }))];
        const targetGroups = allGroups.filter(item => (item.g[0] || '').trim() === root);

        targetGroups.forEach(item => {
            // Remove from source
            if (item.active) {
                const idx = newIncludes.indexOf(item.g);
                if (idx > -1) newIncludes.splice(idx, 1);
            } else {
                const idx = newDisabled.indexOf(item.g);
                if (idx > -1) newDisabled.splice(idx, 1);
            }

            // Add to destination
            if (enabled) {
                newIncludes.push(item.g);
            } else {
                newDisabled.push(item.g);
            }
        });

        updateCurrentRule({ includeGroups: newIncludes, disabledGroups: newDisabled });
    };

    const handleToggleBranch = (group: string[], enabled: boolean, isActive: boolean) => {
        if (!currentConfig) return;
        const newIncludes = [...currentConfig.includeGroups];
        const newDisabled = [...(currentConfig.disabledGroups || [])];

        // Remove from source
        if (isActive) {
            const idx = newIncludes.findIndex(g => g === group); // Reference match should work if not mutated
            if (idx > -1) newIncludes.splice(idx, 1);
        } else {
            const idx = newDisabled.findIndex(g => g === group);
            if (idx > -1) newDisabled.splice(idx, 1);
        }

        // Add to destination
        if (enabled) {
            newIncludes.push(group);
        } else {
            newDisabled.push(group);
        }

        updateCurrentRule({ includeGroups: newIncludes, disabledGroups: newDisabled });
    };

    const groupedRoots = useMemo(() => {
        if (!currentConfig) return [];
        const groups = new Map<string, { group: string[], active: boolean, originalIdx: number }[]>();

        currentConfig.includeGroups.forEach((group, idx) => {
            const root = (group[0] || '').trim();
            if (!root) return;
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root)!.push({ group, active: true, originalIdx: idx });
        });

        if (currentConfig.disabledGroups) {
            currentConfig.disabledGroups.forEach((group, idx) => {
                const root = (group[0] || '').trim();
                if (!root) return;
                if (!groups.has(root)) groups.set(root, []);
                groups.get(root)!.push({ group, active: false, originalIdx: idx });
            });
        }

        return Array.from(groups.entries()).map(([root, items]) => {
            // Root is enabled if ANY of its items are active? Or checking if ALL are active?
            // Let's say Root is enabled if AT LEAST ONE is active.
            // Actually, for the toggle UI, if some are on and some off, it should probably show indeterminate or checked.
            // For simplicity: Checked if at least one is active. Unchecked if none.
            const isRootEnabled = items.some(i => i.active);
            return { root, isRootEnabled, items };
        });
    }, [currentConfig]);

    const [editingTag, setEditingTag] = useState<{ groupIdx: number, termIdx: number, value: string, isActive: boolean } | null>(null);
    const isHexColor = (color: string) => color.startsWith('#');
    const [newHighlightColor, setNewHighlightColor] = useState<string>('');
    const highlightInputRef = useRef<HTMLInputElement>(null);
    const [newHighlightWord, setNewHighlightWord] = useState('');
    const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('collapsedRoots');
        if (saved) {
            try {
                return new Set(JSON.parse(saved));
            } catch (e) {
                return new Set();
            }
        }
        return new Set();
    });

    // Persist collapsed state
    useEffect(() => {
        localStorage.setItem('collapsedRoots', JSON.stringify(Array.from(collapsedRoots)));
    }, [collapsedRoots]);

    const handleLineDoubleClickAction = async (index: number, paneId: 'left' | 'right' = 'left') => {
        const requestLines = paneId === 'left' ? requestLeftLines : requestRightLines;
        const lines = await requestLines(index, 1);
        if (lines && lines.length > 0) {
            setRawContextTargetLine(lines[0]);
            setRawContextSourcePane(paneId);
            setRawContextOpen(true);
            // Don't reset height - use saved height from localStorage
            // Auto-scroll to the line in raw context view after a short delay
            setTimeout(() => {
                if (rawViewerRef.current && lines[0].lineNum > 0) {
                    const targetIndex = lines[0].lineNum - 1;
                    const scrollTop = targetIndex * 24; // ROW_HEIGHT = 24
                    rawViewerRef.current.scrollTo(scrollTop);
                }
            }, 100);
        }
    };

    // Raw context resize handlers
    const handleRawContextResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = rawContextHeight;
        const windowHeight = window.innerHeight - 64; // Subtract top bar height

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const deltaPercent = (deltaY / windowHeight) * 100;
            const newHeight = Math.min(Math.max(startHeight + deltaPercent, 20), 80); // Limit between 20% and 80%
            setRawContextHeight(newHeight);
        };

        const handleMouseUp = () => {
            // Save to localStorage when user finishes resizing
            localStorage.setItem('rawContextHeight', rawContextHeight.toString());
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // Config panel resize handlers
    const handleConfigResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = configPanelWidth;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const newWidth = Math.max(312, Math.min(800, startWidth + deltaX)); // Min 312px (prevents palette wrap), Max 800px
            setConfigPanelWidth(newWidth);
        };

        const handleMouseUp = () => {
            localStorage.setItem('configPanelWidth', configPanelWidth.toString());
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };


    return (
        <div className="flex h-full flex-col font-sans overflow-hidden">
            {/* Top Bar */}
            <div className="bg-slate-900/80 backdrop-blur-sm border-b border-indigo-900/30 p-4 flex items-center justify-between shrink-0 h-16 z-20">
                <div className="flex items-center gap-6">
                    <div className="flex items-center space-x-4">
                        <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20"><Sparkles size={18} className="text-indigo-400" /></div>
                        <select className="border-none bg-transparent font-bold text-slate-200 text-lg focus:outline-none cursor-pointer hover:text-indigo-400 transition-colors [&>option]:bg-slate-900" value={selectedRuleId} onChange={(e) => setSelectedRuleId(e.target.value)}>
                            {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </div>
                    <div className="h-6 w-px bg-slate-700"></div>
                    <div className="flex items-center space-x-2">
                        <button onClick={handleCreateRule} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-500 rounded-full flex items-center text-sm font-medium shadow-lg shadow-indigo-900/50 transition-all hover:scale-105" title="New Rule"><Plus size={16} className="mr-1" /> Create</button>
                        {selectedRuleId && (
                            <>
                                <button onClick={handleDeleteRule} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors"><Trash2 size={18} /></button>
                                <div className="w-px h-4 bg-slate-700 mx-1"></div>
                                <button onClick={onExportSettings} className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-colors"><Save size={18} /></button>
                                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-colors"><Upload size={18} /></button>
                            </>
                        )}
                    </div>
                    {/* File Loader Status (Moved here for visibility) */}
                    <button onClick={() => logFileInputRef.current?.click()} className="ml-4 flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-700 transition-colors">
                        <FileDown size={14} className="text-slate-400" />
                        <span className="text-sm text-slate-300 font-medium truncate max-w-[200px]">{leftFileName ? leftFileName : 'Open Log File...'}</span>
                        {leftIndexingProgress > 0 && leftIndexingProgress < 100 && <span className="text-xs text-indigo-400">({Math.round(leftIndexingProgress)}%)</span>}
                    </button>
                </div>
                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button onClick={() => setIsDualView(false)} className={`p-2 rounded flex items-center gap-2 text-xs font-bold transition-all ${!isDualView ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}><Maximize size={14} /> Single</button>
                    <button onClick={() => setIsDualView(true)} className={`p-2 rounded flex items-center gap-2 text-xs font-bold transition-all ${isDualView ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}><Columns size={14} /> Split</button>
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImportFile} />
                <input type="file" ref={logFileInputRef} className="hidden" onChange={handleLogFileSelect} />
            </div>

            {/* Raw Context View - Resizable Overlay */}
            {rawContextOpen && rawContextTargetLine && (
                <div className="absolute left-0 right-0 top-16 bottom-0 z-40 flex flex-col pointer-events-none">
                    <div className="flex flex-col bg-slate-950 pointer-events-auto border-b-2 border-indigo-500 shadow-2xl" style={{ height: `${rawContextHeight}%` }}>
                        <div className="bg-indigo-950/80 px-4 py-1 flex justify-between items-center border-b border-indigo-500/30 backdrop-blur">
                            <span className="text-xs font-bold text-indigo-300">Raw View ({rawContextSourcePane === 'left' ? leftFileName : rightFileName}) - Line {rawContextTargetLine.lineNum}</span>
                            <button onClick={() => setRawContextOpen(false)} className="text-indigo-400 hover:text-white"><X size={14} /></button>
                        </div>
                        <LogViewerPane
                            ref={rawViewerRef}
                            workerReady={true}
                            totalMatches={rawContextSourcePane === 'left' ? leftTotalLines : rightTotalLines}
                            onScrollRequest={rawContextSourcePane === 'left' ? requestLeftRawLines : requestRightRawLines}
                            placeholderText=""
                            isRawMode={true}
                            activeLineIndex={rawContextTargetLine.lineNum - 1}
                        />
                        {/* Resize Handle */}
                        <div
                            className="h-1 bg-indigo-500/50 hover:bg-indigo-400 cursor-ns-resize flex items-center justify-center group"
                            onMouseDown={handleRawContextResizeStart}
                        >
                            <div className="w-12 h-1 bg-indigo-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 flex overflow-hidden h-full">
                {/* Configuration Panel */}
                {currentConfig ? (
                    <div
                        className={`${isPanelOpen ? '' : 'w-12'} bg-gradient-to-br from-slate-900 to-slate-950 border-r border-slate-800 flex flex-col h-full shadow-2xl z-20 custom-scrollbar relative shrink-0`}
                        style={{ width: isPanelOpen ? configPanelWidth : undefined }}
                    >
                        {/* Resize Handle */}
                        {isPanelOpen && (
                            <div
                                className="absolute top-0 bottom-0 -right-1 w-2 cursor-col-resize z-50 hover:bg-indigo-500/20 transition-colors"
                                onMouseDown={handleConfigResizeStart}
                            />
                        )}

                        <div className="absolute top-4 right-0 z-30 translate-x-1/2">
                            <button onClick={() => setIsPanelOpen(!isPanelOpen)} className="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-400 hover:text-white rounded-full border border-slate-700 shadow-md hover:scale-110 transition-all">{isPanelOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>
                        </div>
                        {isPanelOpen ? (
                            <div className="p-6 overflow-y-auto h-full">
                                <div className="mb-6">
                                    <label className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Mission Name</label>
                                    <input className="w-full bg-slate-800/50 rounded-xl px-2 py-1 text-2xl font-black text-slate-200 focus:outline-none border-b-2 border-transparent focus:border-indigo-500 placeholder-slate-600 transition-all" value={currentConfig.name} onChange={(e) => updateCurrentRule({ name: e.target.value })} placeholder="Untitled Rule" />
                                </div>
                                <div className="mb-8">
                                    <div className="flex items-center justify-between mb-4"><label className="text-sm font-bold text-slate-300 flex items-center gap-2"><Zap size={16} className="text-yellow-500 fill-yellow-500" /> Happy Combos</label></div>
                                    <div className="space-y-4">
                                        {groupedRoots.map(({ root, isRootEnabled, items }, rootIdx) => (
                                            <div key={rootIdx} className={`bg-slate-800/40 rounded-2xl p-4 border flex flex-col gap-2 relative group transition-colors ${isRootEnabled ? 'border-slate-700/50' : 'border-slate-800 opacity-60'}`}>
                                                <button onClick={() => {
                                                    // Delete all items in this root
                                                    const newIncludes = currentConfig.includeGroups.filter(g => (g[0] || '').trim() !== root);
                                                    const newDisabled = (currentConfig.disabledGroups || []).filter(g => (g[0] || '').trim() !== root);
                                                    updateCurrentRule({ includeGroups: newIncludes, disabledGroups: newDisabled });
                                                }} className="absolute top-2 right-2 bg-slate-700 text-slate-400 hover:text-red-400 hover:bg-slate-600 rounded-full p-1 border border-slate-600 opacity-0 group-hover:opacity-100 transition-all z-20" title="Delete Group"> <X size={14} /> </button>

                                                <div className="flex items-center gap-2 relative z-10 self-start">
                                                    <input type="checkbox" checked={isRootEnabled} onChange={(e) => handleToggleRoot(root, e.target.checked)} className="accent-indigo-500 w-4 h-4 cursor-pointer" />
                                                    <button
                                                        onClick={() => {
                                                            setCollapsedRoots(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(root)) next.delete(root);
                                                                else next.add(root);
                                                                return next;
                                                            });
                                                        }}
                                                        className={`p-1 rounded transition-colors ${isRootEnabled ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/30' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-700'} ${collapsedRoots.has(root) ? 'bg-transparent' : 'bg-indigo-600/20'}`}
                                                    >
                                                        {collapsedRoots.has(root) ? <Folder size={14} /> : <FolderOpen size={14} />}
                                                    </button>

                                                    {editingTag?.groupIdx === -1 && editingTag?.value === root ? (
                                                        <input autoFocus className="bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-lg text-sm font-bold border border-indigo-500/40 min-w-[80px] outline-none" value={newHighlightWord} onChange={(e) => setNewHighlightWord(e.target.value)}
                                                            onBlur={() => {
                                                                if (!newHighlightWord.trim()) { setEditingTag(null); return; }
                                                                // Update ALL groups with this root
                                                                const newIncludes = currentConfig.includeGroups.map(g => (g[0] || '').trim() === root ? [newHighlightWord, ...g.slice(1)] : g);
                                                                const newDisabled = (currentConfig.disabledGroups || []).map(g => (g[0] || '').trim() === root ? [newHighlightWord, ...g.slice(1)] : g);
                                                                updateCurrentRule({ includeGroups: newIncludes, disabledGroups: newDisabled });
                                                                setEditingTag(null);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    // Save and focus First Branch's First Tag
                                                                    const newRootName = newHighlightWord.trim();
                                                                    if (newRootName && newRootName !== root) {
                                                                        const newIncludes = currentConfig.includeGroups.map(g => (g[0] || '').trim() === root ? [newRootName, ...g.slice(1)] : g);
                                                                        const newDisabled = (currentConfig.disabledGroups || []).map(g => (g[0] || '').trim() === root ? [newRootName, ...g.slice(1)] : g);
                                                                        updateCurrentRule({ includeGroups: newIncludes, disabledGroups: newDisabled });
                                                                    }
                                                                    setEditingTag(null);

                                                                    // Navigate to first tag of first branch
                                                                    setTimeout(() => {
                                                                        const firstBranchInput = document.getElementById(`tag-${items[0]?.originalIdx}-1`); // 1st tag 
                                                                        if (firstBranchInput) {
                                                                            (firstBranchInput as HTMLInputElement).focus();
                                                                        } else {
                                                                            // If no 1st tag, try + tag input
                                                                            const plusTagInput = document.getElementById(`add-tag-${items[0]?.originalIdx}`);
                                                                            if (plusTagInput) (plusTagInput as HTMLInputElement).focus();
                                                                        }
                                                                    }, 50);
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        <span
                                                            onClick={(e) => { e.stopPropagation(); setNewHighlightWord(root); setEditingTag({ groupIdx: -1, termIdx: -1, value: root, isActive: true }); }}
                                                            className={`font-bold text-sm cursor-pointer border border-transparent hover:border-indigo-500/50 rounded px-2 py-1 transition-all ${isRootEnabled ? 'text-indigo-200' : 'text-slate-500 line-through'}`}>
                                                            {root || '(Root Tag)'}
                                                        </span>
                                                    )}
                                                </div>

                                                {!collapsedRoots.has(root) && (
                                                    <div className="relative pl-6 ml-2.5 flex flex-col gap-2 mt-1">
                                                        <div className="absolute left-0 top-[-8px] bottom-4 w-px bg-slate-600"></div>
                                                        {items.map((item, itemIdx) => {
                                                            const branchTags = item.group.slice(1);
                                                            return (
                                                                <div key={itemIdx} className="relative flex flex-col gap-0.5">
                                                                    <div className="absolute -left-6 top-[13px] w-6 h-px">
                                                                        <div className="absolute right-0 bottom-0 w-4 h-4 border-l border-b border-slate-600 rounded-bl-xl translate-y-1/2"></div>
                                                                    </div>
                                                                    <div className="flex flex-wrap items-center gap-1 pl-1">
                                                                        {branchTags.map((term, tIdx) => {
                                                                            const isEditing = editingTag?.groupIdx === item.originalIdx && editingTag?.termIdx === tIdx + 1 && editingTag.isActive === item.active;

                                                                            return (
                                                                                <React.Fragment key={tIdx}>
                                                                                    {tIdx > 0 && <div className="h-0.5 w-1 bg-indigo-500/50 rounded-full"></div>}
                                                                                    {isEditing ? (
                                                                                        <input autoFocus className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-xs font-medium border border-indigo-500 w-20 outline-none" value={editingTag.value} onChange={(e) => setEditingTag({ ...editingTag, value: e.target.value })}
                                                                                            onBlur={() => {
                                                                                                const sourceArray = item.active ? currentConfig.includeGroups : (currentConfig.disabledGroups || []);
                                                                                                const newGroups = [...sourceArray];
                                                                                                if (editingTag.value.trim()) newGroups[item.originalIdx] = [...newGroups[item.originalIdx]];
                                                                                                if (editingTag.value.trim()) newGroups[item.originalIdx][tIdx + 1] = editingTag.value.trim();
                                                                                                else newGroups[item.originalIdx] = newGroups[item.originalIdx].filter((_, i) => i !== tIdx + 1);

                                                                                                if (item.active) updateCurrentRule({ includeGroups: newGroups });
                                                                                                else updateCurrentRule({ disabledGroups: newGroups });
                                                                                                setEditingTag(null);
                                                                                            }}
                                                                                            onKeyDown={(e) => {
                                                                                                if (e.key === 'Enter') {
                                                                                                    e.preventDefault();
                                                                                                    if (tIdx === branchTags.length - 1) {
                                                                                                        const nextInputId = `add-tag-${item.active ? 'active' : 'disabled'}-${item.originalIdx}`;
                                                                                                        const nextInput = document.getElementById(nextInputId);
                                                                                                        if (nextInput) (nextInput as HTMLInputElement).focus();
                                                                                                        else e.currentTarget.blur();
                                                                                                    } else {
                                                                                                        setEditingTag({
                                                                                                            groupIdx: item.originalIdx,
                                                                                                            termIdx: tIdx + 2,
                                                                                                            value: branchTags[tIdx + 1],
                                                                                                            isActive: item.active
                                                                                                        });
                                                                                                    }
                                                                                                }
                                                                                                if (e.key === 'Backspace' && !editingTag.value) {
                                                                                                    e.preventDefault();
                                                                                                    const sourceArray = item.active ? currentConfig.includeGroups : (currentConfig.disabledGroups || []);
                                                                                                    const newGroups = [...sourceArray];
                                                                                                    newGroups[item.originalIdx] = newGroups[item.originalIdx].filter((_, i) => i !== tIdx + 1);

                                                                                                    if (item.active) updateCurrentRule({ includeGroups: newGroups });
                                                                                                    else updateCurrentRule({ disabledGroups: newGroups });

                                                                                                    if (tIdx > 0) {
                                                                                                        setEditingTag({
                                                                                                            groupIdx: item.originalIdx,
                                                                                                            termIdx: tIdx,
                                                                                                            value: branchTags[tIdx - 1],
                                                                                                            isActive: item.active
                                                                                                        });
                                                                                                    } else {
                                                                                                        if (itemIdx > 0) {
                                                                                                            const prevItem = items[itemIdx - 1];
                                                                                                            const prevTags = prevItem.group.slice(1);
                                                                                                            if (prevTags.length > 0) {
                                                                                                                setEditingTag({
                                                                                                                    groupIdx: prevItem.originalIdx,
                                                                                                                    termIdx: prevTags.length,
                                                                                                                    value: prevTags[prevTags.length - 1],
                                                                                                                    isActive: prevItem.active
                                                                                                                });
                                                                                                            } else {
                                                                                                                setEditingTag({ groupIdx: -1, termIdx: -1, value: root, isActive: true });
                                                                                                            }
                                                                                                        } else {
                                                                                                            setEditingTag({ groupIdx: -1, termIdx: -1, value: root, isActive: true });
                                                                                                        }
                                                                                                    }
                                                                                                }
                                                                                            }}
                                                                                        />
                                                                                    ) : (
                                                                                        <div onClick={(e) => { e.stopPropagation(); setEditingTag({ groupIdx: item.originalIdx, termIdx: tIdx + 1, value: term, isActive: item.active }); }} className={`flex items-center bg-slate-900 px-2 py-1 rounded text-xs border cursor-pointer transition-colors ${item.active ? 'text-slate-300 border-slate-700 hover:border-indigo-500' : 'text-slate-600 border-slate-800'}`}>
                                                                                            <span className={!item.active ? 'line-through' : ''}>{term}</span>
                                                                                            <button onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                const sourceArray = item.active ? currentConfig.includeGroups : (currentConfig.disabledGroups || []);
                                                                                                const newGroups = [...sourceArray];
                                                                                                newGroups[item.originalIdx] = newGroups[item.originalIdx].filter((_, i) => i !== tIdx + 1);

                                                                                                if (item.active) updateCurrentRule({ includeGroups: newGroups });
                                                                                                else updateCurrentRule({ disabledGroups: newGroups });
                                                                                            }} className="ml-1 text-slate-500 hover:text-red-400"><X size={10} /></button>
                                                                                        </div>
                                                                                    )}
                                                                                </React.Fragment>
                                                                            )
                                                                        })}
                                                                        <input id={`add-tag-${item.active ? 'active' : 'disabled'}-${item.originalIdx}`} className="w-16 bg-transparent text-xs text-slate-500 placeholder-slate-600 focus:text-slate-200 focus:outline-none border-b border-transparent focus:border-indigo-500 transition-all py-1" placeholder="+ tag"
                                                                            onBlur={(e) => { e.target.value = ''; }}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Backspace' && !e.currentTarget.value) {
                                                                                    e.preventDefault();
                                                                                    if (branchTags.length > 0) {
                                                                                        // 1. Edit left tag
                                                                                        const lastIdx = branchTags.length - 1;
                                                                                        setEditingTag({
                                                                                            groupIdx: item.originalIdx,
                                                                                            termIdx: lastIdx + 1, // 1-based index (0 is root)
                                                                                            value: branchTags[lastIdx],
                                                                                            isActive: item.active
                                                                                        });
                                                                                    } else {
                                                                                        // 2. No tags in this branch? Try previous branch
                                                                                        if (itemIdx > 0) {
                                                                                            const prevItem = items[itemIdx - 1];
                                                                                            const prevTags = prevItem.group.slice(1);
                                                                                            if (prevTags.length > 0) {
                                                                                                // Edit last tag of previous branch
                                                                                                setEditingTag({
                                                                                                    groupIdx: prevItem.originalIdx,
                                                                                                    termIdx: prevTags.length,
                                                                                                    value: prevTags[prevTags.length - 1],
                                                                                                    isActive: prevItem.active
                                                                                                });
                                                                                            } else {
                                                                                                // Prev branch empty? Fallback to Root
                                                                                                setEditingTag({ groupIdx: -1, termIdx: -1, value: root, isActive: true });
                                                                                            }
                                                                                        } else {
                                                                                            // 3. No previous branch -> Root
                                                                                            setEditingTag({ groupIdx: -1, termIdx: -1, value: root, isActive: true });
                                                                                        }
                                                                                    }
                                                                                }
                                                                                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                                                    const sourceArray = item.active ? currentConfig.includeGroups : (currentConfig.disabledGroups || []);
                                                                                    const newGroups = [...sourceArray];
                                                                                    // Ensure we don't have empty slots if it was 'Matches Root Only' before
                                                                                    const cleanGroup = newGroups[item.originalIdx].filter(t => t !== '');
                                                                                    newGroups[item.originalIdx] = [...cleanGroup, e.currentTarget.value.trim()];

                                                                                    if (item.active) updateCurrentRule({ includeGroups: newGroups });
                                                                                    else updateCurrentRule({ disabledGroups: newGroups });

                                                                                    e.currentTarget.value = '';
                                                                                }
                                                                            }}
                                                                        />
                                                                        <button onClick={() => {
                                                                            const sourceArray = item.active ? currentConfig.includeGroups : (currentConfig.disabledGroups || []);
                                                                            const newGroups = sourceArray.filter((_, i) => i !== item.originalIdx);
                                                                            if (item.active) updateCurrentRule({ includeGroups: newGroups });
                                                                            else updateCurrentRule({ disabledGroups: newGroups });
                                                                        }} className="ml-auto text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-700" title="Remove Branch"> <X size={12} /> </button>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                        <div className="relative">
                                                            <div className="absolute -left-6 top-[13px] w-6 h-px">
                                                                <div className="absolute right-0 bottom-0 w-4 h-4 border-l border-b border-slate-600 rounded-bl-xl translate-y-1/2"></div>
                                                            </div>
                                                            <div className="pl-2">
                                                                <button onClick={() => updateCurrentRule({ includeGroups: [...currentConfig.includeGroups, [root]] })} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-slate-600 text-xs font-medium text-slate-500 hover:text-indigo-400 hover:bg-slate-800 hover:border-indigo-500/50 transition-all">
                                                                    <Plus size={12} /> <span>Add Branch</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        <button onClick={() => {
                                            let newRootName = 'NewRoot';
                                            let counter = 1;
                                            const existingRoots = new Set(groupedRoots.map(g => g.root));
                                            while (existingRoots.has(newRootName)) {
                                                newRootName = `NewRoot (${counter})`;
                                                counter++;
                                            }
                                            updateCurrentRule({ includeGroups: [...currentConfig.includeGroups, [newRootName]] });
                                        }} className="w-full py-3 border-2 border-dashed border-slate-700 rounded-2xl text-slate-500 hover:bg-slate-800 hover:border-slate-600 hover:text-indigo-400 transition-all flex items-center justify-center text-sm font-bold"><Plus size={18} className="mr-2" /> New Combo Tree</button>
                                    </div>
                                </div>
                                <div className="mt-4">
                                    <label className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2"><ShieldAlert size={16} className="text-red-500" /> Block List</label>
                                    <div className="bg-red-900/10 rounded-2xl p-4 border border-red-900/20 border-dashed relative">
                                        <div className="flex flex-wrap gap-2">
                                            {currentConfig.excludes.map((exc, idx) => (exc.trim() !== '' ? (<div key={idx} className="flex items-center bg-red-500/10 text-red-300 px-3 py-1.5 rounded-lg text-sm font-medium border border-red-500/20 shadow-sm"> <span>{exc}</span> <button onClick={() => updateCurrentRule({ excludes: currentConfig.excludes.filter((_, i) => i !== idx) })} className="ml-2 text-red-400/50 hover:text-red-300"><X size={12} /></button> </div>) : null))}
                                            <input className="bg-slate-700 text-sm text-slate-200 placeholder-slate-400 focus:bg-slate-600 focus:outline-none py-1.5 px-3 rounded-lg border border-slate-700/50 focus:border-red-500/50 transition-colors min-w-[120px]" placeholder="+ block word..." onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { updateCurrentRule({ excludes: [...currentConfig.excludes.filter(t => t !== ''), e.currentTarget.value.trim()] }); e.currentTarget.value = ''; } }} />
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-8">
                                    <label className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2"><Highlighter size={16} className="text-pink-400" /> Color Highlights</label>
                                    <div className="bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-700 mb-2">
                                        <div className="flex flex-col gap-2 mb-4">
                                            <div className="flex gap-1 flex-wrap">
                                                {HIGHLIGHT_COLORS.map(c => (<button key={c.value} onClick={() => { setNewHighlightColor(c.value); highlightInputRef.current?.focus(); }} className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${c.value} ${newHighlightColor === c.value ? 'border-white scale-110 shadow-md' : 'border-transparent opacity-80'}`} title={c.label} />))}
                                                <label className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer flex items-center justify-center overflow-hidden bg-slate-700 relative ${isHexColor(newHighlightColor) ? 'border-white scale-110 shadow-md' : 'border-slate-500 opacity-80'}`} title="Custom Color"> {isHexColor(newHighlightColor) && (<div className="absolute inset-0" style={{ backgroundColor: newHighlightColor }}></div>)} <Palette size={12} className={`relative z-10 ${isHexColor(newHighlightColor) ? 'text-white drop-shadow-md' : 'text-slate-400'}`} /> <input type="color" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" value={isHexColor(newHighlightColor) ? newHighlightColor : '#000000'} onChange={(e) => { setNewHighlightColor(e.target.value); highlightInputRef.current?.focus(); }} /> </label>
                                            </div>
                                            <input ref={highlightInputRef} className="w-full bg-slate-700 text-sm text-slate-200 placeholder-slate-400 focus:bg-slate-600 focus:outline-none py-1.5 px-3 rounded-lg border border-slate-700/50 focus:border-pink-500 transition-colors" placeholder="Word to color..." value={newHighlightWord} onChange={(e) => setNewHighlightWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newHighlightWord.trim()) { const h = { id: crypto.randomUUID(), keyword: newHighlightWord.trim(), color: newHighlightColor || HIGHLIGHT_COLORS[0].value }; updateCurrentRule({ highlights: [...(currentConfig.highlights || []), h] }); setNewHighlightWord(''); } }} />
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {(currentConfig.highlights || []).map((h, i) => { const isHex = isHexColor(h.color); return (<div key={h.id} style={isHex ? { backgroundColor: h.color } : undefined} className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold text-slate-900 border border-black/10 ${!isHex ? h.color : ''}`}> {h.keyword} {i < 5 && <span className="text-[9px] opacity-50 ml-1">(#{i + 1})</span>} <button onClick={() => updateCurrentRule({ highlights: (currentConfig.highlights || []).filter(item => item.id !== h.id) })} className="text-slate-800/50 hover:text-black"><X size={12} /></button> </div>); })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center pt-16 gap-4">
                                <div className="vertical-text text-slate-500 font-bold tracking-widest text-xs uppercase transform -rotate-180" style={{ writingMode: 'vertical-rl' }}>Configuration</div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="w-[500px] bg-slate-900 border-r border-slate-800 p-6 flex items-center justify-center text-slate-500">Select or Create a Rule</div>
                )
                }

                {/* Main View Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {isDualView ? (
                            <div className="flex w-full h-full">
                                <LogViewerPane
                                    key={leftFileName || 'left-empty'}
                                    ref={leftViewerRef}
                                    workerReady={leftWorkerReady}
                                    totalMatches={leftFilteredCount}
                                    onScrollRequest={requestLeftLines}
                                    placeholderText={leftFileName || "Drag log file here"}
                                    highlights={currentConfig?.highlights}
                                    onLineClick={(index) => setSelectedLineIndexLeft(index)}
                                    onLineDoubleClick={(index) => handleLineDoubleClickAction(index, 'left')}
                                    activeLineIndex={selectedLineIndexLeft}
                                    onDrop={handleLeftFileChange}
                                    paneId="left"
                                    fileName={leftFileName}
                                    onReset={handleLeftReset}
                                />
                                <div className="w-1 bg-slate-900 hover:bg-indigo-600 transition-colors cursor-col-resize z-30 shadow-xl"></div>
                                <LogViewerPane
                                    key={rightFileName || 'right-empty'}
                                    ref={rightViewerRef}
                                    workerReady={rightWorkerReady}
                                    totalMatches={rightFilteredCount}
                                    onScrollRequest={requestRightLines}
                                    placeholderText={rightFileName || "Drag log file here"}
                                    highlights={currentConfig?.highlights}
                                    hotkeyScope="alt"
                                    onLineClick={(index) => setSelectedLineIndexRight(index)}
                                    onLineDoubleClick={(index) => handleLineDoubleClickAction(index, 'right')}
                                    activeLineIndex={selectedLineIndexRight}
                                    onDrop={handleRightFileChange}
                                    paneId="right"
                                    fileName={rightFileName}
                                    onReset={handleRightReset}
                                />
                            </div>
                        ) : (
                            <LogViewerPane
                                key={leftFileName || 'single-empty'}
                                ref={leftViewerRef}
                                workerReady={leftWorkerReady}
                                totalMatches={leftFilteredCount}
                                onScrollRequest={requestLeftLines}
                                placeholderText={leftFileName || "Drop a log file to start"}
                                highlights={currentConfig?.highlights}
                                onLineClick={(index) => setSelectedLineIndexLeft(index)}
                                onLineDoubleClick={(index) => handleLineDoubleClickAction(index, 'left')}
                                activeLineIndex={selectedLineIndexLeft}
                                onDrop={handleLeftFileChange}
                                paneId="single"
                                fileName={leftFileName}
                                onReset={handleLeftReset}
                            />
                        )}
                    </div>
                </div>
            </div >
        </div >
    );
};

export default LogExtractor;
