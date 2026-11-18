// Backend = Supabase Edge Function "study". Change only if the Supabase project changes.
window.API = "https://okfbtijobhdqrqtfbofn.supabase.co/functions/v1/study";
// Optional: Supabase publishable/anon key (public by design). Only needed if "Verify JWT" is left ON for the function.
window.SB_PUBLIC_KEY = "";
// Second-opinion model (own CLIP ViT-B/32 + MLP model from A2).
//   "off"  (default since Nov 17) -> show the model's A2 prediction for the photo (computed with PyTorch fp32).
//   "q8" | "fp16" | "fp32"        -> run the model live in the participant's browser with that ONNX precision.
// The in-class session (Nov 12) used "q8". Its outputs turned out to be ~40 % lower than the A2 predictions
// (8-bit quantisation shifts the CLIP embedding), so the browser model is disabled until a precision has been
// verified on the /selftest/ page to reproduce the A2 predictions.
window.OWN_DTYPE = "off";
