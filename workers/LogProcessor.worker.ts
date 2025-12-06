/* eslint-disable no-restricted-globals */
import { LogRule, LogWorkerMessage, LogWorkerResponse } from '../types';

// We need to declare the worker context to avoid TS errors
const ctx: Worker = self as any;

let currentFile: File | null = null;
let lineOffsets: BigInt64Array | null = null; // Stores byte offset for each line header
let filteredIndices: Int32Array | null = null; // Stores line numbers (0-based) that match the filter

// --- Constants ---
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunk size for reading

// --- Helper: Post Response ---
const respond = (response: LogWorkerResponse) => {
    // console.log(`[Worker ${WORKER_ID}] Sending response:`, response.type);
    ctx.postMessage(response);
};

// --- Handler: Indexing (Scan newlines) ---
// This builds the 'Map' of LineNumber -> ByteOffset
const buildIndex = async (file: File) => {
    respond({ type: 'STATUS_UPDATE', payload: { status: 'indexing', progress: 0 } });

    const fileSize = file.size;
    const offsets: bigint[] = [0n]; // Line 0 starts at byte 0
    let offset = 0n;
    let processedBytes = 0;

    const stream = file.stream() as any; // Cast to avoid TS issues with File.stream() in some envs
    const reader = stream.getReader();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk: Uint8Array = value;
            for (let i = 0; i < chunk.length; i++) {
                if (chunk[i] === 10) { // Newline \n
                    offsets.push(offset + BigInt(i) + 1n);
                }
            }
            offset += BigInt(chunk.length);

            // Progress Update every ~50MB or so? Or just percent based
            processedBytes += chunk.length;
            if (processedBytes % (50 * 1024 * 1024) === 0) {
                respond({ type: 'STATUS_UPDATE', payload: { status: 'indexing', progress: (processedBytes / fileSize) * 100 } });
            }
        }
    } catch (e) {
        console.error("Index Error", e);
        respond({ type: 'ERROR', payload: 'Failed to index file' });
        return;
    }

    lineOffsets = new BigInt64Array(offsets);
    respond({ type: 'STATUS_UPDATE', payload: { status: 'indexing', progress: 100 } });
    respond({ type: 'INDEX_COMPLETE', payload: { totalLines: offsets.length } });

    // Initial "All Pass" filter
    filteredIndices = new Int32Array(offsets.length);
    for (let i = 0; i < offsets.length; i++) filteredIndices[i] = i;

    respond({ type: 'FILTER_COMPLETE', payload: { matchCount: offsets.length } });
};

// --- Handler: Filtering ---
// Reads the file again (stream) and checks against rules
// UPDATED: Case Insensitive Logic
const applyFilter = async (rule: LogRule) => {
    if (!currentFile || !lineOffsets) return;

    respond({ type: 'STATUS_UPDATE', payload: { status: 'filtering', progress: 0 } });

    // Prepare meaningful groups and excludes (CASE INSENSITIVE PRE-PROCESSING)
    // Prepare meaningful groups and excludes (CASE INSENSITIVE PRE-PROCESSING)
    const activeGroups = rule.includeGroups.map(g => g.map(t => t.trim().toLowerCase()).filter(t => t !== ''));
    // Filter groups to require at least 1 tag
    const meaningfulGroups = activeGroups.filter(g => g.length > 0);
    const excludes = rule.excludes.map(e => e.trim().toLowerCase()).filter(e => e !== '');

    console.log('[Worker] Applying Filter:', { meaningfulGroups, excludes });

    // Optimization: If no filters at all (and no excludes), pass everything
    if (activeGroups.length === 0 && excludes.length === 0) {
        // Only if User explicitly has NO groups in the rule at all
        // (If user has groups but they are all empty strings -> activeGroups is non-empty array of empty arrays? No activeGroups filters inner)

        // Let's refine:
        // rule.includeGroups is the raw input.
        if (rule.includeGroups.length === 0 && excludes.length === 0) {
            const all = new Int32Array(lineOffsets.length);
            for (let i = 0; i < lineOffsets.length; i++) all[i] = i;
            filteredIndices = all;
            respond({ type: 'FILTER_COMPLETE', payload: { matchCount: all.length } });
            respond({ type: 'STATUS_UPDATE', payload: { status: 'ready' } });
            return;
        }
    }

    // If meaningfulGroups is empty but rule.includeGroups was NOT empty, 
    // it means we have "blank rules".
    // "Show Nothing" is safer than "Show Everything" here.
    if (meaningfulGroups.length === 0 && rule.includeGroups.length > 0) {
        console.log('[Worker] Rules exist but are empty -> Matching NOTHING.');
        filteredIndices = new Int32Array(0);
        respond({ type: 'FILTER_COMPLETE', payload: { matchCount: 0 } });
        respond({ type: 'STATUS_UPDATE', payload: { status: 'ready' } });
        return;
    }

    const matches: number[] = [];
    const reader = currentFile.stream().getReader();
    const decoder = new TextDecoder();

    let processedBytes = 0;
    let globalLineIndex = 0;
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunkText = decoder.decode(value, { stream: true });
            buffer += chunkText;

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const rawLine of lines) {
                // Lowercase for matching
                const line = rawLine.toLowerCase();

                // 1. Check Excludes (Strict String Includes, Block List Precedence)
                const matchingExclude = excludes.find(exc => line.includes(exc));

                if (matchingExclude) {
                    // Debug: Did we exclude something that WANTED to match?
                    if (globalLineIndex < 100) {
                        const wouldMatch = meaningfulGroups.length === 0 || meaningfulGroups.some(group => group.every(term => line.includes(term)));
                        if (wouldMatch) {
                            console.log(`[Worker] Line #${globalLineIndex} BLOCKED by exclude "${matchingExclude}": "${line.substring(0, 50)}..."`);
                        }
                    }
                    globalLineIndex++;
                    continue; // Skip
                }

                let isMatch = false;

                // 2. Check Happy Combos (OR Logic across groups, AND logic within group)
                if (meaningfulGroups.length === 0) {
                    isMatch = true; // No includes defined -> Show all (except excluded)
                } else {
                    isMatch = meaningfulGroups.some(group => {
                        return group.every(term => line.includes(term));
                    });
                }

                if (isMatch) {
                    matches.push(globalLineIndex);
                }

                if (globalLineIndex < 100) {
                    // Only log matches or interesting failures
                    if (isMatch) {
                        console.log(`[Worker] Line #${globalLineIndex} MATCHED: "${line.substring(0, 50)}..."`);
                    }
                }

                globalLineIndex++;
            }

            processedBytes += value.length;
            if (globalLineIndex % 10000 === 0) {
                respond({ type: 'STATUS_UPDATE', payload: { status: 'filtering', progress: (processedBytes / currentFile.size) * 100 } });
            }
        }

        // Process final buffer
        if (buffer.length > 0) {
            const line = buffer.toLowerCase();
            const hasExclude = excludes.some(exc => line.includes(exc));
            if (!hasExclude) {
                let isMatch = false;
                if (meaningfulGroups.length === 0) {
                    isMatch = true;
                } else {
                    isMatch = meaningfulGroups.some(group => group.every(term => line.includes(term)));
                }
                if (isMatch) {
                    matches.push(globalLineIndex);
                }
            }
        }

    } catch (e) {
        console.error("Filter Error", e);
    }

    // Finalize
    // Finalize
    filteredIndices = new Int32Array(matches);
    respond({ type: 'STATUS_UPDATE', payload: { status: 'ready', progress: 100 } });
    respond({ type: 'FILTER_COMPLETE', payload: { matchCount: matches.length } });
};


