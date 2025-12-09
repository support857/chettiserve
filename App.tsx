import React, { useState, useRef, useEffect } from 'react';
import { parseCsv, generateCsv, downloadCsv } from './utils/csvHelper';
import { analyzeUrlWithGemini } from './services/geminiService';
import { ProcessedRow, AnalysisStatus } from './types';
import { UploadIcon, PlayIcon, DownloadIcon, CheckCircleIcon, AlertCircleIcon, LoaderIcon } from './components/Icons';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}

const App: React.FC = () => {
  const [rows, setRows] = useState<ProcessedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string>(''); // Safe state for key display
  const [urlColumn, setUrlColumn] = useState<string>('');
  
  // Progress tracking
  const [completedCount, setCompletedCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to safely get key
  const updateKeyDisplay = () => {
    try {
      // Check if process and process.env exist before accessing to prevent crashes
      if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
        const key = process.env.API_KEY;
        if (key.length > 4) {
          setMaskedApiKey(`...${key.slice(-4)}`);
        } else {
          setMaskedApiKey('****');
        }
      } else {
        setMaskedApiKey('');
      }
    } catch (e) {
      console.error("Error reading API key:", e);
      setMaskedApiKey('');
    }
  };

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeyReady(hasKey);
      }
      updateKeyDisplay();
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setApiKeyReady(hasKey);
      
      // Short delay to allow env var propagation if necessary
      setTimeout(updateKeyDisplay, 500);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsedRows = parseCsv(text);
      setRows(parsedRows);
      
      // Attempt to auto-detect URL column
      if (parsedRows.length > 0) {
        const headers = Object.keys(parsedRows[0]).filter(k => !k.startsWith('_') && k !== 'id');
        // Prioritize 'Sito Web Trovato' as per specific user requirement, then fallbacks
        const likelyUrl = headers.find(h => h === 'Sito Web Trovato') || 
                          headers.find(h => h.toLowerCase().includes('sito')) || 
                          headers.find(h => h.toLowerCase().includes('web')) || 
                          headers.find(h => h.toLowerCase().includes('link')) || 
                          headers[0];
        setUrlColumn(likelyUrl);
      }
      setCompletedCount(0);
    };
    reader.readAsText(file);
  };

  const processQueue = async () => {
    if (!apiKeyReady) {
      alert("Please select an API Key first.");
      return;
    }

    if (rows.length === 0) return;
    
    setIsProcessing(true);
    const newRows = [...rows];
    
    // BATCH PROCESSING CONFIGURATION
    const BATCH_SIZE = 5; // Process 5 URLs in parallel
    const apiKey = typeof process !== 'undefined' && process.env ? (process.env.API_KEY || '') : '';

    // Identify indices that need processing
    const indicesToProcess: number[] = [];
    for (let i = 0; i < newRows.length; i++) {
      if (newRows[i]._status !== AnalysisStatus.COMPLETED && newRows[i].id) {
        indicesToProcess.push(i);
      }
    }

    // Process in batches
    for (let i = 0; i < indicesToProcess.length; i += BATCH_SIZE) {
      const batchIndices = indicesToProcess.slice(i, i + BATCH_SIZE);
      const batchPromises = batchIndices.map(async (rowIndex) => {
        const row = newRows[rowIndex];
        const rawUrl = row[urlColumn] as string;
        const urlToAnalyze = (rawUrl || '').trim();

        // 1. Check for specific skip condition: static.xx.fbcdn.net
        if (urlToAnalyze.includes('static.xx.fbcdn.net')) {
          return {
            rowIndex,
            status: AnalysisStatus.COMPLETED,
            result: {
              url: urlToAnalyze,
              type: 'analisi non possibile',
              details: 'URL ignorato (fbcdn)',
              sources: [] as string[]
            }
          };
        }

        // 2. Skip rows with "N/A", empty, or obvious placeholders
        if (!urlToAnalyze || urlToAnalyze === 'N/A' || urlToAnalyze.length < 5) {
           return {
             rowIndex,
             status: AnalysisStatus.COMPLETED,
             result: {
               url: urlToAnalyze || '',
               type: 'Skipped',
               details: 'Invalid or missing URL',
               sources: [] as string[]
             }
           };
        }

        // 3. Perform Analysis
        // Update status to processing strictly for UI feedback before await
        const result = await analyzeUrlWithGemini(apiKey, urlToAnalyze);
        
        return {
          rowIndex,
          status: AnalysisStatus.COMPLETED,
          result
        };
      });

      // Mark current batch as processing in UI
      batchIndices.forEach(idx => {
        newRows[idx] = { ...newRows[idx], _status: AnalysisStatus.PROCESSING };
      });
      setRows([...newRows]);

      // Wait for the batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Update state with results
      batchResults.forEach(({ rowIndex, status, result }) => {
        newRows[rowIndex] = {
          ...newRows[rowIndex],
          _status: status,
          _analysis: result
        };
      });

      setRows([...newRows]);
      setCompletedCount(prev => prev + batchResults.length);

      // Minimal delay between batches to allow UI updates and be gentle on API
      if (i + BATCH_SIZE < indicesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 500)); 
      }
    }

    setIsProcessing(false);
  };

  const handleExport = () => {
    const csvContent = generateCsv(rows);
    downloadCsv(csvContent, 'inserzionisti_completi_con_ID_e_categoria.csv');
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]).filter(k => !k.startsWith('_') && k !== 'id') : [];
  
  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="bg-brand-600 text-white p-2 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Gemini Site Analyzer</h1>
            <p className="text-xs text-slate-500">Replaces Python/Selenium scraping with Gemini Search Grounding</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           {!apiKeyReady ? (
              <button 
                onClick={handleSelectKey}
                className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-100 transition-colors border border-red-200"
              >
                Select Paid API Key (Required)
              </button>
           ) : (
             <div className="flex items-center gap-2">
               <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-1.5 rounded-full border border-green-200 text-sm font-mono" title="Current API Key">
                 <span className="w-2 h-2 rounded-full bg-green-500"></span>
                 Key: {maskedApiKey || 'Active'}
               </div>
               <button 
                 onClick={handleSelectKey}
                 className="text-xs text-slate-500 underline hover:text-brand-600"
               >
                 Change
               </button>
             </div>
           )}
           <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:underline">Billing Info</a>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col p-6 max-w-7xl mx-auto w-full">
        
        {/* Toolbar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium text-sm"
              disabled={isProcessing}
            >
              <UploadIcon />
              Import CSV
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".csv" 
              className="hidden" 
            />

            {rows.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                <span>URL Column:</span>
                <select 
                  value={urlColumn} 
                  onChange={(e) => setUrlColumn(e.target.value)}
                  className="bg-transparent font-semibold text-brand-700 outline-none cursor-pointer"
                  disabled={isProcessing}
                >
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {rows.length > 0 && (
              <div className="text-sm text-slate-500 mr-4">
                {completedCount} / {rows.length} processed
              </div>
            )}
            
            <button 
              onClick={processQueue}
              disabled={isProcessing || rows.length === 0 || !apiKeyReady}
              className={`flex items-center gap-2 px-6 py-2 rounded-lg font-bold text-white shadow-md transition-all
                ${isProcessing || rows.length === 0 || !apiKeyReady 
                  ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                  : 'bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 active:scale-95'
                }`}
            >
              {isProcessing ? <LoaderIcon /> : <PlayIcon />}
              {isProcessing ? 'Analyzing...' : 'Start Analysis'}
            </button>
            
            <button 
              onClick={handleExport}
              disabled={completedCount === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-colors
                ${completedCount === 0 
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed' 
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400'
                }`}
            >
              <DownloadIcon />
              Export CSV
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-auto bg-white border border-slate-200 rounded-xl shadow-sm relative">
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <UploadIcon />
              </div>
              <p className="text-lg font-medium text-slate-500">No data loaded</p>
              <p className="text-sm">Upload a CSV file containing website URLs to begin.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-600 border-b border-slate-200 w-12 text-center">#</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 border-b border-slate-200 w-24">Status</th>
                  {/* Show selected URL column first for context */}
                  <th className="px-4 py-3 font-semibold text-brand-700 border-b border-slate-200 bg-brand-50/50">
                    {urlColumn} (Target)
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-800 border-b border-slate-200 bg-amber-50">
                    Gemini: Type
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-800 border-b border-slate-200 bg-amber-50 w-1/3">
                    Gemini: Details
                  </th>
                  {/* Other columns */}
                  {headers.filter(h => h !== urlColumn).map(header => (
                     <th key={header} className="px-4 py-3 font-semibold text-slate-500 border-b border-slate-200 truncate max-w-[150px]">
                       {header}
                     </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-center text-slate-400 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      {row._status === AnalysisStatus.IDLE && <span className="inline-block w-2 h-2 rounded-full bg-slate-300"></span>}
                      {row._status === AnalysisStatus.PROCESSING && <LoaderIcon />}
                      {row._status === AnalysisStatus.COMPLETED && (
                        (row._analysis?.type === 'analisi non possibile' || row._analysis?.type === 'API Error') 
                        ? <AlertCircleIcon /> 
                        : <CheckCircleIcon />
                      )}
                      {row._status === AnalysisStatus.ERROR && <AlertCircleIcon />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-brand-600 truncate max-w-[200px]" title={row[urlColumn] as string}>
                      {row[urlColumn] as string}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 bg-amber-50/30">
                       {row._analysis?.type || '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 bg-amber-50/30 text-xs leading-relaxed">
                       {row._analysis?.details || '-'}
                       {row._analysis?.sources && row._analysis.sources.length > 0 && (
                         <div className="mt-1 flex flex-wrap gap-1">
                           {row._analysis.sources.map((s, i) => (
                             <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:underline border border-blue-100 rounded px-1">src {i+1}</a>
                           ))}
                         </div>
                       )}
                    </td>
                    {headers.filter(h => h !== urlColumn).map(header => (
                      <td key={header} className="px-4 py-3 text-slate-400 text-xs truncate max-w-[150px]">
                        {row[header] as string}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;