import { ProcessedRow, AnalysisStatus } from "../types";

export const parseCsv = (content: string): ProcessedRow[] => {
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  // Detect delimiter (user's python script used ';')
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
  
  return lines.slice(1).map((line, index) => {
    // Handle split but respect quotes (simplified for this use case)
    // For robust CSV parsing in production, a library like PapaParse is recommended, 
    // but here we stick to simple logic as per instructions not to use external libs if avoidable for simple tasks.
    // However, the user's data seems simple.
    const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
    
    const rowObj: any = { id: String(index) }; // internal ID
    headers.forEach((header, i) => {
      rowObj[header] = values[i] || '';
    });

    return {
      ...rowObj,
      _status: AnalysisStatus.IDLE
    };
  });
};

export const generateCsv = (rows: ProcessedRow[]): string => {
  if (rows.length === 0) return '';

  // Get original headers excluding internal flags
  const originalHeaders = Object.keys(rows[0]).filter(k => !k.startsWith('_') && k !== 'id');
  
  // Add new headers based on the user's request
  const allHeaders = [...originalHeaders, 'Tipologia di Sito', 'Dettagli', 'Fonti'];
  
  const headerRow = allHeaders.join(';');
  
  const dataRows = rows.map(row => {
    return allHeaders.map(header => {
      let value = '';
      
      if (header === 'Tipologia di Sito') {
        value = row._analysis?.type || '';
      } else if (header === 'Dettagli') {
        value = row._analysis?.details || '';
      } else if (header === 'Fonti') {
        value = row._analysis?.sources?.join(', ') || '';
      } else {
        value = (row[header] as string) || '';
      }

      // Escape semicolons and quotes
      if (value.includes(';') || value.includes('"')) {
        value = `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(';');
  });

  return [headerRow, ...dataRows].join('\n');
};

export const downloadCsv = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};