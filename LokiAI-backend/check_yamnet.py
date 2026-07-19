import requests

# Get yamnet model from google directly
for model_id in ['google/yamnet', 'tensorflow/yamnet', 'chayuto/yamnet-mel-int8-tflm']:
    r = requests.get(f'https://huggingface.co/api/models/{model_id}')
    if r.status_code == 200:
        sibs = r.json().get('siblings', [])
        files = [s['rfilename'] for s in sibs]
        print(f'{model_id} files: {files[:10]}')
    else:
        print(f'{model_id}: HTTP {r.status_code}')

# Try direct URL check for yamnet.tflite from tfhub mirror
for url in [
    'https://huggingface.co/Yoonho-Oh/yamnet-tflite/resolve/main/yamnet.tflite',
    'https://huggingface.co/qualcomm/Yamnet/resolve/main/yamnet.tflite',
]:
    r = requests.head(url, allow_redirects=True)
    print(f'HEAD {url}: {r.status_code} content-length={r.headers.get("content-length")}')
