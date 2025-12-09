export interface CsvRow {
  [key: string]: string;
}

export interface AnalysisResult {
  url: string;
  type: string;
  details: string;
  sources: string[];
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ProcessedRow {
  [key: string]: string | AnalysisStatus | AnalysisResult | undefined;
  _status: AnalysisStatus;
  _analysis?: AnalysisResult;
}