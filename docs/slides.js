/* Slide deck: PDF pages or images drawn onto a canvas. The canvas is both the preview and the recorded video source. */
const W = 1280, H = 720;
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
let pdfjsPromise;
function pdfjs() {
  pdfjsPromise ||= import(new URL('./vendor/pdfjs/pdf.min.mjs', import.meta.url).href).then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return m;
  });
  return pdfjsPromise;
}

export class Deck {
  constructor(canvas, onChange) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.slides = []; this.index = 0; this.current = null; this.onChange = onChange; this.token = 0;
    this.timer = setInterval(() => this.draw(), 100);
    this.draw();
  }
  get count() { return this.slides.length; }

  async load(files) {
    const list = [...files].sort(natural), slides = [];
    for (const f of list) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const lib = await pdfjs();
        const pdf = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        for (let n = 1; n <= pdf.numPages; n++) slides.push({ pdf, n });
      } else if (f.type.startsWith('image/')) slides.push({ file: f });
    }
    if (!slides.length) throw new Error('No PDF or image files found.');
    this.slides = slides; this.index = 0;
    await this.show(0);
  }

  async render(s) {
    if (s.file) return createImageBitmap(s.file);
    const page = await s.pdf.getPage(s.n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(W / base.width, H / base.height) * 1.5 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
    return c;
  }

  async show(i) {
    if (!this.count) return;
    i = Math.max(0, Math.min(i, this.count - 1));
    const token = ++this.token;
    const img = await this.render(this.slides[i]);
    if (token !== this.token) return; // a newer request won
    this.index = i; this.current = img; this.draw(); this.onChange?.();
  }
  next() { return this.show(this.index + 1); }
  prev() { return this.show(this.index - 1); }

  draw() {
    const { ctx } = this;
    ctx.fillStyle = '#0b0b0a'; ctx.fillRect(0, 0, W, H);
    const img = this.current;
    if (!img) {
      ctx.fillStyle = '#55534c'; ctx.font = '28px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText('Load slides to begin', W / 2, H / 2); return;
    }
    const iw = img.width, ih = img.height, s = Math.min(W / iw, H / ih), dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
}
