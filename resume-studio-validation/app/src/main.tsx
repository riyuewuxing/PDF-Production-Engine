import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { CoverLetterPrintView } from './components/Preview/CoverLetterPrintView';
import { PrintDocumentView } from './components/Preview/PrintDocumentView';
import './index.css';
import './styles/print.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('未找到 #root 挂载节点');
}

const searchParams = new URLSearchParams(window.location.search);
const mode = searchParams.get('mode');
const printJobId = searchParams.get('jobId') ?? '';

createRoot(rootElement).render(
  <StrictMode>
    {mode === 'print' && printJobId ? (
      <PrintDocumentView jobId={printJobId} />
    ) : mode === 'coverLetter' && printJobId ? (
      <CoverLetterPrintView jobId={printJobId} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
