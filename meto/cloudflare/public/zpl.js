/* Raster ZPL compatible with the METO 17.0.13 printer service. */
(function(root) {
  function rasterZpl(rgba, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1600 || height > 1600 || rgba.length !== width * height * 4) throw new Error("Dimensioni immagine non valide");
    const stride = Math.ceil(width / 8);
    let hex = "";
    for (let y = 0; y < height; y++) {
      for (let b = 0; b < stride; b++) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = b * 8 + bit;
          if (x >= width) continue;
          const i = (y * width + x) * 4;
          const alpha = rgba[i+3] / 255;
          const luminance = (rgba[i]*0.299 + rgba[i+1]*0.587 + rgba[i+2]*0.114)*alpha + 255*(1-alpha);
          if (luminance < 180) packed |= 0x80 >> bit;
        }
        hex += packed.toString(16).toUpperCase().padStart(2, "0");
      }
    }
    return `^XA\n^FO0,0\n^GFA,${stride*height},${stride*height},${stride},${hex}\n^FS\n^XZ\n`;
  }
  root.metoRasterZpl = rasterZpl;
  if (typeof module !== "undefined") module.exports = rasterZpl;
})(typeof window === "undefined" ? globalThis : window);
