# Third-party notices

## PDF.js

CALI uses Mozilla PDF.js to extract selectable text from PDF files inside the browser. Original PDF files are not uploaded by the reviewer-generation flow.

- Project: https://github.com/mozilla/pdf.js
- License: Apache License 2.0

## PaddleOCR.js and PP-OCRv5 models

CALI includes the PaddleOCR.js browser SDK and PP-OCRv5 inference model files from the PaddlePaddle/PaddleOCR project. Schedule scanning and multi-page notebook scanning reuse one on-device OCR worker. The canonical deployed model archives are stored under `public/ocr/v1/models/`; legacy `/ocr/models/*` requests are rewritten to those same files rather than shipping duplicate model archives.

- Project: https://github.com/PaddlePaddle/PaddleOCR
- License: Apache License 2.0

## ONNX Runtime Web

CALI includes ONNX Runtime Web browser runtime files. The active Schedule Scanner uses the standard threaded SIMD module and WASM binary under `public/ocr/v1/runtime/`. The different JSEP runtime under `public/ocr/runtime/` is retained only for compatibility with already-open legacy deployments.

- Project: https://github.com/microsoft/onnxruntime
- License: MIT License
