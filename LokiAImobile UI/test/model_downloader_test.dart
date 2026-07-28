import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/model_downloader.dart';

/// model_name arrives from the backend over the WebSocket and used to be
/// concatenated straight into a filesystem path, so a malicious or compromised
/// backend (or anyone who could reach the then-unauthenticated socket) could
/// write outside the models directory.
void main() {
  group('ModelDownloader.sanitizeFilename', () {
    test('keeps ordinary model filenames unchanged', () {
      expect(ModelDownloader.sanitizeFilename('mobilenet_v2.tflite'),
          'mobilenet_v2.tflite');
      expect(ModelDownloader.sanitizeFilename('phi-2.Q4_K_S.gguf'),
          'phi-2.Q4_K_S.gguf');
    });

    test('strips parent-directory traversal', () {
      expect(ModelDownloader.sanitizeFilename('../../shared_prefs/evil.xml'),
          'evil.xml');
      expect(ModelDownloader.sanitizeFilename('../../../etc/passwd'), 'passwd');
    });

    test('strips absolute paths and both separator styles', () {
      expect(ModelDownloader.sanitizeFilename('/data/data/io.lokiai/x.tflite'),
          'x.tflite');
      expect(ModelDownloader.sanitizeFilename(r'C:\Windows\System32\evil.dll'),
          'evil.dll');
      expect(ModelDownloader.sanitizeFilename(r'a\b/c\d.gguf'), 'd.gguf');
    });

    test('neutralises characters that are not filename-safe', () {
      expect(ModelDownloader.sanitizeFilename('model;rm -rf *.tflite'),
          'model_rm_-rf__.tflite');
      expect(ModelDownloader.sanitizeFilename('mo\u0000del.gguf'),
          'mo_del.gguf');
    });

    test('never returns a dot-file or an empty name', () {
      expect(ModelDownloader.sanitizeFilename('..'), 'model.bin');
      expect(ModelDownloader.sanitizeFilename('.'), 'model.bin');
      expect(ModelDownloader.sanitizeFilename(''), 'model.bin');
      expect(ModelDownloader.sanitizeFilename('/'), 'model.bin');
      expect(ModelDownloader.sanitizeFilename('.hidden'), 'hidden');
    });
  });
}
