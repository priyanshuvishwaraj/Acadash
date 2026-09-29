import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Let Vite resolve the asset URL with a static import. A dynamically imported
// worker module can be wrapped by the dev bundler instead of yielding a URL.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
