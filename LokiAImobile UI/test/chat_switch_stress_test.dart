import 'dart:async';
import 'dart:io';

import 'package:fllama/fllama_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/ml/chat_inference.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _HoldingFllama extends FllamaPlatform with MockPlatformInterfaceMixin {
  final List<String> events = <String>[];
  final Map<double, Completer<void>> _completions = <double, Completer<void>>{};
  double _nextContext = 1;

  @override
  Stream<Map<Object?, dynamic>>? get onTokenStream => const Stream.empty();

  @override
  Future<Map<Object?, dynamic>?> getCpuInfo() async => <Object?, dynamic>{
    'cpuCount': 2,
  };

  @override
  Future<Map<Object?, dynamic>?> initContext(
    String model, {
    bool embedding = false,
    int nCtx = 768,
    int nBatch = 768,
    int nThreads = 0,
    int nGpuLayers = 0,
    bool useMlock = true,
    bool useMmap = true,
    String lora = '',
    bool loraInitWithoutApply = false,
    double loraScaled = 1.0,
    double ropeFreqBase = 0.0,
    double ropeFreqScale = 0.0,
    bool emitLoadProgress = false,
  }) async {
    final contextId = _nextContext++;
    _completions[contextId] = Completer<void>();
    return <Object?, dynamic>{'contextId': contextId};
  }

  @override
  Future<Map<Object?, dynamic>?> completion(
    double contextId, {
    required String prompt,
    List<List<double>>? logitBias,
    String grammar = '',
    double temperature = 0.7,
    int nThreads = 0,
    int nPredict = -1,
    int nProbs = 0,
    int penaltyLastN = 64,
    double penaltyRepeat = 1.0,
    double penaltyFreq = 0.0,
    double penaltyPresent = 0.0,
    double mirostat = 0.0,
    double mirostatTau = 5.0,
    double mirostatEta = 0.1,
    bool penalizeNl = false,
    int topK = 40,
    double topP = 0.95,
    double minP = 0.05,
    double typicalP = 1.0,
    double xtcThreshold = 0.0,
    double xtcProbability = 0.0,
    int seed = -1,
    List<String>? stop,
    bool ignoreEos = false,
    bool emitRealtimeCompletion = false,
  }) async {
    events.add('completion:$contextId');
    await _completions[contextId]!.future;
    return <Object?, dynamic>{};
  }

  @override
  Future<void> stopCompletion(double contextId) async {
    events.add('stop:$contextId');
    _completions[contextId]?.complete();
  }

  @override
  Future<Map<Object?, dynamic>?> tokenize(double contextId, {
    required String text,
  }) async => <Object?, dynamic>{
    'tokens': List<int>.filled(16, 1),
  };

  @override
  Future<void> releaseContext(double contextId) async {
    events.add('release:$contextId');
  }
}

Future<File> _modelFile(Directory root, int index) async {
  final file = File('${root.path}/chat-$index.gguf');
  final handle = await file.open(mode: FileMode.write);
  await handle.writeFrom('GGUF'.codeUnits);
  // Sparse but valid-sized test files: ModelGuard sees six distinct complete
  // GGUF candidates without making the test suite download real LLMs.
  await handle.setPosition(20 * 1024 * 1024);
  await handle.writeByte(0);
  await handle.close();
  return file;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'six active chat-to-camera switches stop before native context release',
    () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final previous = FllamaPlatform.instance;
      final fake = _HoldingFllama();
      FllamaPlatform.instance = fake;
      final root = await Directory.systemTemp.createTemp(
        'lokiai_switch_stress',
      );
      addTearDown(() async {
        FllamaPlatform.instance = previous;
        await root.delete(recursive: true);
      });

      for (var index = 0; index < 6; index++) {
        final model = await _modelFile(root, index);
        final chat = ChatInference();
        await chat.initialize(model.path);
        final subscription = chat
            .generateText('keep generating')
            .listen((_) {});
        await Future<void>.delayed(Duration.zero);

        // This is the exact operation performed when selecting a camera model.
        await chat.dispose();
        await subscription.cancel();

        final contextId = (index + 1).toDouble();
        expect(
          fake.events,
          containsAllInOrder(<String>[
            'completion:$contextId',
            'stop:$contextId',
            'release:$contextId',
          ]),
          reason:
              'model ${index + 1} must stop before native memory is released',
        );
      }
    },
  );

  test('rapid prompts never overlap on one native context', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final previous = FllamaPlatform.instance;
    final fake = _HoldingFllama();
    FllamaPlatform.instance = fake;
    final root = await Directory.systemTemp.createTemp('loki_rapid_prompt');
    addTearDown(() async {
      FllamaPlatform.instance = previous;
      await root.delete(recursive: true);
    });

    final model = await _modelFile(root, 1);
    final chat = ChatInference();
    await chat.initialize(model.path);
    final first = chat.generateText('first').listen((_) {});
    final second = chat.generateText('second').listen((_) {});
    await Future<void>.delayed(Duration.zero);

    // The second prompt is queued in Dart and cannot reach native code while
    // the first completion owns this context.
    expect(fake.events.where((event) => event.startsWith('completion:')),
        hasLength(1));
    await chat.dispose();
    await first.cancel();
    await second.cancel();
  });
}
