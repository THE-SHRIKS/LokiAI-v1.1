import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/app_version.dart';

void main() {
  test('app_version.dart matches pubspec.yaml', () {
    // Crash records and the release checklist both quote these constants. If
    // they drift from the pubspec the reported build is a lie, so the drift is
    // a test failure rather than a convention.
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final match = RegExp(r'^version:\s*(\S+)\+(\S+)\s*$', multiLine: true)
        .firstMatch(pubspec);

    expect(match, isNotNull, reason: 'pubspec.yaml has no version: line');
    expect(match!.group(1), kAppVersionName);
    expect(match.group(2), kAppVersionCode);
  });
}
