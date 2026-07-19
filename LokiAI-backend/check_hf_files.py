import requests

# Check TheBloke phi-2 all GGUF variants
r = requests.get('https://huggingface.co/api/models/TheBloke/phi-2-GGUF')
siblings = r.json().get('siblings', [])
files = [s['rfilename'] for s in siblings if s['rfilename'].endswith('.gguf')]
print('Phi-2 GGUF files:', files)

# Search for yamnet tflite
r2 = requests.get('https://huggingface.co/api/models?search=yamnet&filter=tflite&limit=5')
data = r2.json()
for m in data:
    files2 = [s['rfilename'] for s in m.get('siblings',[]) if s['rfilename'].endswith('.tflite')]
    print(f"yamnet candidate: {m['id']} -> {files2}")

# Try Synaptics MobileNetV2 which worked in Phase 3
r4 = requests.get('https://huggingface.co/api/models/Synaptics/MobileNetV2')
sibs4 = r4.json().get('siblings', [])
files4 = [s['rfilename'] for s in sibs4 if s['rfilename'].endswith('.tflite')]
print(f"Synaptics/MobileNetV2: {files4}")
