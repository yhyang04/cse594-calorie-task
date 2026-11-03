// Own calorie model from A2, run in the browser: frozen CLIP ViT-B/32 image encoder (transformers.js / ONNX)
// + the A2-trained MLP head (weights in model/own_mlp_head.bin). Same pipeline as A2 own_model.py:
//   image -> CLIP image_embeds (512) -> L2-normalise -> MLP (512-256-128-1, GELU) -> exp() = kcal
const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const CLIP = "Xenova/clip-vit-base-patch32";
const ASSET = window.ASSET || "../";

let loading = null;

function erf(x) { // Abramowitz & Stegun 7.1.26 (|err| < 1.5e-7)
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2)); // exact GELU, as torch.nn.GELU()

function linear(x, W, b, nOut, nIn) {
  const y = new Float32Array(nOut);
  for (let o = 0; o < nOut; o++) {
    let acc = b[o];
    const row = o * nIn;
    for (let i = 0; i < nIn; i++) acc += W[row + i] * x[i];
    y[o] = acc;
  }
  return y;
}

async function loadHead() {
  const [shapes, buf] = await Promise.all([
    fetch(ASSET + "model/own_mlp_head.json").then((r) => r.json()),
    fetch(ASSET + "model/own_mlp_head.bin").then((r) => r.arrayBuffer()),
  ]);
  return mlpFrom(shapes, buf);
}

export function mlpFrom(shapes, buf) {
  const all = new Float32Array(buf);
  const keys = ["net.0.weight", "net.0.bias", "net.3.weight", "net.3.bias", "net.6.weight", "net.6.bias"];
  const P = {};
  let off = 0;
  for (const k of keys) { const n = shapes[k].reduce((a, b) => a * b, 1); P[k] = all.subarray(off, off + n); off += n; }
  return (feat) => {
    let h = linear(feat, P["net.0.weight"], P["net.0.bias"], 256, 512).map(gelu);
    h = linear(h, P["net.3.weight"], P["net.3.bias"], 128, 256).map(gelu);
    return Math.exp(linear(h, P["net.6.weight"], P["net.6.bias"], 1, 128)[0]);
  };
}

async function doLoad(dtype) {
  const t0 = performance.now();
  const { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } = await import(TJS);
  env.allowLocalModels = false;
  const [processor, vision, head] = await Promise.all([
    AutoProcessor.from_pretrained(CLIP),
    CLIPVisionModelWithProjection.from_pretrained(CLIP, { dtype, device: "wasm" }),
    loadHead(),
  ]);
  return { processor, vision, head, RawImage, dtype, load_ms: Math.round(performance.now() - t0) };
}

window.OwnModel = {
  status: "idle",
  load(dtype = window.OWN_DTYPE || "q8") {
    if (!loading) {
      this.status = "loading";
      loading = doLoad(dtype).then((m) => { this.status = "ready"; return m; },
                                    (e) => { this.status = "error: " + (e.message || e); loading = null; throw e; });
    }
    return loading;
  },
  async features(url) {
    const m = await this.load();
    const img = await m.RawImage.read(url);
    const inputs = await m.processor(img);
    const { image_embeds } = await m.vision(inputs);
    const v = Float32Array.from(image_embeds.data);
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n);
    return v.map((x) => x / n);
  },
  async predict(url) {
    const t0 = performance.now();
    const m = await this.load();
    const feat = await this.features(url);
    return { kcal: Math.round(m.head(feat) * 10) / 10, ms: Math.round(performance.now() - t0), dtype: m.dtype };
  },
};