// --- Handler: Get Lines ---
const getLines = async (startFilterIndex: number, count: number, requestId: string) => {
    if (!currentFile || !lineOffsets || !filteredIndices) return;

    const resultLines: { lineNum: number, content: string }[] = [];
    const max = Math.min(startFilterIndex + count, filteredIndices.length);

    // Promisify FileReader
    const readSlice = (blob: Blob): Promise<string> => {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload = (e) => resolve(e.target?.result as string);
            r.readAsText(blob);
        });
    };

    for (let i = startFilterIndex; i < max; i++) {
        const originalLineNum = filteredIndices[i];

        const startByte = Number(lineOffsets[originalLineNum]);
        // endByte is start of next line - 1 (for \n)
        // Check if last line
        const endByte = originalLineNum < lineOffsets.length - 1
            ? Number(lineOffsets[originalLineNum + 1])
            : currentFile.size;

        if (startByte >= endByte) {
            resultLines.push({ lineNum: originalLineNum + 1, content: '' }); // Empty line
            continue;
        }

        const blobSlice = currentFile.slice(startByte, endByte);
        const text = await readSlice(blobSlice);

        resultLines.push({
            lineNum: originalLineNum + 1,
            content: text.replace(/\r?\n$/, '') // Remove trailing newline if included
        });
    }

    respond({
        type: 'LINES_DATA',
        payload: { lines: resultLines },
        requestId
    });
};

// --- Handler: Get Unfiltered "Raw" Lines Context ---
const getRawLines = async (startLineNum: number, count: number, requestId: string) => {
    if (!currentFile || !lineOffsets) return;

    const resultLines: { lineNum: number, content: string }[] = [];

    // Bounds check
    const start = Math.max(0, startLineNum);
    const end = Math.min(start + count, lineOffsets.length);

    // Re-use helper
    const readSlice = (blob: Blob): Promise<string> => {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload = (e) => resolve(e.target?.result as string);
            r.readAsText(blob);
        });
    };

    for (let i = start; i < end; i++) {
        const startByte = Number(lineOffsets[i]);
        const endByte = i < lineOffsets.length - 1
            ? Number(lineOffsets[i + 1])
            : currentFile.size;

        if (startByte >= endByte) {
            resultLines.push({ lineNum: i + 1, content: '' });
            continue;
        }

        const blobSlice = currentFile.slice(startByte, endByte);
        const text = await readSlice(blobSlice);

        resultLines.push({
            lineNum: i + 1,
            content: text.replace(/\r?\n$/, '')
        });
    }

    respond({
        type: 'LINES_DATA',
        payload: { lines: resultLines },
        requestId
    });
};

ctx.onmessage = (evt: MessageEvent<LogWorkerMessage>) => {
    const { type, payload, requestId } = evt.data;

    switch (type) {
        case 'INIT_FILE':
            if (payload instanceof File) {
                currentFile = payload;
                // Reset
                lineOffsets = null;
                filteredIndices = null;
                buildIndex(payload);
            }
            break;

        case 'FILTER_LOGS':
            if (payload) {
                applyFilter(payload as LogRule);
            }
            break;

        case 'GET_LINES':
            if (payload) {
                const { startLine, count } = payload;
                getLines(startLine, count, requestId || '');
            }
            break;

        case 'GET_RAW_LINES':
            if (payload) {
                const { startLine, count } = payload;
                getRawLines(startLine, count, requestId || '');
            }
            break;
    }
};
