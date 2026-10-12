# Third-party notices

CALI uses the third-party software, model assets, and services listed below. Package versions are the versions resolved by `package-lock.json`. Transitive dependencies remain subject to the licenses included with their respective packages.

## Browser and server runtime software

### PaddleOCR.js and PP-OCRv5 models

CALI includes PaddleOCR.js 0.4.2 and PP-OCRv5 inference model files from the PaddlePaddle/PaddleOCR project. Schedule scanning and multi-page notebook scanning reuse one on-device OCR worker. The canonical deployed model archives are stored under `public/ocr/v1/models/`; legacy `/ocr/models/*` requests are rewritten to those same files rather than shipping duplicate model archives.

- Project: https://github.com/PaddlePaddle/PaddleOCR
- License: Apache License 2.0

### ONNX Runtime Web

CALI includes ONNX Runtime Web 1.30.0 browser runtime files. The active Schedule Scanner uses the standard threaded SIMD module and WASM binary under `public/ocr/v1/runtime/`. The different JSEP runtime under `public/ocr/runtime/` is retained only for compatibility with already-open legacy deployments.

- Project: https://github.com/microsoft/onnxruntime
- License: MIT License

### PDF.js

CALI uses Mozilla PDF.js 5.4.296 to extract selectable text from PDF files inside the browser. Original PDF files are not uploaded by the reviewer-generation flow.

- Project: https://github.com/mozilla/pdf.js
- License: Apache License 2.0

### Supabase JavaScript client

CALI uses `@supabase/supabase-js` 2.117.1 for authentication, database, storage, and server-side Supabase access.

- Project: https://github.com/supabase/supabase-js
- License: MIT License

### Tiptap

CALI uses Tiptap 3.31.3, including its React integration, StarterKit, and color, highlight, table, task-list, text-alignment, and text-style extensions, to edit and render reviewer content.

- Project: https://github.com/ueberdosis/tiptap
- License: MIT License

### docx

CALI uses docx 9.7.2 to generate Microsoft Word documents.

- Project: https://github.com/dolanmiu/docx
- License: MIT License

### DOMPurify

CALI uses DOMPurify 3.4.16 to sanitize rendered HTML.

- Project: https://github.com/cure53/DOMPurify
- License: Mozilla Public License 2.0 or Apache License 2.0

### React and React DOM

CALI uses React and React DOM 19.3.0 for its user interface.

- Project: https://github.com/facebook/react
- License: MIT License

### React Router

CALI uses React Router 7.18.4 for client-side routing.

- Project: https://github.com/remix-run/react-router
- License: MIT License

## External services

### OpenRouter

CALI uses the OpenRouter API for AI-assisted reviewer generation and academic-content checks. Reviewed extracted text is sent to OpenRouter and the downstream model provider selected from CALI's configured model list. OpenRouter is a hosted service and is not distributed as part of CALI; its use is governed by OpenRouter's current terms and privacy policy.

- Service: https://openrouter.ai/
- Terms: https://openrouter.ai/terms
- Privacy policy: https://openrouter.ai/privacy
