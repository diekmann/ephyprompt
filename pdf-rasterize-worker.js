"use strict";

import * as mupdf from "./node_modules/mupdf/dist/mupdf.js";

self.onmessage = ({ data: { arrayBuffer, filename, width } }) => {
    console.log("pdf-rasterize-worker on ", filename);
    self.postMessage(rasterizePDF(arrayBuffer, filename, width));
};

self.postMessage("ready"); // race, because loading the mupdf wasm takes a while and onmessage is only installed afterwards.

function rasterizePDF(fileBuffer, fileName, pngWidth) {
    const pdf = mupdf.Document.openDocument(fileBuffer, "application/pdf");
    try {
        const fname = fileName.replace(/\.[^/.]+$/, "_") || "document";
        const pages = [];
        const pageCount = pdf.countPages();
        const padding = String(pageCount).length;

        for (let index = 0; index < pageCount; index++) {
            const page = pdf.loadPage(index);
            try {
                const bounds = page.getBounds();
                const pageWidth = bounds[2] - bounds[0];
                const zoom = Number(pngWidth) / pageWidth;

                const pix = page.toPixmap([zoom, 0, 0, zoom, 0, 0], mupdf.ColorSpace.DeviceRGB);

                // TODO: is there a better base64 encoding?
                const bytes = new Uint8Array(pix.asPNG());
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);

                const name = `${fname}-page-${String(index + 1).padStart(padding, "0")}.png`;
                const dataUrl = `data:image/png;base64,${base64}`;
                pages.push({
                    name: name,
                    url: dataUrl
                });
            } finally {
                // TODO: pix.destroy()?
                page.destroy();
            }
        }
        return { pages };
    } finally {
        pdf.destroy();
    }
}