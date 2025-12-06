import React, { useState } from 'react';
import * as Lucide from 'lucide-react';
import { HttpMethod, PerfResponse } from '../types';

const { Send, Activity, ArrowRight, Clock, Globe, Database } = Lucide;

interface PerfAnalyzerProps {
  defaultUrl: string;
  defaultMethod: string;
}

const PerfAnalyzer: React.FC<PerfAnalyzerProps> = ({ defaultUrl, defaultMethod }) => {
  const [url, setUrl] = useState(defaultUrl || 'https://jsonplaceholder.typicode.com/posts/1');
  const [method, setMethod] = useState<HttpMethod>((defaultMethod as HttpMethod) || 'GET');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<PerfResponse | null>(null);

  const handleSendRequest = async () => {
    setLoading(true);
    setResponse(null);
    const startTime = performance.now();

    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (['POST', 'PUT', 'PATCH'].includes(method) && body) {
        options.body = body;
      }

      const res = await fetch(url, options);
      const endTime = performance.now();

      const data = await res.json().catch(() => ({ error: 'Could not parse JSON' }));

      const headers: Record<string, string> = {};
      res.headers.forEach((val, key) => { headers[key] = val; });

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers,
        data,
        timeTaken: Math.round(endTime - startTime),
      });

    } catch (error: any) {
      setResponse({
        status: 0,
        statusText: 'Network Error',
        headers: {},
        data: { message: error.message },
        timeTaken: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const getMethodColor = (m: string) => {
    switch (m) {
      case 'GET': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'POST': return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'DELETE': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'PUT': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      default: return 'text-slate-400 bg-slate-800 border-slate-700';
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-950 p-6 gap-6">

      {/* Top Section: Request Composer */}
      <div className="bg-slate-900 rounded-3xl p-6 shadow-lg border border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
            <div className="p-2 bg-indigo-500/20 rounded-xl">
              <Activity className="text-indigo-400" size={20} />
            </div>
            Request Composer
          </h2>
        </div>

        <div className="flex gap-4">
          <div className="relative">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
              className={`appearance-none h-12 px-4 pr-8 rounded-xl font-bold border cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all [&>option]:bg-slate-900 [&>option]:text-slate-200 ${getMethodColor(method)}`}
            >
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>DELETE</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
              <ArrowRight size={14} className="text-slate-400" />
            </div>
          </div>

          <div className="flex-1 relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
              <Globe size={18} />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/endpoint"
              className="w-full h-12 pl-12 pr-4 bg-slate-950 border border-slate-800 rounded-xl font-medium text-slate-200 placeholder-slate-600 focus:outline-none focus:bg-slate-900 focus:border-indigo-500 transition-all"
            />
          </div>

          <button
            onClick={handleSendRequest}
            disabled={loading}
            className={`h-12 px-8 rounded-xl flex items-center gap-2 font-bold text-white shadow-lg transition-all hover:scale-105 active:scale-95 ${loading
                ? 'bg-indigo-900 cursor-wait shadow-none text-indigo-300'
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/50'
              }`}
          >
            {loading ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div> : <Send size={18} />}
            {loading ? 'Sending' : 'Send'}
          </button>
        </div>

        {['POST', 'PUT', 'PATCH'].includes(method) && (
          <div className="mt-4 animate-fade-in-down">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1">Request Payload</label>
            <div className="relative">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full h-32 bg-slate-950 text-emerald-400 rounded-2xl p-4 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none shadow-inner border border-slate-800"
                placeholder='{ "key": "value" }'
              />
              <div className="absolute top-2 right-2 text-[10px] text-slate-600 font-mono">JSON</div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Section: Response Monitor */}
      <div className="flex-1 flex flex-col min-h-0">
        {response ? (
          <div className="flex-1 bg-slate-900 rounded-3xl shadow-lg border border-slate-800 overflow-hidden flex flex-col animate-fade-in-up">
            {/* Status Bar */}
            <div className="bg-slate-800/50 p-4 border-b border-slate-800 flex justify-between items-center backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-sm shadow-sm ${response.status >= 200 && response.status < 300
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                  <div className={`w-2 h-2 rounded-full ${response.status >= 200 && response.status < 300 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  {response.status} {response.statusText}
                </div>
                <div className="flex items-center gap-1.5 text-slate-400 text-sm font-medium bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shadow-sm">
                  <Clock size={14} className="text-slate-500" />
                  {response.timeTaken}ms
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex overflow-hidden relative">
              {/* Response Body */}
              <div className="w-full overflow-auto p-0">
                <div className="sticky top-0 bg-slate-900/90 backdrop-blur z-10 px-6 py-2 border-b border-slate-800 flex items-center gap-2">
                  <Database size={14} className="text-slate-500" />
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Response Data</span>
                </div>
                <pre className="p-6 text-sm font-mono text-emerald-400 leading-relaxed whitespace-pre-wrap selection:bg-emerald-900/50 selection:text-emerald-100">
                  {JSON.stringify(response.data, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-800 rounded-3xl m-2 bg-slate-900/50">
            <div className="bg-slate-800 p-6 rounded-full shadow-sm mb-4">
              <Activity size={48} className="text-indigo-400" />
            </div>
            <p className="font-medium text-slate-400">Ready to trace request</p>
            <p className="text-sm text-slate-600 mt-1">Configure and send to view results</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerfAnalyzer;