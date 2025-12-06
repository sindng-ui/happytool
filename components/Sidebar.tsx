import React, { useState } from 'react';
import * as Lucide from 'lucide-react';
import { ToolId } from '../types';

const { FileText, Activity, Braces, Archive, Smile, GripVertical } = Lucide;

interface SidebarProps {
  activeTool: ToolId;
  onSelectTool: (id: ToolId) => void;
  toolOrder: ToolId[];
  onReorderTools: (order: ToolId[]) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTool, onSelectTool, toolOrder, onReorderTools }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [draggedItem, setDraggedItem] = useState<ToolId | null>(null);

  const toolDefinitions = {
    [ToolId.LOG_EXTRACTOR]: { label: 'Log Extractor', icon: FileText },
    [ToolId.PERF_ANALYZER]: { label: 'Perf Analyzer', icon: Activity },
    [ToolId.JSON_TOOLS]: { label: 'JSON Tools', icon: Braces },
    [ToolId.TPK_EXTRACTOR]: { label: 'Tpk Extractor', icon: Archive },
  };

  const handleDragStart = (e: React.DragEvent, id: ToolId) => {
    setDraggedItem(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => setDraggedItem(null);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDragEnter = (e: React.DragEvent, targetId: ToolId) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    const currentIndex = toolOrder.indexOf(draggedItem);
    const targetIndex = toolOrder.indexOf(targetId);

    if (currentIndex === -1 || targetIndex === -1) return;

    const newOrder = [...toolOrder];
    newOrder.splice(currentIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    onReorderTools(newOrder);
  };

  return (
    <div
      className={`h-full bg-slate-950 border-r border-slate-800 text-slate-400 transition-all duration-300 ease-in-out flex flex-col z-30 shadow-2xl ${isHovered ? 'w-72' : 'w-20'
        }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="h-20 flex items-center justify-center relative border-b border-slate-900/50">
        <div className={`transition-all duration-300 ${isHovered ? 'scale-100' : 'scale-90'}`}>
          {isHovered ? (
            <div className="flex items-center gap-2 text-indigo-400">
              <Smile className="w-8 h-8" strokeWidth={2.5} />
              <span className="font-bold text-2xl tracking-tight text-white">HappyTool</span>
            </div>
          ) : (
            <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-900/20">
              <Smile className="w-6 h-6 text-white" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 px-3 py-6 space-y-2 overflow-y-auto overflow-x-hidden">
        {toolOrder.map((toolId) => {
          const item = toolDefinitions[toolId];
          if (!item) return null;
          const Icon = item.icon;
          const isActive = activeTool === toolId;
          const isDragging = draggedItem === toolId;

          return (
            <button
              key={toolId}
              draggable="true"
              onDragStart={(e) => handleDragStart(e, toolId)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, toolId)}
              onClick={() => onSelectTool(toolId)}
              className={`w-full flex items-center h-12 px-3 rounded-2xl transition-all duration-300 ease-out group relative cursor-pointer ${isActive
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                } ${isDragging ? 'opacity-20 border-2 border-dashed border-slate-600' : ''}`}
            >
              {isHovered && (
                <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 cursor-grab active:cursor-grabbing">
                  <GripVertical size={14} />
                </div>
              )}
              <div className="min-w-[40px] flex items-center justify-center">
                <Icon className={`w-6 h-6 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
              </div>
              <span className={`ml-3 font-medium text-sm whitespace-nowrap transition-all duration-300 ${isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 hidden'}`}>
                {item.label}
              </span>
              {!isHovered && !isDragging && (
                <div className="absolute left-full ml-4 px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700">
                  {item.label}
                  <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45 border-l border-b border-slate-700"></div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className={`p-6 border-t border-slate-900 text-xs text-slate-600 whitespace-nowrap overflow-hidden transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex flex-col gap-1">
          <span className="font-bold text-slate-500">HappyTool Suite</span>
          <span>v0.1.0 &bull; Build 2025</span>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;