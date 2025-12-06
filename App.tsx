import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import LogExtractor from './components/LogExtractor';
import PerfAnalyzer from './components/PerfAnalyzer';
import TpkExtractor from './components/TpkExtractor';
import JsonTools from './components/JsonTools';
import { ToolId, LogRule, AppSettings } from './types';

const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<ToolId>(ToolId.LOG_EXTRACTOR);

  // App-wide state (Settings)
  const [logRules, setLogRules] = useState<LogRule[]>([
    {
      id: '1',
      name: 'New Analysis',
      includeGroups: [['']],
      excludes: [],
      highlights: []
    }
  ]);
  const [lastApiUrl, setLastApiUrl] = useState('');
  const [lastMethod, setLastMethod] = useState('GET');
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  // Tool Order State
  const [toolOrder, setToolOrder] = useState<ToolId[]>([
    ToolId.LOG_EXTRACTOR,
    ToolId.PERF_ANALYZER,
    ToolId.JSON_TOOLS,
    ToolId.TPK_EXTRACTOR
  ]);

  // Load settings on mount
  useEffect(() => {
    const saved = localStorage.getItem('devtool_suite_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.logRules) {
          // Migration for legacy fields
          const migratedRules = parsed.logRules.map((r: any) => {
            let rule = { ...r };

            // Migrate legacy 'includes'
            if (rule.includes && !rule.includeGroups) {
              rule.includeGroups = Array.isArray(rule.includes)
                ? rule.includes.map((i: string) => [i])
                : [[]];
              delete rule.includes;
            }

            // Migrate missing 'highlights'
            if (!rule.highlights) {
              rule.highlights = [];
            }

            return rule;
          });
          setLogRules(migratedRules);
        }
        if (parsed.lastEndpoint) setLastApiUrl(parsed.lastEndpoint);
      } catch (e) {
        console.error("Failed to load settings", e);
      }
    }
    setIsSettingsLoaded(true);
  }, []);

  // Auto-save settings when changed
  useEffect(() => {
    if (!isSettingsLoaded) return;

    const settings: AppSettings = {
      logRules,
      lastEndpoint: lastApiUrl,
      lastMethod
    };
    localStorage.setItem('devtool_suite_settings', JSON.stringify(settings));
  }, [logRules, lastApiUrl, lastMethod]);

  const handleExportSettings = () => {
    const settings: AppSettings = {
      logRules,
      lastEndpoint: lastApiUrl,
      lastMethod
    };
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'happytool_settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportSettings = (settings: AppSettings) => {
    if (settings.logRules) {
      // Migration for imported legacy rules
      const migratedRules = settings.logRules.map((r: any) => {
        let rule = { ...r };
        if (rule.includes && !rule.includeGroups) {
          rule.includeGroups = Array.isArray(rule.includes) ? rule.includes.map((i: string) => [i]) : [[]];
          delete rule.includes;
        }
        if (!rule.highlights) {
          rule.highlights = [];
        }
        return rule;
      });
      setLogRules(migratedRules);
    }
    if (settings.lastEndpoint) setLastApiUrl(settings.lastEndpoint);
    if (settings.lastMethod) setLastMethod(settings.lastMethod);
  };

  const renderContent = () => {
    switch (activeTool) {
      case ToolId.LOG_EXTRACTOR:
        return <LogExtractor
          rules={logRules}
          onUpdateRules={setLogRules}
          onExportSettings={handleExportSettings}
          onImportSettings={handleImportSettings}
        />;
      case ToolId.PERF_ANALYZER:
        return <PerfAnalyzer defaultUrl={lastApiUrl} defaultMethod={lastMethod} />;
      case ToolId.JSON_TOOLS:
        return <JsonTools />;
      case ToolId.TPK_EXTRACTOR:
        return <TpkExtractor />;
      default:
        return <div className="p-8 text-slate-400">Select a tool from the sidebar</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-200">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          toolOrder={toolOrder}
          onReorderTools={setToolOrder}
        />

        <main className="flex-1 overflow-hidden relative bg-slate-950">
          {!isSettingsLoaded ? (
            <div className="flex h-full items-center justify-center text-slate-500">Loading settings...</div>
          ) : (
            renderContent()
          )}
        </main>
      </div>
    </div>
  );
};

export default App;