import React, { useRef } from 'react';
import { Settings, Save, Upload, HelpCircle, Info, ChevronDown } from 'lucide-react';
import { AppSettings } from '../types';

interface TopMenuProps {
  onExportSettings: () => void;
  onImportSettings: (settings: AppSettings) => void;
}

const TopMenu: React.FC<TopMenuProps> = ({ onExportSettings, onImportSettings }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        onImportSettings(json);
        alert('Settings loaded successfully.');
      } catch (error) {
        alert('Failed to parse settings file.');
        console.error(error);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const menuBtnClass = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-colors cursor-pointer group select-none";
  const dropdownClass = "absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-xl shadow-slate-200 border border-slate-100 hidden group-hover:block z-[60] overflow-hidden animation-fade-in";
  const dropdownItemClass = "w-full text-left px-4 py-3 hover:bg-indigo-50 hover:text-indigo-700 text-sm flex items-center gap-2 transition-colors";

  return (
    <div className="h-14 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center px-6 justify-between select-none z-50 relative">
      <div className="flex space-x-2">
        
        {/* File Menu */}
        <div className="relative group">
          <div className={menuBtnClass}>
            File <ChevronDown size={14} className="text-slate-400 group-hover:text-indigo-400 transition-transform group-hover:rotate-180"/>
          </div>
          <div className={dropdownClass}>
            <button 
              className={dropdownItemClass}
              onClick={() => window.close()} 
            >
              Exit Application
            </button>
          </div>
        </div>

        {/* Settings Menu */}
        <div className="relative group">
          <div className={menuBtnClass}>
             Settings <ChevronDown size={14} className="text-slate-400 group-hover:text-indigo-400 transition-transform group-hover:rotate-180"/>
          </div>
          <div className={dropdownClass}>
            <button onClick={onExportSettings} className={dropdownItemClass}>
              <Save size={16} /> Export JSON
            </button>
            <button onClick={() => fileInputRef.current?.click()} className={dropdownItemClass}>
              <Upload size={16} /> Import JSON
            </button>
          </div>
        </div>

        {/* Help Menu */}
        <div className="relative group">
          <div className={menuBtnClass}>
            Help <ChevronDown size={14} className="text-slate-400 group-hover:text-indigo-400 transition-transform group-hover:rotate-180"/>
          </div>
          <div className={dropdownClass}>
            <button className={dropdownItemClass}>
              <Info size={16} /> About HappyTool
            </button>
          </div>
        </div>
      </div>

      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".json"
      />
      
      <div className="text-xs font-semibold text-indigo-200 px-3 py-1 bg-indigo-50 rounded-full uppercase tracking-wider">
        Suite v1.0
      </div>
    </div>
  );
};

export default TopMenu;