// Hand-picked, real HuggingFace models — verified to exist and sized via a
// real HTTP HEAD against the HuggingFace CDN (not estimated). Curated for
// small size + genuine usefulness on a phone, spanning multiple tasks
// rather than just chat. Deploying one of these skips the assistant's own
// broad search and goes straight to this exact model + file.

export interface CuratedModel {
  hfModelId: string;
  filename: string;
  name: string;
  task: string;
  sizeMb: number;
  description: string;
}

export const CURATED_MODELS: CuratedModel[] = [
  {
    hfModelId: "litert-community/YuNet-Face-LiteRT",
    filename: "yunet_fp16.tflite",
    name: "YuNet Face Detector",
    task: "object-detection",
    sizeMb: 0.2,
    description: "Detects every face in the camera view instantly — the smallest model here.",
  },
  {
    hfModelId: "litert-community/yolox-nano-litert",
    filename: "yolox_nano.tflite",
    name: "YOLOX Nano",
    task: "object-detection",
    sizeMb: 2.1,
    description: "Tiny real-time object detector — boxes multiple objects live, not just one label.",
  },
  {
    hfModelId: "mysterious588/ADAS",
    filename: "efficientdet_lite0.tflite",
    name: "EfficientDet-Lite0",
    task: "object-detection",
    sizeMb: 4.4,
    description: "Google's mobile-tuned object detector — best accuracy-per-MB for general everyday use.",
  },
  {
    hfModelId: "litert-community/MobileNet-v3-small",
    filename: "mobilenet_v3_small.tflite",
    name: "MobileNetV3 Small",
    task: "image-classification",
    sizeMb: 9.7,
    description: "Classifies 1,000 everyday objects — fast even on weaker phones.",
  },
  {
    hfModelId: "litert-community/squeezenet1_1",
    filename: "squeezenet1_1.tflite",
    name: "SqueezeNet 1.1",
    task: "image-classification",
    sizeMb: 4.7,
    description: "An even smaller classifier for the most constrained phones.",
  },
  {
    hfModelId: "thelou1s/yamnet",
    filename: "lite-model_yamnet_classification_tflite_1.tflite",
    name: "YAMNet",
    task: "audio-classification",
    sizeMb: 3.9,
    description: "Classifies 521 real-world sounds from the mic — proven working on real hardware.",
  },
  {
    hfModelId: "litert-community/MODNet-LiteRT",
    filename: "modnet.tflite",
    name: "MODNet",
    task: "image-segmentation",
    sizeMb: 25.0,
    description: "Real-time background removal — live blur or green-screen effect, no green screen needed.",
  },
  {
    hfModelId: "litert-community/RTMPose-s-LiteRT",
    filename: "rtmpose_s_fp16.tflite",
    name: "RTMPose Small",
    task: "pose-estimation",
    sizeMb: 10.6,
    description: "Tracks human body joints in real time — motion and fitness tracking.",
  },
];
