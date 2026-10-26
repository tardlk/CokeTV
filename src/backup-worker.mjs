import fs from 'node:fs';
import {parentPort, workerData} from 'node:worker_threads';
import AdmZip from 'adm-zip';

// Kept in a worker thread so deflate compression and file reads never block the
// HTTP process. The parent owns naming, retention and atomic rename.
try {
    const zip = new AdmZip();
    for (const file of workerData.files) zip.addFile(file.name, fs.readFileSync(file.path));
    zip.writeZip(workerData.output);
    parentPort.postMessage({ok: true});
} catch (error) {
    parentPort.postMessage({ok: false, error: error.message});
}
